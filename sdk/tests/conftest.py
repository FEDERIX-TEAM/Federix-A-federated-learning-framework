import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"
MONGO_BASE = os.environ.get("FEDERIX_TEST_MONGO", "mongodb://127.0.0.1:27017")
REDIS_URL = os.environ.get("FEDERIX_TEST_REDIS", "redis://127.0.0.1:6379/15")


@dataclass
class Backend:
    base_url: str
    admin_email: str
    admin_password: str
    internal_token: str


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def node(args, env, timeout=60):
    return subprocess.run(["node", *args], cwd=BACKEND, env={**os.environ, **env}, capture_output=True, text=True, timeout=timeout)


@contextmanager
def start_backend(extra_env=None):
    if shutil.which("node") is None:
        raise RuntimeError("node is required to run the SDK tests against the real backend")
    db = f"federix_sdktest_{os.getpid()}_{secrets.token_hex(4)}"
    mongo_uri = f"{MONGO_BASE}/{db}"
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    storage = tempfile.mkdtemp(prefix="federix-sdk-storage-")
    admin = {"email": f"admin_{secrets.token_hex(4)}@federix.test", "password": f"Pw_{secrets.token_hex(8)}"}
    internal = f"test_internal_{secrets.token_hex(12)}"

    seeded = node(["scripts/seed-super-admin.js"], {
        "MONGO_URI": mongo_uri, "SEED_EMAIL": admin["email"], "SEED_NAME": "SDK Test", "SEED_PASSWORD": admin["password"],
    })
    if seeded.returncode != 0:
        raise RuntimeError(f"could not seed the backend database (is MongoDB running?):\n{seeded.stdout}{seeded.stderr}")

    env = {
        **os.environ,
        "NODE_ENV": "test", "HOST": "127.0.0.1", "PORT": str(port), "MONGO_URI": mongo_uri, "REDIS_URL": REDIS_URL,
        "INTERNAL_SERVICE_TOKEN": internal, "PUBLIC_BASE_URL": base_url, "STORAGE_DIR": storage,
        "LOG_LEVEL": "warn", "SCHEDULER_INTERVAL_MS": "3600000", "RATE_LIMIT_ENABLED": "false",
        **(extra_env or {}),
    }
    proc = subprocess.Popen(["node", "src/index.js"], cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.time() + 20
        while True:
            if proc.poll() is not None:
                raise RuntimeError(f"backend exited with {proc.returncode}:\n{proc.stderr.read()}")
            try:
                r = httpx.post(f"{base_url}/federix.v1.SystemService/HealthCheck", json={}, timeout=1)
                if r.status_code == 200 and r.json().get("db") == "connected":
                    break
            except httpx.TransportError:
                pass
            if time.time() > deadline:
                raise RuntimeError("backend did not become healthy within 20s")
            time.sleep(0.15)
        yield Backend(base_url, admin["email"], admin["password"], internal)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        node(["-e", "import('mongoose').then(async ({default: m}) => { await m.connect(process.env.MONGO_URI); await m.connection.dropDatabase(); await m.disconnect(); })"],
             {"MONGO_URI": mongo_uri})
        shutil.rmtree(storage, ignore_errors=True)


@pytest.fixture(scope="session")
def backend():
    with start_backend() as b:
        yield b


@pytest.fixture(scope="module")
def short_token_backend():
    with start_backend({"JWT_ACCESS_EXPIRES_IN": "2s"}) as b:
        yield b
