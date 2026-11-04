"""Run: uv run python tests/test_step1.py  (does not need torch)"""
import shutil
from dataclasses import asdict
from federix.config import Config
from federix.interfaces import ClientUpdate
from federix.logger import get_logger

cfg = Config()
assert cfg.device == "cpu" and cfg.clients_per_round <= cfg.num_clients
assert cfg.tau_low < cfg.tau_high and len(cfg.ratios) == 3

u = ClientUpdate(client_id=1, payload=("dense", None), num_samples=600)
assert u.utility == 0.0 and u.ratio == 1.0 and "bytes_sent" in asdict(u)

log = get_logger("test", "logs_test")
log.info("logger works")
assert "logger works" in open("logs_test/test.log").read()
shutil.rmtree("logs_test", ignore_errors=True)
print("Step 1 tests passed")
