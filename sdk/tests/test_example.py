import importlib.util
from pathlib import Path

import torch

from federix_sdk import FederixApi

from test_round_client import admin_api, fresh_round, round_updates

ROOT = Path(__file__).resolve().parents[2]


def load_example():
    spec = importlib.util.spec_from_file_location("mnist_client", ROOT / "sdk" / "examples" / "mnist_client.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_mnist_example_completes_a_real_round(tmp_path, backend, monkeypatch):
    example = load_example()
    torch.manual_seed(0)
    round_id = fresh_round(backend, example.make_model(), local_epochs=1, batch_size=64)
    with admin_api(backend) as admin:
        token = admin.admin.create_enrollment_token(max_uses=1, ttl_hours=1).token
    monkeypatch.setenv("FEDERIX_SDK_SERVER_URL", backend.base_url)
    monkeypatch.setenv("FEDERIX_SDK_ENROLLMENT_TOKEN", token)
    monkeypatch.setenv("FEDERIX_SDK_CREDENTIALS_PATH", str(tmp_path / "creds.json"))
    monkeypatch.setenv("FEDERIX_SDK_ROUND_POLL_INTERVAL", "0.2")

    code = example.main(["--shard", "3", "--shards", "10", "--rounds", "1", "--data-dir", str(ROOT / "brain" / "data")])

    assert code == 0
    [entry] = round_updates(backend, round_id)
    assert 1000 < entry.data_size < 20000
    assert entry.utility_score > 0


def test_the_example_rejects_a_bad_shard(capsys):
    example = load_example()
    assert example.main(["--shard", "12", "--shards", "10"]) == 2
    assert "--shard must be between 0 and 9" in capsys.readouterr().err
