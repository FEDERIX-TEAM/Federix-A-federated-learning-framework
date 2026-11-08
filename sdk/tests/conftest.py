import os

os.environ.setdefault("KERAS_BACKEND", "jax")

import pytest

from federix_sdk.testing import Backend, start_backend


@pytest.fixture(scope="session")
def backend():
    with start_backend() as b:
        yield b


@pytest.fixture(scope="module")
def short_token_backend():
    with start_backend({"JWT_ACCESS_EXPIRES_IN": "2s"}) as b:
        yield b
