import os
from dataclasses import dataclass, fields
from pathlib import Path

ENV_PREFIX = "FEDERIX_SDK_"


class SettingsError(ValueError):
    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("Invalid SDK settings:\n  - " + "\n  - ".join(self.problems))


def _default_credentials_path():
    return str(Path.home() / ".federix" / "credentials.json")


@dataclass
class ClientSettings:
    server_url: str = "http://127.0.0.1:4000"
    credentials_path: str = ""
    client_name: str = "federix-client"
    platform: str = ""
    enrollment_token: str = ""
    request_timeout: float = 30.0
    connect_timeout: float = 10.0
    heartbeat_interval: float = 20.0
    refresh_margin: float = 30.0
    chunk_size_bytes: float = 1048576.0
    transfer_retries: float = 5.0
    transfer_timeout: float = 120.0
    round_poll_interval: float = 5.0

    def __post_init__(self):
        if not self.credentials_path:
            self.credentials_path = _default_credentials_path()
        if not self.platform:
            import platform as _platform

            self.platform = f"{_platform.system().lower()}-{_platform.machine().lower()}"

    def validate(self):
        problems = []
        if not self.server_url.startswith(("http://", "https://")):
            problems.append(f"server_url must start with http:// or https:// (got {self.server_url!r})")
        if not self.client_name.strip() or len(self.client_name) > 100:
            problems.append("client_name must be 1-100 characters")
        for name in ("request_timeout", "connect_timeout", "heartbeat_interval"):
            if getattr(self, name) <= 0:
                problems.append(f"{name} must be > 0 (got {getattr(self, name)})")
        if self.refresh_margin < 0:
            problems.append(f"refresh_margin must be >= 0 (got {self.refresh_margin})")
        if self.chunk_size_bytes < 1024 or self.chunk_size_bytes != int(self.chunk_size_bytes):
            problems.append(f"chunk_size_bytes must be a whole number >= 1024 (got {self.chunk_size_bytes})")
        if self.transfer_retries < 0 or self.transfer_retries != int(self.transfer_retries):
            problems.append(f"transfer_retries must be a whole number >= 0 (got {self.transfer_retries})")
        for name in ("transfer_timeout", "round_poll_interval"):
            if getattr(self, name) <= 0:
                problems.append(f"{name} must be > 0 (got {getattr(self, name)})")
        if problems:
            raise SettingsError(problems)
        self.server_url = self.server_url.rstrip("/")
        return self

    @classmethod
    def load(cls, env=None, **overrides):
        env = os.environ if env is None else env
        known = {f.name: f for f in fields(cls)}
        unknown = [k for k in overrides if k not in known]
        if unknown:
            raise SettingsError([f"unknown setting {k!r}" for k in unknown])
        values, problems = {}, []
        for name, f in known.items():
            raw = env.get(f"{ENV_PREFIX}{name.upper()}")
            if raw is not None and raw.strip():
                values[name] = raw.strip()
        values.update({k: v for k, v in overrides.items() if v is not None})
        for name, value in list(values.items()):
            if isinstance(known[name].default, float):
                try:
                    values[name] = float(value)
                except (TypeError, ValueError):
                    problems.append(f"{name}: expected a number (got {value!r})")
        if problems:
            raise SettingsError(problems)
        return cls(**values).validate()
