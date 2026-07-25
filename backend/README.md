# Federix — Central Server

Node.js / Fastify implementation of the Federix Central Server, per the
`Federix_Central_Server_API_Reference` spec: auth & RBAC, SDK client routes,
internal FL-server bridge, admin dashboard routes, system/health routes, and
real-time WebSocket events.

## Stack

- **Fastify** — HTTP server
- **MongoDB + Mongoose** — persistence
- **Redis (ioredis)** — JWT blacklist, maintenance-mode flag (falls back to an
  in-memory stub automatically if Redis isn't reachable, so you can run this
  locally without standing up Redis first — see `src/plugins/redis.js`)
- **@fastify/websocket** — `/api/v1/ws` real-time events
- **jsonwebtoken** — access/refresh JWTs (separate secrets)
- **bcryptjs** — password / API key hashing

## Setup

### Option A — Docker (recommended, no local Mongo/Redis install needed)

```bash
docker compose up --build
```

This builds the app image and starts `mongo`, `redis`, and the server together.
Once it's up (watch for `Server listening at http://0.0.0.0:4000`), seed your
first admin in a second terminal:

```bash
docker compose exec app npm run seed:super-admin
```

Health check: `curl http://localhost:4000/api/v1/system/health`.

`docker compose down` stops everything; add `-v` to also wipe the Mongo volume.

### Option B — Local Node + local Mongo/Redis

```bash
npm install
cp .env.example .env   # then edit secrets, Mongo/Redis URIs
npm run seed:super-admin   # create your first admin login
npm start                   # or `npm run dev` for --watch
```

Server listens on `PORT` (default `4000`). Health check:
`GET /api/v1/system/health`.

## Project layout

```
src/
  config/           env-driven config
  plugins/          mongoose, redis, auth (JWT+RBAC), maintenance-mode guard, websocket
  models/           Client, AdminUser, Round, Update, GlobalModel, SystemConfig, ConfigHistory, AuditLog
  routes/           auth, client, fl, admin, system route groups
  ws/               WebSocket connection registry + role-based broadcast
  utils/            jwt, password hashing, signed URLs, utility-score calc, ids, audit log
  app.js            builds & wires the Fastify instance
  index.js          entry point — boots app, seeds default config, starts heartbeat watcher
scripts/
  seed-super-admin.js   interactive CLI to create the first super_admin
```

## Auth model

- **SDK clients**: `POST /auth/register` → `client_id` + `api_key` (shown once) →
  `POST /auth/client/login` with those → JWT with `role: sdk_client` and a
  `client_id` claim. All `/api/v1/client/*` routes are scoped to that client.
- **Admin dashboard users**: `email`/`password` → `POST /auth/admin/login` →
  JWT with `role` in `super_admin | admin | fl_engineer | viewer`.
- **Internal (FL Server ↔ Central Server)**: `/api/v1/fl/*` routes require the
  `X-Internal-Service-Token` header to match `INTERNAL_SERVICE_TOKEN`, plus an
  IP allowlist check (`FL_SERVER_ALLOWED_IPS`).
- Logout blacklists the token's `jti` in Redis until its natural expiry.

## Notes on stand-ins

A few things are intentionally simplified since this server doesn't own real
object storage or a live FL server:

- **Signed URLs** (`src/utils/signedUrl.js`) are HMAC-signed local paths with
  an expiry, not real S3/GCS presigned URLs. Swap in your storage SDK there.
- **Utility score** (`src/utils/utilityScore.js`) is a simple, swappable
  formula (loss improvement + data size + label entropy) — not a research-grade
  FL contribution metric.
- **Communication metrics** approximate bytes from reported `data_size`, since
  there's no real transport layer to measure actual wire bytes.

Everything else (RBAC, JWT lifecycle, round lifecycle, banning, config
history, audit logging, WebSocket rooms/heartbeat) is fully implemented
against MongoDB — no mocked data.

## WebSocket

Connect: `ws://<host>/api/v1/ws?token=<JWT>`. Server pings every 30s; reply
`{"event":"pong"}` within 10s or the connection is closed. Admin-role
connections receive all events; `sdk_client` connections receive round
lifecycle events only (`round:started`, `round:completed`, `round:aborted`).
