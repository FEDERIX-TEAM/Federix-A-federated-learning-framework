# Federix — Central Server (gRPC)

The control plane of the Federix federated-learning framework: client registration & auth, round
lifecycle, update intake & utility scoring, the bridge to the FL (aggregation) server, the admin
dashboard API, and a live event stream.

**Stack:** Node 20+ · Fastify 5 · Connect-RPC (`@connectrpc/connect-fastify`, speaks **gRPC, gRPC-Web and
Connect**) · MongoDB + Mongoose · Redis (token blacklist + maintenance flag; auto-falls back to an
in-memory stub in dev) · JWT · bcrypt.

All 6 services / 57 RPCs defined in `proto/` are implemented.

## Quick start

### Docker (easiest)
```bash
docker compose up --build
docker compose exec app sh -c 'SEED_EMAIL=admin@example.com SEED_NAME=Root SEED_PASSWORD=ChangeMe123! npm run seed:super-admin'
```

### Local
```bash
npm install
cp .env.example .env            # edit secrets, MONGO_URI, REDIS_URL
npm run seed:super-admin        # interactive, or pass SEED_EMAIL / SEED_NAME / SEED_PASSWORD
npm start                       # or: npm run dev  (watch mode)
```

Check it's alive:
```bash
curl -s -X POST http://localhost:4000/federix.v1.SystemService/HealthCheck \
  -H 'content-type: application/json' -d '{}'
```

### Verify everything works
With the server running and a super admin seeded:
```bash
SMOKE_ADMIN_EMAIL=admin@example.com SMOKE_ADMIN_PASSWORD=ChangeMe123! npm run smoke
```
`scripts/smoke-test.js` exercises every RPC end to end (auth, RBAC allow/deny, a full round
lifecycle, FL bridge, bans, maintenance mode, event delivery, signed URLs) — **105 checks**. It is also
the best usage example of the API.

## Transports — important for the FL server / SDK

| Setup | Protocols that work | Use for |
|---|---|---|
| default (HTTP/1.1) | Connect (JSON or binary) incl. server streaming | curl, browsers, `@connectrpc/connect-web`, Node clients |
| `HTTP2=true` (h2c) | + **native gRPC** | `grpcio` (Python FL server), grpc-java, `grpcurl -plaintext` |
| `TLS_KEY` + `TLS_CERT` | everything, HTTP/2 over TLS | production |

Endpoints are `POST /<package>.<Service>/<Method>`, e.g. `/federix.v1.AuthService/AdminLogin`.
Auth goes in call metadata: `authorization: Bearer <access_token>`. The FL server instead sends
`x-internal-service-token: <INTERNAL_SERVICE_TOKEN>` (and its IP must be in `FL_SERVER_ALLOWED_IPS`).

```bash
# admin login (Connect protocol, JSON)
curl -s -X POST localhost:4000/federix.v1.AuthService/AdminLogin \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'

# authenticated call
curl -s -X POST localhost:4000/federix.v1.AdminService/GetOverview \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{}'
```
JSON field names are lowerCamelCase (`clientId`, `apiKey`). Server-streaming RPCs return a stream of messages.

## Configuration

Every server setting comes from an environment variable (or `.env`) and is read in one place, `config/index.js`.
Values are validated at startup: if any value is invalid, the server refuses to start and lists every problem.
`.env.example` lists every variable with its default. With `NODE_ENV=production`, the server also refuses
default, short or identical secrets.

Federated-learning behaviour (FedProx `mu`, epochs, batch size, client limits, utility thresholds, compression)
is not set here. It lives in `SystemConfig` in MongoDB, is changed at runtime with `AdminService.UpdateConfig`,
and is frozen per round in `config_snapshot`.

| Variable | Default | Range | What it controls |
|---|---|---|---|
| `NODE_ENV` | `development` | | `production` turns on the secret checks |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | 1–65535 | Listen address |
| `LOG_LEVEL` | `info` | fatal … trace, silent | Server log level |
| `HTTP2` | `false` | true/false | HTTP/2 cleartext for native gRPC clients |
| `TLS_KEY` / `TLS_CERT` | unset | both or neither | HTTP/2 over TLS with HTTP/1.1 fallback |
| `MONGO_URI` / `REDIS_URL` | local defaults | | Required services; the server will not start without them |
| `DB_CONNECT_TIMEOUT_MS` | `3000` | ≥ 100 | Startup connection timeout for MongoDB and Redis |
| `REDIS_BACKOFF_STEP_MS` / `REDIS_MAX_BACKOFF_MS` | `200` / `2000` | ≥ 0 | Redis reconnect delay: step × attempt, capped |
| `REDIS_MAX_RETRIES_PER_REQUEST` | `3` | ≥ 0 | Retries for a Redis command during an outage |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev values | | Token signing secrets |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `7d` | number + s/m/h/d | Token lifetimes |
| `BCRYPT_ROUNDS` | `10` | 4–15 | Cost of password and API-key hashes |
| `MIN_SECRET_LENGTH` | `32` | ≥ 16 | Minimum secret length in production |
| `MIN_PASSWORD_LENGTH` | `8` | ≥ 6 | Minimum admin password length |
| `INTERNAL_SERVICE_TOKEN` | dev value | | Shared secret for the FL server |
| `FL_SERVER_ALLOWED_IPS` | loopback | comma list | IPs allowed to use the internal token |
| `STORAGE_DIR` | `./storage` | | Folder served by signed `/storage/...` URLs |
| `SIGNED_URL_SECRET` | dev value | | HMAC secret for signed URLs |
| `SIGNED_URL_TTL_SECONDS` | `600` | ≥ 1 | Lifetime of signed download URLs |
| `MAX_UPDATE_SIZE_MB` | `256` | ≥ 1 | Maximum update size reported to clients |
| `HEARTBEAT_CHECK_INTERVAL_MS` | `30000` | ≥ 100 | How often missed heartbeats are checked |
| `HEARTBEAT_TIMEOUT_MS` | `90000` | ≥ 100 | Silence after which a participant is dropped |
| `EVENT_PING_INTERVAL_MS` | `30000` | ≥ 100 | Keep-alive ping on the event stream |
| `EVENT_QUEUE_MAX` | `1000` | ≥ 1 | Queued events per slow subscriber before the oldest are dropped |
| `STREAM_AUTH_RECHECK_MS` | `30000` | ≥ 100 | How often an open event stream re-checks its session, token, role and ban state |
| `CLIENT_STATUS_CHECK_INTERVAL_MS` | `60000` | ≥ 100 | How often client statuses and expired bans are updated |
| `CLIENT_IDLE_AFTER_MS` | `300000` | ≥ 100, ≤ disconnected | Silence after which an active client becomes `idle` |
| `CLIENT_DISCONNECTED_AFTER_MS` | `1800000` | ≥ 100 | Silence after which a client becomes `disconnected` |
| `MAINTENANCE_TTL_SECONDS` | `86400` | ≥ 1 | Maintenance mode switches itself off after this |
| `MAX_LABEL_CLASSES` / `MAX_LABEL_KEY_LENGTH` | `1000` / `64` | ≥ 1 | Limits on a submitted label distribution |
| `PAGE_SIZE_DEFAULT` / `PAGE_SIZE_MAX` | `20` / `200` | default ≤ max | Paging for client and round lists |
| `METRICS_ROUNDS_DEFAULT` / `METRICS_ROUNDS_MAX` | `20` / `200` | default ≤ max | Rounds returned by metrics RPCs |
| `CLIENT_METRICS_SCAN_FACTOR` | `50` | ≥ 1 | Updates scanned per round in `GetClientMetrics` |
| `CLIENT_HISTORY_LIMIT` | `50` | ≥ 1 | History entries in `GetClientDetail` |
| `CONFIG_HISTORY_LIMIT` | `100` | ≥ 1 | Entries in `GetConfigHistory` |
| `LOGS_LIMIT_DEFAULT` / `LOGS_LIMIT_MAX` | `100` / `500` | default ≤ max | Entries in `GetLogs` |
| `SELF_METRICS_LIMIT_DEFAULT` / `SELF_METRICS_LIMIT_MAX` | `10` / `100` | default ≤ max | Entries in client `GetSelfMetrics` |
| `UTILITY_AVG_WINDOW` | `200` | ≥ 1 | Recent updates used for a client's utility average |
| `METRICS_WINDOW_MS` / `METRICS_MAX_SAMPLES` | `60000` / `50000` | ≥ 1000 / ≥ 100 | Request-rate window in `GetStats` |
| `AGGREGATION_BASE_MS` / `AGGREGATION_PER_UPDATE_MS` | `5000` / `800` | ≥ 0 | `TriggerRound` duration estimate |
| `SUPPORTED_SDK_VERSIONS` | `1.0.0,1.1.0` | comma list | Versions reported to SDKs |
| `SERVER_TIMEZONE` / `BUILD_ID` | `Asia/Kolkata` / `dev-local` | | Reported by `GetPublicConfig` / `GetVersion` |

## Auth model

- **SDK clients:** `Register` → `client_id` + `api_key` (shown once) → `ClientLogin` → JWT with role `sdk_client`. Every `ClientService` call is scoped to the `client_id` in the token.
- **Dashboard users:** `AdminLogin` (email + password) → JWT with role `super_admin | admin | fl_engineer | viewer`. The first `super_admin` comes from the seed script; it can create the rest via `CreateAdminUser`.
- **FL server ↔ Central Server:** shared secret header + IP allowlist; no JWT.
- Access tokens are short-lived (15m); `RefreshToken` mints new ones. `Logout` blacklists the token's `jti` in Redis until it expires.
- **RBAC is fail-closed:** every RPC must have a rule in `interceptors/rbacRules.js`, otherwise calls are rejected with `Internal`. **When you add an RPC, add its rule.**
- Maintenance mode (`SetMaintenance`) blocks `ClientService` and `FlBridgeService` with `Unavailable`; admin/system RPCs stay reachable so it can be switched off.

## RPCs and permissions

Generated from `interceptors/rbacRules.js`.

#### AuthService

| RPC | Who can call |
|---|---|
| Register | public |
| ClientLogin | public |
| AdminLogin | public |
| RefreshToken | public |
| Logout | any logged-in role |
| RotateClientKey | admin, super_admin |
| CreateAdminUser | super_admin |
| GetMe | any logged-in role |

#### ClientService

| RPC | Who can call |
|---|---|
| GetStatus | sdk_client |
| GetCurrentRound | sdk_client |
| JoinRound | sdk_client |
| LeaveRound | sdk_client |
| GetModelDownload | sdk_client |
| SubmitUpdate | sdk_client |
| GetUpdateStatus | sdk_client |
| GetSelfMetrics | sdk_client |
| Heartbeat | sdk_client |
| GetConfig | sdk_client |

#### FlBridgeService

| RPC | Who can call |
|---|---|
| TriggerRound | internal token |
| CompleteRound | internal token |
| GetRoundUpdates | internal token |
| PushModel | internal token |
| GetFlStatus | internal token or super_admin |
| ComputeUtility | internal token |
| GetFlConfig | internal token |

#### AdminService

| RPC | Who can call |
|---|---|
| GetOverview | super_admin, admin, fl_engineer, viewer |
| ListClients | super_admin, admin |
| GetClientDetail | super_admin, admin, fl_engineer |
| BanClient | super_admin, admin |
| UnbanClient | super_admin, admin |
| DeleteClient | super_admin |
| ListRounds | super_admin, admin, fl_engineer, viewer |
| GetRoundDetail | super_admin, admin, fl_engineer |
| StartRound | super_admin, admin, fl_engineer |
| StopRound | super_admin, admin |
| ListRoundUpdates | super_admin, admin, fl_engineer |
| GetConvergenceMetrics | super_admin, admin, fl_engineer, viewer |
| GetClientMetrics | super_admin, admin, fl_engineer |
| GetCommunicationMetrics | super_admin, admin, fl_engineer, viewer |
| GetFairnessMetrics | super_admin, admin, fl_engineer |
| GetConfig | super_admin, admin, fl_engineer, viewer |
| UpdateConfig | super_admin |
| GetConfigHistory | super_admin, admin |
| ListModels | super_admin, admin, fl_engineer, viewer |
| GetModelDownload | super_admin, admin, fl_engineer |
| DeleteModel | super_admin |
| GetLogs | super_admin, admin |
| ListUsers | super_admin |
| UpdateUserRole | super_admin |
| DeleteUser | super_admin |

#### SystemService

| RPC | Who can call |
|---|---|
| HealthCheck | public |
| GetVersion | public |
| GetPublicConfig | public |
| GetStats | super_admin, admin |
| SetMaintenance | super_admin |
| FlushCache | super_admin |

#### EventStreamService

| RPC | Who can call |
|---|---|
| Subscribe | any logged-in role |

## Event stream (`EventStreamService.Subscribe`)

Replaces the old WebSocket. Open it with a valid JWT; it streams `{ type, payload_json, timestamp }`.
A `connected` event arrives first and a `ping` every 30s as keep-alive.

| type | admin roles | sdk_client |
|---|:-:|:-:|
| `round_started`, `round_completed`, `round_aborted`, `system_maintenance` | ✅ | ✅ |
| `round_aggregating`, `round_client_joined`, `round_client_left`, `round_update_received`, `client_banned`, `config_updated` | ✅ | — |

## Round lifecycle

`StartRound` (admin) → status `active`, clients `JoinRound`, train, `SubmitUpdate` (server computes a
utility score → `accepted` / `compressed` / `rejected` using the config thresholds) → FL server calls
`TriggerRound` (→ `aggregating`) and pulls updates with `GetRoundUpdates` → `CompleteRound` (→ `complete`,
new active model stored). `StopRound` aborts. Config changes apply from the *next* round (each round
snapshots the config at start). Participants who miss 3 heartbeats (90s) are marked `dropped`.

## Layout

```
proto/            API contracts (source of truth) — buf.yaml / buf.gen.yaml
src/gen/          generated code (committed). Regenerate after editing protos: npm run generate
src/index.js      server bootstrap: Fastify + Connect, CORS, FL IP allowlist, graceful shutdown
src/interceptors.js   error-sanitising/logging interceptor + wiring of the two below
interceptors/     accessControl (JWT/RBAC/internal token), maintenance gate, rbacRules.js
src/services/     one file per service (auth, client, admin, system, flBridge, events)
src/lib/          event bus, errors, helpers (config singleton, pagination, gini…), request metrics
src/storage.js    serves HMAC-signed /storage/... URLs from STORAGE_DIR
src/heartbeatWatcher.js   drops participants after 3 missed heartbeats
models/ utils/ config/ db.js   Mongoose models, JWT/password/signed-URL/utility-score utils, env config, Mongo+Redis
scripts/          seed-super-admin.js, smoke-test.js
```

Conventions: Mongo documents use snake_case strings for enums; `utils/protoMappers.js` is the only place
that maps them to proto enum numbers. Handlers receive/return plain objects with **camelCase** fields
(`req.clientId`); `int64` fields are JS `BigInt`.

## Known stand-ins / what's left for the rest of the project

- **Object storage is simulated.** `utils/signedUrl.js` makes HMAC-signed local URLs served from `STORAGE_DIR`; there is no upload endpoint (clients/FL server give URLs for their own storage). Swap in real S3/GCS presigned URLs there for production.
- **Utility score** (`utils/utilityScore.js`) is a simple formula (loss improvement 0.5 + data size 0.3 + label entropy 0.2) — replace with your research metric if needed.
- **Communication metrics** approximate bytes from `data_size` (no real transport accounting).
- **No round-deadline enforcement:** `deadline_at` is stored and returned, and `JoinRound` refuses after it, but nothing auto-aborts/aggregates a round when it passes. Something (the FL server or a timer here) must call `TriggerRound`/`StopRound`.
- **Events are in-process.** Fine for one instance; for horizontal scaling back `src/lib/events.js` with Redis pub/sub.
- `FlBridgeService.CompleteRound` always reports `next_round_scheduled: false` (no auto-scheduler).
- A permanent ban returns `banned_until: ""` from `BanClient` (stored as epoch 0).
- No automated unit tests beyond the end-to-end smoke test; no rate limiting (the old REST server had 300 req/min — add a Connect interceptor or put a gateway in front).
- `FlushCache` also clears the logout blacklist, so previously logged-out tokens work again until they expire.
- Change every default secret in `.env` before deploying.

## Changes vs. the old REST `backend/`

Same behaviour, ported to gRPC, plus fixes: `StartRound` falls back to config defaults when
`max_clients`/`deadline_seconds` are 0; `SubmitUpdate` only accepts updates while the round is `active`,
rejects banned clients, keeps a stable `update_id` on resubmission and maintains `Client.utility_avg`;
`GetClientDetail.label_entropy_avg` is now a real entropy average; the last super admin can't be demoted;
refresh tokens re-check that the client/user still exists and isn't banned; internal errors are never
leaked to clients; `FlushCache` returns a correct key count.
