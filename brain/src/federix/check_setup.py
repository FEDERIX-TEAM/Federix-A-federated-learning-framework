import sys

from federix.config import Config, ConfigError, setup_cpu
from federix.logger import get_logger

try:
    cfg = Config.load()
except ConfigError as err:
    raise SystemExit(str(err)) from None

log = get_logger("setup", cfg.log_dir, cfg.log_level)
try:
    import numpy
    import torch
    import torchvision
except ImportError as e:
    raise SystemExit(f"Missing package: {e.name}. Run: uv sync") from None

setup_cpu(cfg)
x = torch.randn(256, 256)
log.info(f"python {sys.version.split()[0]} | torch {torch.__version__} | torchvision {torchvision.__version__} | numpy {numpy.__version__}")
log.info(f"CUDA available: {torch.cuda.is_available()} (ignored, running on {cfg.device})")
log.info(f"threads in use: {torch.get_num_threads()} | matmul test sum: {(x @ x).sum().item():.2f}")
log.info("setup OK")
