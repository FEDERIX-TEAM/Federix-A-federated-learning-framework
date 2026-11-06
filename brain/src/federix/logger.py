import logging
import os
from datetime import datetime


def get_logger(name="federix", log_dir="logs", level="INFO"):
    log = logging.getLogger(name)
    if not log.handlers:
        os.makedirs(log_dir, exist_ok=True)
        log.setLevel(level)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = os.path.join(log_dir, f"{name}-{stamp}-{os.getpid()}.log")
        fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%H:%M:%S")
        for h in (logging.StreamHandler(), logging.FileHandler(path, mode="a")):
            h.setFormatter(fmt)
            log.addHandler(h)
        log.log_path = path
    return log
