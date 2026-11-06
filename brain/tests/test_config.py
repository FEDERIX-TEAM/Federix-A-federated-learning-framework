import pytest

from federix.config import Config, ConfigError


def test_defaults_are_valid_and_match_the_backend():
    cfg = Config.load(env={})
    assert cfg.device == "cpu"
    assert (cfg.mu, cfg.local_epochs, cfg.batch_size) == (0.01, 3, 32)
    assert (cfg.tau_high, cfg.tau_low) == (0.8, 0.2)
    assert cfg.ratios == (1.0, 0.5, 0.1)
    assert (cfg.a, cfg.b, cfg.c, cfg.temperature) == (1.0, 0.5, 0.3, 1.0)


def test_file_then_env_then_overrides(tmp_path):
    f = tmp_path / "federix.toml"
    f.write_text('rounds = 7\nmu = 0.5\nlr = 0.1\nratios = [1.0, 0.4, 0.05]\nlog_level = "DEBUG"\n')
    env = {"FEDERIX_MU": "0.2", "FEDERIX_NUM_CLIENTS": "20"}
    cfg = Config.load(path=str(f), env=env, overrides=["lr=0.3"])
    assert cfg.rounds == 7
    assert cfg.mu == 0.2
    assert cfg.lr == 0.3
    assert cfg.num_clients == 20
    assert cfg.ratios == (1.0, 0.4, 0.05)
    assert cfg.log_level == "DEBUG"


def test_config_file_can_come_from_the_environment(tmp_path):
    f = tmp_path / "x.toml"
    f.write_text("rounds = 3\n")
    assert Config.load(env={"FEDERIX_CONFIG": str(f)}).rounds == 3


def test_ratios_from_env_are_comma_separated():
    assert Config.load(env={"FEDERIX_RATIOS": "1,0.6,0.2"}).ratios == (1.0, 0.6, 0.2)


def test_every_problem_is_reported_at_once():
    with pytest.raises(ConfigError) as info:
        Config.load(env={
            "FEDERIX_NUM_CLIENTS": "3",
            "FEDERIX_CLIENTS_PER_ROUND": "5",
            "FEDERIX_LR": "-1",
            "FEDERIX_VAL_FRACTION": "1.5",
            "FEDERIX_TAU_LOW": "0.9",
            "FEDERIX_RATIOS": "0.1,0.5,1.0",
            "FEDERIX_LOG_LEVEL": "LOUD",
        })
    text = str(info.value)
    for expected in (
        "clients_per_round (5) must not be greater than num_clients (3)",
        "lr must be > 0",
        "val_fraction must be between 0 and 1",
        "0 <= tau_low <= tau_high <= 1",
        "ratios must be ordered high >= medium >= low",
        "log_level must be one of",
    ):
        assert expected in text, expected
    assert len(info.value.problems) == 6


def test_type_errors_name_the_setting():
    with pytest.raises(ConfigError) as info:
        Config.load(env={"FEDERIX_ROUNDS": "abc", "FEDERIX_MU": "nan", "FEDERIX_NUM_CLIENTS": "2.5"})
    text = str(info.value)
    assert "rounds: expected an integer" in text
    assert "mu: expected a finite number" in text
    assert "num_clients: expected an integer" in text


def test_unknown_keys_are_refused(tmp_path):
    f = tmp_path / "bad.toml"
    f.write_text("roundz = 3\n")
    with pytest.raises(ConfigError, match="unknown setting 'roundz'"):
        Config.load(path=str(f), env={})
    with pytest.raises(ConfigError, match="key=value with a known key"):
        Config.load(env={}, overrides=["nonsense"])
    with pytest.raises(ConfigError, match="does not exist"):
        Config.load(path=str(tmp_path / "missing.toml"), env={})


def test_empty_env_values_are_ignored():
    assert Config.load(env={"FEDERIX_ROUNDS": "  "}).rounds == 20
