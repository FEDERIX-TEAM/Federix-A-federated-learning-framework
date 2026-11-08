import hashlib
import secrets
import threading
import time

import numpy as np
import pytest
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import TensorDataset

from federix_sdk import (
    ClientSettings,
    DensePayload,
    FederixApi,
    FederixClient,
    ModelMismatch,
    Session,
    TopKPayload,
    Transfers,
    decode,
    encode,
)
from federix_sdk.adapters.pytorch import TorchAdapter
from federix_sdk.trainers.pytorch import TorchFedProxTrainer

from conftest import start_backend


def mlp():
    return nn.Sequential(nn.Flatten(), nn.Linear(784, 32), nn.ReLU(), nn.Linear(32, 10))


def prototypes(n, seed, classes=10):
    protos = torch.randn(classes, 1, 28, 28, generator=torch.Generator().manual_seed(1234))
    g = torch.Generator().manual_seed(seed)
    y = torch.randint(0, classes, (n,), generator=g)
    return TensorDataset(protos[y] + 0.3 * torch.randn(n, 1, 28, 28, generator=g), y)


def admin_api(backend):
    api = FederixApi(backend.base_url)
    api.access_token = api.auth.admin_login(email=backend.admin_email, password=backend.admin_password).access_token
    return api


def fresh_round(backend, initial_model, max_clients=10, utility=None, **config):
    settings = {"min_clients_per_round": 1, "utility_threshold_low": 0.2, "utility_threshold_high": 0.8, **config}
    utility_settings = {"reject_below": 0.0, "ratio_low": 0.1, **(utility or {})}
    with admin_api(backend) as admin, FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        admin.admin.update_config(utility={"reject_below": 0.0})
        admin.admin.update_config(**settings, utility=utility_settings)
        for r in list(admin.admin.list_rounds(status="active")) + list(admin.admin.list_rounds(status="aggregating")):
            admin.admin.stop_round(round_id=r.round_id)
        version = max([m.model_version for m in admin.admin.list_models()] + [0]) + 1
        adapter = TorchAdapter(initial_model)
        blob = encode(DensePayload(adapter.get_weights()), adapter.spec().digest)
        url = fl.fl.get_model_upload_url(model_version=version).upload.url
        assert Transfers().upload(url, blob)["bytes"] == len(blob)
        fl.fl.push_model(model_version=version, weights_url=f"/models/{version}")
        return admin.admin.start_round(max_clients=max_clients, deadline_seconds=600).round_id


def new_session(tmp_path, backend):
    with admin_api(backend) as admin:
        token = admin.admin.create_enrollment_token(max_uses=1, ttl_hours=1).token
    s = ClientSettings.load(env={}, server_url=backend.base_url, enrollment_token=token,
                            credentials_path=str(tmp_path / f"creds-{secrets.token_hex(3)}.json"), heartbeat_interval=0.5)
    return Session(s).start()


def trainer_for(model, n=600, seed=0, lr=0.05):
    return TorchFedProxTrainer(model, prototypes(n, seed), prototypes(150, seed + 100), lr=lr)


def round_updates(backend, round_id):
    with FederixApi(backend.base_url, internal_token=backend.internal_token) as fl:
        return list(fl.fl.get_round_updates(round_id=round_id))


@torch.no_grad()
def loss_of(model, data):
    return F.cross_entropy(model(data.tensors[0]), data.tensors[1]).item()


def test_a_full_round_from_a_python_client(tmp_path, backend):
    torch.manual_seed(0)
    initial = mlp()
    round_id = fresh_round(backend, initial)
    session = new_session(tmp_path, backend)
    trainer = trainer_for(mlp())
    with FederixClient(session, trainer) as client:
        outcome = client.run_round(round_id)

    assert outcome.status == "submitted", outcome.reason
    assert outcome.loss_after < outcome.loss_before
    assert outcome.bytes_sent > 0 and outcome.update_id

    [entry] = round_updates(backend, round_id)
    assert entry.update_id == outcome.update_id
    assert entry.data_size == trainer.num_samples()
    assert entry.bytes == outcome.bytes_sent
    blob = Transfers().download(entry.download_url)
    assert hashlib.sha256(blob).hexdigest() == entry.sha256
    payload, digest = decode(blob, expected_digest=trainer.adapter.spec().digest)

    held_out = prototypes(300, 999)
    before = loss_of(initial, held_out)
    merged = mlp()
    TorchAdapter(merged).set_weights(TorchAdapter(initial).get_weights() + payload.to_dense())
    assert loss_of(merged, held_out) < before
    session.close()


def test_the_client_compresses_to_the_ratio_the_server_asks_for(tmp_path, backend):
    torch.manual_seed(1)
    round_id = fresh_round(backend, mlp(), utility_threshold_high=0.999, utility_threshold_low=0.998,
                           utility={"ratio_low": 0.1, "reject_below": 0.0})
    session = new_session(tmp_path, backend)
    with FederixClient(session, trainer_for(mlp())) as client:
        outcome = client.run_round(round_id)
    assert outcome.status == "submitted"
    assert outcome.compression_ratio == pytest.approx(0.1)
    assert outcome.bytes_sent < 0.25 * outcome.dense_bytes
    [entry] = round_updates(backend, round_id)
    payload, _ = decode(Transfers().download(entry.download_url))
    assert isinstance(payload, TopKPayload)
    session.close()


def test_a_model_for_another_architecture_is_refused_before_training(tmp_path, backend):
    round_id = fresh_round(backend, nn.Sequential(nn.Flatten(), nn.Linear(784, 10)))
    session = new_session(tmp_path, backend)
    with FederixClient(session, trainer_for(mlp())) as client:
        with pytest.raises(ModelMismatch, match="different architecture"):
            client.run_round(round_id)
    assert round_updates(backend, round_id) == []
    session.close()


def test_an_update_rejected_at_prepare_is_never_uploaded(tmp_path, backend):
    round_id = fresh_round(backend, mlp(), utility={"reject_below": 0.2})
    session = new_session(tmp_path, backend)
    one_class = TensorDataset(torch.zeros(20, 1, 28, 28), torch.zeros(20, dtype=torch.long))
    trainer = TorchFedProxTrainer(mlp(), one_class, one_class, lr=0.0)
    with FederixClient(session, trainer) as client:
        outcome = client.run_round(round_id)
    assert outcome.status == "rejected"
    assert "rejection threshold" in outcome.reason
    assert outcome.bytes_sent == 0
    assert round_updates(backend, round_id) == []
    session.close()


def test_a_full_round_is_skipped_with_the_server_reason(tmp_path, backend):
    round_id = fresh_round(backend, mlp(), max_clients=1)
    first, second = new_session(tmp_path, backend), new_session(tmp_path, backend)
    first.api.client.join_round(round_id=round_id, local_data_size=10)
    with FederixClient(second, trainer_for(mlp())) as client:
        outcome = client.run_round(round_id)
    assert outcome.status == "skipped"
    assert "capacity" in outcome.reason
    first.close()
    second.close()


def test_an_interrupted_upload_resumes_from_the_server_offset(tmp_path, backend):
    round_id = fresh_round(backend, mlp())
    session = new_session(tmp_path, backend)
    session.api.client.join_round(round_id=round_id, local_data_size=600)
    prepared = session.api.client.prepare_update(round_id=round_id, local_loss_before=1, local_loss_after=0.5,
                                                 label_distribution={"counts": {"0": 600}}, data_size=600, training_time_ms=1)
    data = np.random.default_rng(0).bytes(100_000)
    t = Transfers(chunk_size=8192)
    t.client.put(prepared.upload.url, content=data[:30_000], headers={"content-range": "bytes 0-29999/100000"})
    result = t.upload(prepared.upload.url, data)
    assert result["sha256"] == hashlib.sha256(data).hexdigest()
    assert t.resumes == 1
    session.api.client.submit_update(round_id=round_id, update_id=prepared.update_id, sha256=result["sha256"])
    session.close()


def test_a_partial_download_continues_with_a_range_request(tmp_path, backend):
    fresh_round(backend, mlp())
    session = new_session(tmp_path, backend)
    url = session.api.client.get_model_download().download_url
    t = Transfers()
    full = t.download(url)
    assert t.download(url, partial=full[:12_345]) == full
    session.close()


@pytest.fixture(scope="module")
def short_url_backend():
    with start_backend({"UPLOAD_URL_TTL_SECONDS": "1", "SIGNED_URL_TTL_SECONDS": "1"}) as b:
        yield b


def test_expired_transfer_urls_are_refreshed_automatically(tmp_path, short_url_backend):
    round_id = fresh_round(short_url_backend, mlp())
    session = new_session(tmp_path, short_url_backend)
    session.api.client.join_round(round_id=round_id, local_data_size=600)
    prepared = session.api.client.prepare_update(round_id=round_id, local_loss_before=1, local_loss_after=0.5,
                                                 label_distribution={"counts": {"0": 600}}, data_size=600, training_time_ms=1)
    download_url = session.api.client.get_model_download(round_id=round_id).download_url
    time.sleep(1.3)
    t = Transfers()
    data = b"x" * 5000
    assert t.upload(prepared.upload.url, data)["bytes"] == 5000
    assert len(t.download(download_url)) > 0
    assert t.refreshes >= 2
    session.close()


def test_run_waits_for_a_round_and_does_each_round_once(tmp_path, backend):
    torch.manual_seed(2)
    with admin_api(backend) as admin:
        for r in list(admin.admin.list_rounds(status="active")):
            admin.admin.stop_round(round_id=r.round_id)
    session = new_session(tmp_path, backend)
    started = {}

    def start_later():
        time.sleep(0.6)
        started["id"] = fresh_round(backend, mlp())

    threading.Thread(target=start_later).start()
    with FederixClient(session, trainer_for(mlp())) as client:
        outcomes = client.run(max_rounds=1, poll_interval=0.2)
        assert [o.status for o in outcomes] == ["submitted"]
        assert outcomes[0].round_id == started["id"]
        stop = threading.Event()
        threading.Timer(0.8, stop.set).start()
        assert client.run(stop_event=stop, poll_interval=0.2) == []
    session.close()
