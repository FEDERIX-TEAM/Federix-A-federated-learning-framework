import numpy as np
from federix.config import Config, setup_cpu
from federix.logger import get_logger
from federix.data import load_mnist, make_clients
from federix.model import make_model
 
cfg = Config()
log = get_logger("data", cfg.log_dir)
setup_cpu(cfg)
train, test = load_mnist(cfg.data_dir)
clients = make_clients(train, cfg)
log.info(f"train={len(train)} test={len(test)} clients={len(clients)} alpha={cfg.dirichlet_alpha}")
log.info("client | samples | samples per digit 0..9")
for k, c in enumerate(clients):
    counts = np.bincount(train.tensors[1][c.indices].numpy(), minlength=10)
    log.info(f"{k:>6} | {len(c):>7} | {counts.tolist()}")
log.info(f"model params: {sum(p.numel() for p in make_model().parameters()):,}")
log.info("Step 2 data OK")