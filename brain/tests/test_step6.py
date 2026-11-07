import csv
import logging

import numpy as np
import pytest

from federix.aggregation import aggregate, sample_weights, utility_weights
from federix.config import Config, ConfigError
from federix.experiment import ROUND_FIELDS, SUMMARY_FIELDS, run_experiment
from federix.main import run
from federix.validation import validate_updates


def quiet(name):
    log = logging.getLogger(name)
    log.handlers.clear()
    log.addHandler(logging.NullHandler())
    log.propagate = False
    return log


def small(tmp_path, **kw):
    base = dict(num_clients=6, clients_per_round=6, rounds=3, local_epochs=1, batch_size=32, dirichlet_alpha=1.0,
                min_client_samples=20, server_holdout_size=150, log_dir=str(tmp_path))
    return Config(**{**base, **kw}).validate()


def test_utility_weights_follow_n_times_exp_u_over_t():
    w = utility_weights([100, 100, 200], [0.2, 0.8, 0.5], 0.5)
    raw = np.array([100 * np.exp(0.4), 100 * np.exp(1.6), 200 * np.exp(1.0)])
    np.testing.assert_allclose(w, raw / raw.sum())
    assert abs(w.sum() - 1) < 1e-12


def test_a_high_temperature_turns_utility_weighting_into_fedprox():
    n, u = [50, 150, 300], [0.1, 0.9, 0.4]
    np.testing.assert_allclose(utility_weights(n, u, 1e9), sample_weights(n), atol=1e-8)
    favoured = utility_weights(n, u, 0.05)
    assert favoured.argmax() == 1


def test_utility_weights_do_not_overflow():
    w = utility_weights([1, 1], [1.0, 0.0], 1e-6)
    assert np.all(np.isfinite(w)) and abs(w[0] - 1) < 1e-12


def test_aggregation_rejects_bad_input():
    with pytest.raises(ValueError):
        sample_weights([10, 0])
    with pytest.raises(ValueError):
        utility_weights([10], [0.5, 0.2], 1.0)
    with pytest.raises(ValueError):
        utility_weights([10], [0.5], 0)
    with pytest.raises(ValueError, match="shape"):
        aggregate(np.zeros(3), [np.ones(4)], [1.0])
    with pytest.raises(ValueError, match="one weight per delta"):
        aggregate(np.zeros(3), [np.ones(3)], [0.5, 0.5])


def test_norm_check_rejects_an_outlier_and_keeps_the_rest():
    cfg = Config(holdout_check=False, max_update_norm_factor=5.0)
    rng = np.random.default_rng(0)
    deltas = [rng.normal(size=100).astype(np.float32) for _ in range(4)] + [rng.normal(size=100).astype(np.float32) * 50]
    verdicts = validate_updates(np.zeros(100, dtype=np.float32), deltas, cfg)
    assert [v.accepted for v in verdicts] == [True, True, True, True, False]
    assert "round median" in verdicts[-1].reason


def test_norm_check_needs_three_updates_and_can_be_switched_off():
    big = [np.ones(10, dtype=np.float32), np.ones(10, dtype=np.float32) * 1000]
    assert all(v.accepted for v in validate_updates(np.zeros(10), big, Config(holdout_check=False)))
    many = [np.ones(10)] * 3 + [np.ones(10) * 1000]
    assert all(v.accepted for v in validate_updates(np.zeros(10), many, Config(holdout_check=False, max_update_norm_factor=0)))


def test_holdout_check_rejects_an_update_that_hurts_the_server_holdout():
    target = np.array([1.0, -2.0, 0.5], dtype=np.float32)
    loss = lambda v: float(np.sum((np.asarray(v) - target) ** 2))
    w = np.zeros(3, dtype=np.float32)
    good, bad = target * 0.5, -target
    verdicts = validate_updates(w, [good, bad], Config(max_update_norm_factor=0, holdout_loss_tolerance=0.25), loss)
    assert verdicts[0].accepted and not verdicts[1].accepted
    assert "the current model" in verdicts[1].reason
    assert all(v.accepted for v in validate_updates(w, [good, bad], Config(max_update_norm_factor=0, holdout_check=False), loss))


def test_with_three_or_more_updates_the_holdout_check_compares_against_the_round_median():
    target = np.zeros(4, dtype=np.float32)
    loss = lambda v: float(np.sum((np.asarray(v) - target) ** 2)) + 1.0
    w = np.zeros(4, dtype=np.float32)
    honest = [np.full(4, x, dtype=np.float32) for x in (0.5, 0.6, 0.7, 0.55)]
    poisoned = np.full(4, 40.0, dtype=np.float32)
    verdicts = validate_updates(w, honest + [poisoned], Config(max_update_norm_factor=0, holdout_loss_tolerance=0.5), loss)
    assert [v.accepted for v in verdicts] == [True, True, True, True, False]
    assert "round median" in verdicts[-1].reason


def test_an_attacker_that_lies_is_stopped_by_the_server_checks(tmp_path, small_datasets):
    common = dict(attackers=1, attack="sign_flip", attack_scale=30.0)
    unprotected = run(small(tmp_path, validate_updates=False, **common), datasets=small_datasets, log=quiet("a"))
    protected = run(small(tmp_path, **common), datasets=small_datasets, log=quiet("b"))
    clean = run(small(tmp_path), datasets=small_datasets, log=quiet("c"))
    assert protected["rejected"] >= 3
    assert protected["loss"] < unprotected["loss"]
    assert protected["acc"] >= unprotected["acc"]
    assert abs(protected["acc"] - clean["acc"]) <= 0.1


def test_a_clean_run_rejects_nothing(tmp_path, small_datasets):
    assert run(small(tmp_path), datasets=small_datasets, log=quiet("d"))["rejected"] == 0


def test_run_history_has_one_row_per_round(tmp_path, small_datasets):
    result = run(small(tmp_path, rounds=4), datasets=small_datasets, log=quiet("e"))
    assert [h["round"] for h in result["history"]] == [0, 1, 2, 3, 4]
    assert result["history"][-1]["acc"] == result["acc"]
    assert result["history"][-1]["cum_mb"] == pytest.approx(result["MB"])


def test_new_settings_are_validated():
    with pytest.raises(ConfigError) as info:
        Config.load(env={"FEDERIX_AGGREGATION": "mean", "FEDERIX_ATTACK": "dos", "FEDERIX_ATTACKERS": "99",
                         "FEDERIX_ATTACK_SCALE": "0", "FEDERIX_MAX_UPDATE_NORM_FACTOR": "-1"})
    text = str(info.value)
    for expected in ("aggregation must be one of utility, fedprox", "attack must be one of", "attackers must be within",
                     "attack_scale must be > 0", "max_update_norm_factor must be >= 0"):
        assert expected in text


def test_the_experiment_runner_writes_per_round_and_summary_results(tmp_path, small_datasets):
    out = tmp_path / "exp"
    base = ["num_clients=4", "clients_per_round=2", "rounds=2", "local_epochs=1", "dirichlet_alpha=1.0",
            "min_client_samples=20", "server_holdout_size=100", f"log_dir={tmp_path}"]
    summaries = run_experiment(["fedprox", "federix"], [0, 1], base, out, datasets=small_datasets, progress=lambda _: None)

    rows = list(csv.DictReader((out / "rounds.csv").open()))
    assert list(rows[0]) == ROUND_FIELDS
    assert len(rows) == 2 * 2 * 3
    assert {r["variant"] for r in rows} == {"fedprox", "federix"}

    summary = list(csv.DictReader((out / "summary.csv").open()))
    assert list(summary[0]) == SUMMARY_FIELDS
    by = {s["variant"]: s for s in summaries}
    assert by["fedprox"]["saved_pct"] == 0
    assert by["federix"]["seeds"] == 2
    assert (out / "summary.md").read_text().startswith("| variant |")
    assert (out / "logs" / "federix-seed1.log").exists()
    assert "fedprox/seed=0" in (out / "config.json").read_text()


def test_the_experiment_runner_refuses_unknown_variants(tmp_path):
    with pytest.raises(ConfigError, match="unknown variant"):
        run_experiment(["fedavg"], [0], [], tmp_path / "x", datasets=(None, None))
