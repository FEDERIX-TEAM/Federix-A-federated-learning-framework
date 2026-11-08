import json
import os
import stat
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path


class CredentialsError(Exception):
    pass


@dataclass(frozen=True)
class Credentials:
    server_url: str
    client_id: str
    api_key: str


class CredentialStore:
    def __init__(self, path):
        self.path = Path(path).expanduser()

    def _read_all(self):
        if not self.path.exists():
            return {}
        mode = stat.S_IMODE(self.path.stat().st_mode)
        if mode & 0o077:
            raise CredentialsError(
                f"{self.path} can be read by other users (mode {oct(mode)}); run: chmod 600 {self.path}"
            )
        try:
            data = json.loads(self.path.read_text())
        except ValueError as err:
            raise CredentialsError(f"{self.path} is not valid JSON: {err}") from None
        if not isinstance(data, dict):
            raise CredentialsError(f"{self.path} must contain a JSON object")
        return data

    def load(self, server_url):
        entry = self._read_all().get(server_url.rstrip("/"))
        if not entry:
            return None
        try:
            return Credentials(server_url=server_url.rstrip("/"), client_id=entry["client_id"], api_key=entry["api_key"])
        except (KeyError, TypeError):
            raise CredentialsError(f"{self.path} has an incomplete entry for {server_url}") from None

    def save(self, creds):
        data = self._read_all()
        entry = asdict(creds)
        data[entry.pop("server_url")] = entry
        self._write(data)

    def forget(self, server_url):
        data = self._read_all()
        if data.pop(server_url.rstrip("/"), None) is not None:
            self._write(data)

    def _write(self, data):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".credentials-")
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh, indent=2)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
