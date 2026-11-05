import logging
import tempfile
from dataclasses import asdict
from pathlib import Path

from federix.config import Config
from federix.interfaces import ClientUpdate
from federix.logger import get_logger


def test_config_defaults():
    cfg = Config()
    assert cfg.device == "cpu" and cfg.clients_per_round <= cfg.num_clients
    assert cfg.tau_low < cfg.tau_high and len(cfg.ratios) == 3


def test_client_update_defaults():
    u = ClientUpdate(client_id=1, payload=("dense", None), num_samples=600)
    assert u.utility == 0.0 and u.ratio == 1.0 and "bytes_sent" in asdict(u)


def test_logger_writes_file(tmp_path):
    name = "test_step1"
    log = get_logger(name, str(tmp_path))
    try:
        log.info("logger works")
        for h in log.handlers:
            h.flush()
        assert "logger works" in (tmp_path / f"{name}.log").read_text()
    finally:
        for h in list(log.handlers):
            h.close()
            log.removeHandler(h)
        logging.Logger.manager.loggerDict.pop(name, None)


if __name__ == "__main__":
    test_config_defaults()
    test_client_update_defaults()
    with tempfile.TemporaryDirectory() as d:
        test_logger_writes_file(Path(d))
    print("Step 1 tests passed")
