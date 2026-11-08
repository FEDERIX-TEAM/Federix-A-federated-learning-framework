# Federix SDK

Python client library for the Federix central server. It speaks the Connect protocol over plain HTTP, so it works
with the server's default HTTP/1.1 mode, and it moves model weights in the framework-neutral FXW1 format.

## Install
    uv sync                      # development: SDK, tests, protobuf codegen and the PyTorch adapter
    pip install federix-sdk              # clients
    pip install 'federix-sdk[torch]'     # PyTorch adapter and trainer
    pip install 'federix-sdk[keras]'     # Keras 3 adapter and trainer (JAX backend)
    pip install 'federix-sdk[jax]'       # JAX adapter and trainer (any pytree: Flax, Haiku, plain JAX)

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

## Running as a client
```python
from federix_sdk import ClientSettings, Heartbeat, Session

settings = ClientSettings.load(server_url="https://fl.example.com", enrollment_token="fdx_enroll_...")
with Session(settings) as session:                 # enrolls once, then logs in with the saved API key
    status = session.api.client.get_status()
    session.api.client.join_round(round_id=rid, local_data_size=5000)
    with Heartbeat(session, rid):                  # background heartbeats until the block ends
        ...
```
- **Enrollment:** the first start registers with the enrollment token an admin gave you and saves `client_id` and
  `api_key` to `~/.federix/credentials.json` (one entry per server, file `0600`, folder `0700`, written atomically).
  Later starts reuse it; the token is not needed again. A credentials file other users can read is refused.
- **Tokens:** access tokens are refreshed shortly before they expire (`refresh_margin`), and a call that comes back
  `UNAUTHENTICATED` is refreshed and retried once. If the session ended (logout elsewhere, a flushed cache), the SDK
  logs in again with the API key. Only one thread refreshes at a time, so concurrent calls never look like a reused
  refresh token to the server.
- **Errors you may need to handle:** `EnrollmentRequired` (no token and the server requires one),
  `CredentialsRejected` (the API key was rotated or the client deleted: remove its entry and enroll again), and
  `ConnectError` with `Code.PERMISSION_DENIED` when the client is banned.
- **Heartbeat:** `Heartbeat` beats once immediately and then every `heartbeat_interval` seconds on a daemon thread,
  counts `sent` and `failures`, and stops itself when the server refuses it (for example after a ban).

### Settings
`ClientSettings.load(**overrides)` reads `FEDERIX_SDK_<SETTING>` environment variables, then the arguments you
pass; values are validated and unknown names are refused.

| Setting | Default | What it controls |
|---|---|---|
| `server_url` | `http://127.0.0.1:4000` | Central server address |
| `credentials_path` | `~/.federix/credentials.json` | Where the client identity is kept |
| `client_name` / `platform` | `federix-client` / detected | Reported when enrolling |
| `enrollment_token` | empty | Needed only for the first start |
| `request_timeout` / `connect_timeout` | 30 / 10 | Seconds per call / to connect |
| `heartbeat_interval` | 20 | Seconds between heartbeats (the server drops a participant after `HEARTBEAT_TIMEOUT_MS`) |
| `refresh_margin` | 30 | Refresh the access token when it has less than this many seconds left |
| `chunk_size_bytes` / `transfer_retries` / `transfer_timeout` | 1048576 / 5 / 120 | Upload chunk size, retries after a dropped connection, seconds per transfer request |
| `round_poll_interval` | 5 | Seconds between checks for a new round in `run()` |

## Taking part in rounds
```python
from federix_sdk import ClientSettings, FederixClient, Session
from federix_sdk.trainers.pytorch import TorchFedProxTrainer

trainer = TorchFedProxTrainer(model, train_data, held_out_data, lr=0.05)
with Session(ClientSettings.load()) as session, FederixClient(session, trainer) as client:
    client.run()                      # wait for rounds and take part in each one; max_rounds= to stop early
```
For every round `FederixClient.run_round(round_id)`:
1. joins with `local_data_size` and starts the heartbeat;
2. downloads the global model (resuming with `Range`), checks its model spec against the local model
   (`ModelMismatch` if the federation uses a different architecture) and loads the weights;
3. trains with the server's `mu`, `local_epochs` and `batch_size`; losses are measured on the client's held-out data;
4. sends its metrics with `PrepareUpdate`, and stops there if the server rejects the update;
5. compresses `trained − global` to the ratio the server returned (top-k with error feedback), encodes FXW1;
6. uploads in `chunk_size_bytes` chunks, continuing from the server's offset after a failure and refreshing an
   expired URL; checks the server's sha256;
7. calls `SubmitUpdate` with the sha256 and returns a `RoundOutcome` (`submitted`, `rejected` or `skipped`, bytes
   sent, utility, ratio, losses, timings).

A trainer for any framework implements `Trainer`: an `adapter` (`ModelAdapter`), `num_samples()`,
`label_counts()` and `train(config) -> TrainResult(loss_before, loss_after)`. The SDK does the rest.

## Several frameworks in one federation
Clients may train with PyTorch, Keras or JAX in the same federation. What has to match is the model, written as
one canonical layout: an ordered list of parameter names and shapes. The canonical layout is whatever the global
model was built with (usually the PyTorch names, e.g. `1.weight` with shape `(out, in)`). A client in another
framework passes a `Layout` that maps each canonical parameter to its own parameter, transposing where the
framework stores the matrix the other way round:

```python
from federix_sdk import Layout
from federix_sdk.trainers.keras import KerasFedProxTrainer
from federix_sdk.trainers.jax import JaxFedProxTrainer

keras_layout = Layout([
    ("1.weight", "hidden/kernel", True),      # Keras Dense kernels are (in, out)
    ("1.bias", "hidden/bias"),
    ("3.weight", "out/kernel", True),
    ("3.bias", "out/bias"),
])
trainer = KerasFedProxTrainer(keras_model, (x_train, y_train), (x_val, y_val), layout=keras_layout)

jax_layout = Layout([("1.weight", "['hidden']['w']", True), ("1.bias", "['hidden']['b']"),
                     ("3.weight", "['out']['w']", True), ("3.bias", "['out']['b']")])
trainer = JaxFedProxTrainer(params, apply_fn, (x_train, y_train), (x_val, y_val), layout=jax_layout)
```
With the layout, the adapter's model spec hash equals the federation's, so the download check passes, and the
same weights give the same outputs in every framework. Every local parameter must appear exactly once; mistakes
(unknown names, unmapped parameters, transposing a non-matrix) are reported when the adapter is created. Local
parameter names are PyTorch's `named_parameters()`, Keras's `weight.path` (including non-trainable weights such as
BatchNorm statistics) and JAX's `jax.tree_util.keystr` paths.

| Framework | Adapter | Trainer | Notes |
|---|---|---|---|
| PyTorch | `TorchAdapter` | `TorchFedProxTrainer` | |
| Keras 3 | `KerasAdapter` | `KerasFedProxTrainer` | The trainer needs `KERAS_BACKEND=jax`; with another backend use `KerasAdapter` with your own `Trainer`. The model must output logits. |
| JAX | `JaxAdapter` | `JaxFedProxTrainer` | Works on any pytree of float32 arrays; `apply_fn(params, x)` returns logits. |

All trainers apply the FedProx term exactly. Keep `lr * mu` well below 2: plain SGD on the proximal term diverges
above that, and the trainers log a warning when it happens. Only float32 parameters are supported.
TensorFlow is not tested yet: on Python 3.14 only a pre-release is available.

### Example
    FEDERIX_SDK_SERVER_URL=http://127.0.0.1:4000 FEDERIX_SDK_ENROLLMENT_TOKEN=fdx_enroll_... \
        uv run python examples/mnist_client.py --shard 0 --shards 10 --rounds 3

Each client owns a label-skewed slice of MNIST (`--alpha`) and trains the same MLP as the brain.

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

`federix_sdk.testing.start_backend(extra_env, db_prefix)` is the harness behind these tests: it seeds an admin,
starts the backend on a free port and removes its database and storage afterwards. The brain's FL server tests
use it too.
