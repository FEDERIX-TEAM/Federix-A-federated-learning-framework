import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import torch
import torch.nn as nn
from torch.utils.data import Subset

from federix_sdk import ClientSettings, DensePayload, FederixApi, FederixClient, Session, Transfers, decode, encode
from federix_sdk._gen import common_pb2
from federix_sdk.adapters.pytorch import TorchAdapter
from federix_sdk.testing import start_backend
from federix_sdk.trainers.pytorch import TorchFedProxTrainer

from federix.config import Config, ConfigError
from federix.data import load_mnist
from federix.fl_server import FlServer, ModelError, server_datasets
from federix.model import make_model

BRAIN = Path(__file__).resolve().parents[1]
DATA_DIR = str(BRAIN / "data")
REJECTED = common_pb2.UPDATE_STATUS_REJECTED


@pytest.fixture(scope="module")
def backend():
    env = {"SCHEDULER_INTERVAL_MS": "150", "WATCH_KEEPALIVE_MS": "300"}
    with start_backend(env, db_prefix="federix_braintest") as b:
        yield b


@pytest.fixture(scope="module")
def mnist():
    return load_mnist(DATA_DIR)


def admin_api(backend):
    api = FederixApi(backend.base_url)
    api.access_token = api.auth.admin_login(email=backend.admin_email, password=backend.admin_password).access_token
    return api


def server_config(backend, tmp_path, *extra):
    return Config.load(env={}, overrides=[
        f"backend_url={backend.base_url}", f"internal_token={backend.internal_token}", "worker_id=brain-test",
        f"data_dir={DATA_DIR}", f"log_dir={tmp_path}", "server_holdout_size=500", "eval_size=2000",
        "status_interval=0.3", "reconnect_delay=0.2", "watch_timeout=30", *extra,
    ])


def new_server(backend, tmp_path, mnist, *extra, model=None):
    cfg = server_config(backend, tmp_path, *extra)
    torch.manual_seed(cfg.seed)
    holdout, test = server_datasets(cfg, test=mnist[1])
    return FlServer(cfg, model=model, holdout=holdout, test=test)


def configure(backend, clients):
    with admin_api(backend) as admin:
        admin.admin.update_config(min_clients_per_round=clients, utility_threshold_low=0.0, utility_threshold_high=0.0,
                                  local_epochs=1, batch_size=32, mu=0.01, utility={"reject_below": 0.0})
        return admin.admin.start_round(max_clients=clients, deadline_seconds=600).round_id


def session_for(backend, tmp_path):
    with admin_api(backend) as admin:
        token = admin.admin.create_enrollment_token(max_uses=1, ttl_hours=1).token
    s = ClientSettings.load(env={}, server_url=backend.base_url, enrollment_token=token, heartbeat_interval=1,
                            credentials_path=str(tmp_path / f"creds-{secrets.token_hex(3)}.json"))
    return Session(s).start()


def shard(mnist, k, n=600):
    train = mnist[0]
    idx = np.random.default_rng(100 + k).choice(len(train), size=n, replace=False)
    order = np.sort(idx)
    return Subset(train, order[:500].tolist()), Subset(train, order[500:].tolist())


class Poisoned(TorchFedProxTrainer):
    def train(self, config):
        start = self.adapter.get_weights()
        result = super().train(config)
        self.adapter.set_weights(start - 20.0 * (self.adapter.get_weights() - start))
        return result


def run_clients(backend, tmp_path, mnist, round_id, kinds):
    outcomes, errors = {}, []

    def one(k, kind):
        try:
            session = session_for(backend, tmp_path)
            train, val = shard(mnist, k)
            trainer = (Poisoned if kind == "poisoned" else TorchFedProxTrainer)(make_model(), train, val, lr=0.05)
            with FederixClient(session, trainer) as client:
                outcomes[k] = client.run_round(round_id)
            session.close()
        except Exception as err:
            errors.append(err)

    threads = [threading.Thread(target=one, args=(k, kind)) for k, kind in enumerate(kinds)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    assert errors == []
    return outcomes


def serve(server, max_rounds=1):
    thread = threading.Thread(target=server.run, kwargs={"max_rounds": max_rounds}, daemon=True)
    thread.start()
    return thread


def finish(server, thread, timeout=90):
    thread.join(timeout)
    alive = thread.is_alive()
    server.stop()
    thread.join(5)
    server.close()
    assert not alive, "the FL server did not finish the round in time"


def active_version(backend):
    with FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        return fl.fl.get_model_download_url().model_version


def update_statuses(backend, round_id):
    with admin_api(backend) as admin:
        return {u.update_id: u.status for u in admin.admin.get_round_detail(round_id=round_id).updates}


def test_server_settings_are_validated(tmp_path):
    with pytest.raises(ConfigError) as info:
        Config.load(env={}, overrides=["backend_url=ftp://x", "worker_id=bad id!", "watch_timeout=0", "reconnect_max_delay=0.1"])
    text = str(info.value)
    for expected in ("backend_url must start with http", "worker_id must be 1-64", "watch_timeout must be > 0", "reconnect_max_delay must be >="):
        assert expected in text
    with pytest.raises(ConfigError, match="FEDERIX_INTERNAL_TOKEN"):
        FlServer(Config.load(env={}), holdout=None, test=[0])
    assert Config.load(env={"FEDERIX_INTERNAL_TOKEN": "s3cret"}).as_dict(redact=True)["internal_token"] == "***"


def test_the_first_start_pushes_the_initial_model_and_a_restart_reuses_it(backend, tmp_path, mnist):
    first = new_server(backend, tmp_path, mnist)
    assert first.ensure_model() == 1
    with admin_api(backend) as admin:
        [model] = list(admin.admin.list_models())
    assert model.model_version == 1 and 0.0 < model.accuracy < 0.3
    initial = first.global_vec.copy()
    first.close()

    again = new_server(backend, tmp_path, mnist, "seed=9")
    assert again.ensure_model() == 1
    np.testing.assert_array_equal(again.global_vec, initial)
    again.close()

    other = new_server(backend, tmp_path, mnist, model=nn.Sequential(nn.Flatten(), nn.Linear(784, 10)))
    with pytest.raises(ModelError, match="different architecture"):
        other.ensure_model()
    other.close()


def test_a_round_runs_end_to_end_with_nobody_calling_the_brain(backend, tmp_path, mnist):
    server = new_server(backend, tmp_path, mnist)
    thread = serve(server)
    before = active_version(backend)
    round_id = configure(backend, 3)
    outcomes = run_clients(backend, tmp_path, mnist, round_id, ["honest"] * 3)
    assert {o.status for o in outcomes.values()} == {"submitted"}
    finish(server, thread)

    [result] = server.results
    assert result.status == "completed" and result.round_id == round_id
    assert len(result.used) == 3 and result.rejected == {}
    assert result.model_version == before + 1 == active_version(backend)
    assert result.accuracy > 0.6

    with admin_api(backend) as admin:
        assert any(r.round_id == round_id for r in admin.admin.list_rounds(status="complete"))
        status = admin.admin.get_fl_server_status()
    assert status.worker_id == "brain-test" and status.state == common_pb2.FL_SERVER_STATE_IDLE
    assert status.message == "stopped"

    with FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        res = fl.fl.get_model_download_url()
    payload, _ = decode(Transfers().download(res.download_url), expected_digest=TorchAdapter(make_model()).spec().digest)
    np.testing.assert_allclose(payload.to_dense(), server.global_vec)


def test_a_poisoned_update_is_left_out_with_its_reason(backend, tmp_path, mnist):
    server = new_server(backend, tmp_path, mnist)
    previous = server.evaluate(new_server(backend, tmp_path, mnist).download_model()[0])["acc"]
    thread = serve(server)
    round_id = configure(backend, 4)
    outcomes = run_clients(backend, tmp_path, mnist, round_id, ["honest", "honest", "honest", "poisoned"])
    finish(server, thread)

    [result] = server.results
    poisoned = outcomes[3].update_id
    assert result.status == "completed"
    assert list(result.rejected) == [poisoned] and "norm" in result.rejected[poisoned]
    assert len(result.used) == 3
    assert result.accuracy >= previous - 0.02
    assert update_statuses(backend, round_id)[poisoned] == REJECTED


def test_a_round_with_no_usable_update_fails_with_reasons(backend, tmp_path, mnist):
    server = new_server(backend, tmp_path, mnist)
    version = active_version(backend)
    thread = serve(server)
    round_id = configure(backend, 1)
    session = session_for(backend, tmp_path)
    session.api.client.join_round(round_id=round_id, local_data_size=500)
    prepared = session.api.client.prepare_update(round_id=round_id, local_loss_before=2.3, local_loss_after=1.0,
                                                 label_distribution={"counts": {"0": 250, "1": 250}}, data_size=500, training_time_ms=5)
    uploaded = Transfers().upload(prepared.upload.url, b"definitely not FXW1" * 100)
    session.api.client.submit_update(round_id=round_id, update_id=prepared.update_id, sha256=uploaded["sha256"])
    session.close()
    finish(server, thread)

    [result] = server.results
    assert result.status == "failed" and "no update passed validation" in result.reason
    assert "could not be read" in result.rejected[prepared.update_id]
    assert active_version(backend) == version
    with admin_api(backend) as admin:
        assert any(r.round_id == round_id for r in admin.admin.list_rounds(status="failed"))
    assert update_statuses(backend, round_id)[prepared.update_id] == REJECTED


def test_an_interrupted_aggregation_is_resumed_after_a_restart(backend, tmp_path, mnist):
    round_id = configure(backend, 2)
    run_clients(backend, tmp_path, mnist, round_id, ["honest", "honest"])
    with FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        fl.fl.trigger_round(round_id=round_id)
    version = active_version(backend)

    server = new_server(backend, tmp_path, mnist)
    thread = serve(server)
    finish(server, thread)
    [result] = server.results
    assert result.round_id == round_id and result.status == "completed"
    assert active_version(backend) == version + 1


def test_the_server_reconnects_when_the_round_stream_ends(backend, tmp_path, mnist):
    server = new_server(backend, tmp_path, mnist, "watch_timeout=0.8")
    thread = serve(server)
    time.sleep(2.5)
    assert thread.is_alive() and server.results == []
    round_id = configure(backend, 1)
    run_clients(backend, tmp_path, mnist, round_id, ["honest"])
    finish(server, thread)
    assert [r.status for r in server.results] == ["completed"]


def listening_inodes():
    inodes = set()
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        if os.path.exists(table):
            for line in Path(table).read_text().splitlines()[1:]:
                parts = line.split()
                if parts[3] == "0A":
                    inodes.add(parts[9])
    return inodes


def socket_inodes(pid):
    found = set()
    for fd in Path(f"/proc/{pid}/fd").iterdir():
        try:
            target = os.readlink(fd)
        except OSError:
            continue
        if target.startswith("socket:["):
            found.add(target[8:-1])
    return found


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="reads /proc")
def test_the_cli_process_talks_only_to_the_backend_and_listens_on_no_port(backend, tmp_path):
    env = {**os.environ, "FEDERIX_INTERNAL_TOKEN": backend.internal_token, "FEDERIX_BACKEND_URL": backend.base_url,
           "FEDERIX_WORKER_ID": "brain-cli", "FEDERIX_DATA_DIR": DATA_DIR, "FEDERIX_LOG_DIR": str(tmp_path),
           "FEDERIX_STATUS_INTERVAL": "0.3"}
    proc = subprocess.Popen([sys.executable, "-m", "federix.fl_server"], cwd=BRAIN, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.time() + 60
        with admin_api(backend) as admin:
            while True:
                assert proc.poll() is None, proc.stderr.read()
                status = admin.admin.get_fl_server_status()
                if status.worker_id == "brain-cli" and status.state == common_pb2.FL_SERVER_STATE_IDLE and status.online:
                    break
                assert time.time() < deadline, "the CLI server never reported idle"
                time.sleep(0.2)
        mine = socket_inodes(proc.pid)
        assert mine, "the server should hold a connection to the backend"
        assert mine & listening_inodes() == set()

        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=10) == 0
        with admin_api(backend) as admin:
            assert admin.admin.get_fl_server_status().message == "stopped"
    finally:
        if proc.poll() is None:
            proc.kill()
