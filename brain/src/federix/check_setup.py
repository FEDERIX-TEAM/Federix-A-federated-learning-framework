"""Verify the install: uv run python -m federix.check_setup"""
from federix.config import Config, setup_cpu
from federix.logger import get_logger

cfg = Config()
log = get_logger("setup", cfg.log_dir)
try:
    import torch, torchvision, numpy
except ImportError as e:
    raise SystemExit(f"Missing package: {e.name}. Run: uv sync")

setup_cpu(cfg)
x = torch.randn(256, 256)
log.info(f"torch {torch.__version__} | torchvision {torchvision.__version__} | numpy {numpy.__version__}")
log.info(f"CUDA available: {torch.cuda.is_available()} (ignored, running on {cfg.device})")
log.info(f"threads in use: {torch.get_num_threads()} | matmul test sum: {(x @ x).sum().item():.2f}")
log.info("Step 1 setup OK")
