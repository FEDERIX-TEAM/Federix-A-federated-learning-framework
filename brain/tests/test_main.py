import logging

import pytest

from federix.config import Config
from federix.main import main, run


def quiet_logger(tmp_path):
    log = logging.getLogger(f"test-main-{tmp_path.name}")
    log.handlers.clear()
    log.addHandler(logging.NullHandler())
    return log


def small_cfg(tmp_path, **kw):
    base = dict(num_clients=4, clients_per_round=2, rounds=2, local_epochs=1, batch_size=32, dirichlet_alpha=1.0,
                min_client_samples=20, log_dir=str(tmp_path))
    return Config(**{**base, **kw}).validate()


def test_zero_rounds_returns_the_initial_model_metrics(tmp_path, small_datasets):
    result = run(small_cfg(tmp_path, rounds=0), datasets=small_datasets, log=quiet_logger(tmp_path))
    assert set(result) >= {"acc", "loss", "MB", "rounds_with_updates"}
    assert result["MB"] == 0 and result["rounds_with_updates"] == 0


def test_a_short_run_trains_and_improves(tmp_path, small_datasets):
    start = run(small_cfg(tmp_path, rounds=0), datasets=small_datasets, log=quiet_logger(tmp_path))
    end = run(small_cfg(tmp_path, rounds=3, clients_per_round=4), datasets=small_datasets, log=quiet_logger(tmp_path))
    assert end["rounds_with_updates"] == 3
    assert end["MB"] > 0
    assert end["loss"] < start["loss"]
    assert end["acc"] > start["acc"]


def test_runs_with_the_same_seed_are_identical(tmp_path, small_datasets):
    a = run(small_cfg(tmp_path), datasets=small_datasets, log=quiet_logger(tmp_path))
    b = run(small_cfg(tmp_path), datasets=small_datasets, log=quiet_logger(tmp_path))
    assert a == b


def test_cli_rejects_bad_settings_with_exit_code_2(capsys):
    assert main(["--set", "lr=-1", "--set", "clients_per_round=99"]) == 2
    err = capsys.readouterr().err
    assert "lr must be > 0" in err and "clients_per_round (99)" in err


def test_cli_rejects_unknown_keys(capsys):
    assert main(["--set", "nope=1"]) == 2
    assert "known key" in capsys.readouterr().err


def test_a_run_scores_every_update(tmp_path, small_datasets):
    result = run(small_cfg(tmp_path, rounds=2), datasets=small_datasets, log=quiet_logger(tmp_path))
    assert 0 < result["mean_utility"] <= 1
