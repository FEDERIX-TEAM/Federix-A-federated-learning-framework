import dataclasses
import os
import tomllib
from dataclasses import dataclass, fields
from pathlib import Path

ENV_PREFIX = "FEDERIX_"
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


class ConfigError(ValueError):
    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("Invalid configuration:\n  - " + "\n  - ".join(self.problems))


@dataclass
class Config:
    device: str = "cpu"
    num_threads: int = 4
    num_clients: int = 10
    clients_per_round: int = 5
    rounds: int = 20
    local_epochs: int = 3
    batch_size: int = 32
    lr: float = 0.05
    dirichlet_alpha: float = 0.1
    min_client_samples: int = 10
    split_max_attempts: int = 1000
    val_fraction: float = 0.2
    eval_batch_size: int = 1024
    data_dir: str = "data"
    mu: float = 0.01
    a: float = 1.0
    b: float = 0.5
    c: float = 0.3
    eps: float = 1e-8
    size_saturation: float = 500.0
    num_classes: int = 10
    reject_below: float = 0.0
    tau_high: float = 0.8
    tau_low: float = 0.2
    ratios: tuple = (1.0, 0.5, 0.1)
    temperature: float = 1.0
    compression: bool = True
    error_feedback: bool = True
    seed: int = 0
    log_dir: str = "logs"
    log_level: str = "INFO"

    def __post_init__(self):
        if isinstance(self.ratios, list):
            self.ratios = tuple(self.ratios)

    def validate(self):
        problems = []

        def need(cond, msg):
            if not cond:
                problems.append(msg)

        need(self.device == "cpu", f"device must be 'cpu' (got {self.device!r})")
        for name in ("num_threads", "num_clients", "clients_per_round", "local_epochs", "batch_size",
                     "min_client_samples", "split_max_attempts", "eval_batch_size"):
            need(getattr(self, name) >= 1, f"{name} must be >= 1 (got {getattr(self, name)})")
        need(self.rounds >= 0, f"rounds must be >= 0 (got {self.rounds})")
        need(self.seed >= 0, f"seed must be >= 0 (got {self.seed})")
        need(self.clients_per_round <= self.num_clients,
             f"clients_per_round ({self.clients_per_round}) must not be greater than num_clients ({self.num_clients})")
        for name in ("lr", "dirichlet_alpha", "eps", "temperature"):
            need(getattr(self, name) > 0, f"{name} must be > 0 (got {getattr(self, name)})")
        need(0 < self.val_fraction < 1, f"val_fraction must be between 0 and 1 (got {self.val_fraction})")
        need(self.mu >= 0, f"mu must be >= 0 (got {self.mu})")
        for name in ("a", "b", "c"):
            need(getattr(self, name) >= 0, f"{name} must be >= 0 (got {getattr(self, name)})")
        need(self.a + self.b + self.c > 0, "at least one of a, b and c must be > 0")
        need(self.size_saturation > 0, f"size_saturation must be > 0 (got {self.size_saturation})")
        need(self.num_classes >= 2, f"num_classes must be >= 2 (got {self.num_classes})")
        need(0 <= self.reject_below <= self.tau_low,
             f"reject_below must be within [0, tau_low] (got {self.reject_below}, tau_low {self.tau_low})")
        need(0 <= self.tau_low <= self.tau_high <= 1,
             f"thresholds must satisfy 0 <= tau_low <= tau_high <= 1 (got {self.tau_low}, {self.tau_high})")
        need(len(self.ratios) == 3, f"ratios must have exactly 3 values (got {len(self.ratios)})")
        if len(self.ratios) == 3:
            high, medium, low = self.ratios
            need(all(0 < r <= 1 for r in self.ratios), f"every ratio must be within (0, 1] (got {self.ratios})")
            need(high >= medium >= low, f"ratios must be ordered high >= medium >= low (got {self.ratios})")
        need(self.log_level in LOG_LEVELS, f"log_level must be one of {', '.join(LOG_LEVELS)} (got {self.log_level!r})")
        need(bool(self.data_dir), "data_dir must not be empty")
        need(bool(self.log_dir), "log_dir must not be empty")

        if problems:
            raise ConfigError(problems)
        return self

    @classmethod
    def load(cls, path=None, env=None, overrides=None):
        env = os.environ if env is None else env
        values = {}
        problems = []
        known = {f.name: f for f in fields(cls)}

        file_path = path or env.get(f"{ENV_PREFIX}CONFIG")
        if file_path:
            p = Path(file_path)
            if not p.is_file():
                raise ConfigError([f"config file {file_path} does not exist"])
            with p.open("rb") as fh:
                for key, value in tomllib.load(fh).items():
                    if key not in known:
                        problems.append(f"{file_path}: unknown setting {key!r}")
                    else:
                        values[key] = value

        for name in known:
            raw = env.get(f"{ENV_PREFIX}{name.upper()}")
            if raw is not None and raw.strip() != "":
                values[name] = raw

        for item in overrides or []:
            key, sep, raw = item.partition("=")
            key = key.strip()
            if not sep or key not in known:
                problems.append(f"override {item!r} must look like key=value with a known key")
            else:
                values[key] = raw

        converted = {}
        for name, value in values.items():
            try:
                converted[name] = _convert(known[name], value)
            except ValueError as err:
                problems.append(f"{name}: {err}")
        if problems:
            raise ConfigError(problems)
        return cls(**converted).validate()

    def as_dict(self):
        return dataclasses.asdict(self)


def _convert(f, value):
    default = f.default
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in ("true", "1", "yes"):
            return True
        if text in ("false", "0", "no"):
            return False
        raise ValueError(f"expected true or false (got {value!r})")
    if isinstance(default, int):
        if isinstance(value, bool):
            raise ValueError(f"expected an integer (got {value!r})")
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"expected an integer (got {value!r})") from None
        if not number.is_integer():
            raise ValueError(f"expected an integer (got {value!r})")
        return int(number)
    if isinstance(default, float):
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"expected a number (got {value!r})") from None
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError(f"expected a finite number (got {value!r})")
        return number
    if isinstance(default, tuple):
        items = value if isinstance(value, (list, tuple)) else str(value).split(",")
        try:
            return tuple(float(x) for x in items)
        except (TypeError, ValueError):
            raise ValueError(f"expected comma-separated numbers (got {value!r})") from None
    return str(value)


def setup_cpu(cfg: Config):
    import random

    import numpy as np
    import torch

    random.seed(cfg.seed)
    np.random.seed(cfg.seed)
    torch.manual_seed(cfg.seed)
    torch.set_num_threads(cfg.num_threads)
