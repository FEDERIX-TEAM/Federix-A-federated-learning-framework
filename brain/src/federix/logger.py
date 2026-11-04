import logging, os

def get_logger(name="federix", log_dir="logs"):
    """Logs to console AND logs/<name>.log. Safe to call many times."""
    log = logging.getLogger(name)
    if not log.handlers:
        os.makedirs(log_dir, exist_ok=True)
        log.setLevel(logging.INFO)
        fmt = logging.Formatter("%(asctime)s | %(message)s", "%H:%M:%S")
        for h in (logging.StreamHandler(), logging.FileHandler(f"{log_dir}/{name}.log", mode="w")):
            h.setFormatter(fmt)
            log.addHandler(h)
    return log
