import numpy as np

from federix.config import Config, ConfigError, setup_cpu
from federix.data import load_mnist, make_clients
from federix.logger import get_logger
from federix.model import make_model

try:
    cfg = Config.load()
except ConfigError as err:
    raise SystemExit(str(err)) from None

log = get_logger("data", cfg.log_dir, cfg.log_level)
setup_cpu(cfg)
train, test = load_mnist(cfg.data_dir)
clients = make_clients(train, cfg)
labels = train.tensors[1].numpy()
log.info(f"train={len(train)} test={len(test)} clients={len(clients)} alpha={cfg.dirichlet_alpha} val_fraction={cfg.val_fraction}")
log.info("client | train | held-out | samples per digit 0..9")
for k, c in enumerate(clients):
    counts = np.bincount(labels[np.concatenate([c.train.indices, c.val.indices])], minlength=10)
    log.info(f"{k:>6} | {len(c.train):>5} | {len(c.val):>8} | {counts.tolist()}")
log.info(f"model params: {sum(p.numel() for p in make_model().parameters()):,}")
