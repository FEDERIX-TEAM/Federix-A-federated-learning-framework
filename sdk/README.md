# Federix SDK

Python client library for the Federix central server. It speaks the Connect protocol over plain HTTP, so it works
with the server's default HTTP/1.1 mode, and it moves model weights in the framework-neutral FXW1 format.

## Install
    uv sync                      # development: SDK, tests, protobuf codegen and the PyTorch adapter
    pip install federix-sdk      # clients
    pip install 'federix-sdk[torch]'

## Calling the server
```python
from federix_sdk import FederixApi, ConnectError, Code

with FederixApi("http://127.0.0.1:4000") as api:
    print(api.system.health_check().status)

    login = api.auth.admin_login(email="admin@example.com", password="...")
    api.access_token = login.access_token

    for user in api.admin.list_users():        # server streams are iterators
        print(user.email)

    try:
        api.auth.admin_login(email="admin@example.com", password="wrong")
    except ConnectError as err:
        assert err.code is Code.UNAUTHENTICATED
```
Every service in `backend/proto` is available as `api.auth`, `api.client`, `api.admin`, `api.system`, `api.fl` and
`api.events`. Methods accept either a request message or keyword fields (nested messages may be dicts) and can be
called by their proto name (`HealthCheck`) or in snake case (`health_check`). Every call takes `timeout=` (seconds)
and `headers=`. The FL server passes `internal_token=` instead of an access token.

Errors are `ConnectError` with a `Code`: server errors keep the server's code and message, a timeout is
`DEADLINE_EXCEEDED`, a server that cannot be reached is `UNAVAILABLE`, and an unknown RPC is `UNIMPLEMENTED`.

## Model weights
Weights travel as a flat float32 vector plus a `ModelSpec` (ordered `(name, shape, dtype)` with a sha256), encoded
with `encode`/`decode` in the FXW1 format and compressed with top-k (`compress`, `ErrorFeedback`). The format and
its exact bytes are specified in `spec/codec_vectors.json`, shared with the brain.

Framework code lives behind `ModelAdapter` (`spec()`, `get_weights()`, `set_weights()`). `TorchAdapter` in
`federix_sdk.adapters.pytorch` is the first adapter; other frameworks plug in the same way.

## Regenerating the protobuf code
After changing `backend/proto`:

    uv run python scripts/generate_protos.py

The generated files in `src/federix_sdk/_gen` are committed.

## Tests
    uv run pytest

The tests start the real backend (`node backend/src/index.js`) with a throwaway MongoDB database and Redis DB 15,
so MongoDB and Redis must be running (`cd backend && docker compose up -d mongo redis`). Override the addresses with
`FEDERIX_TEST_MONGO` and `FEDERIX_TEST_REDIS`.
