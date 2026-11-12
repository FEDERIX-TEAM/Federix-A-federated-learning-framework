import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AuthService } from "../../src/gen/auth_pb";
import { Role } from "../../src/gen/common_pb";

export const DASHBOARD = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BACKEND = resolve(DASHBOARD, "../backend");
export const STATE_FILE = join(DASHBOARD, "test-results", "e2e-stack.json");

export interface Account {
  email: string;
  password: string;
  name: string;
}

export interface StackState {
  apiUrl: string;
  dashboardUrl: string;
  mongoUri: string;
  storageDir: string;
  pids: number[];
  superAdmin: Account;
  viewer: Account;
  accessTtlSeconds: number;
}

const hex = (n: number) => randomBytes(n).toString("hex");

function node(args: string[], env: Record<string, string>, cwd = BACKEND) {
  return spawnSync("node", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 60_000 });
}

async function waitFor(url: string, check: (res: Response) => Promise<boolean>, proc: ChildProcess, what: string, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`${what} exited with code ${proc.exitCode}`);
    try {
      const res = await fetch(url, { method: url.includes("HealthCheck") ? "POST" : "GET", headers: { "content-type": "application/json" }, body: url.includes("HealthCheck") ? "{}" : undefined });
      if (await check(res)) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${what} did not become ready within ${ms / 1000}s`);
}

export async function startStack(): Promise<StackState> {
  const apiPort = Number(process.env.E2E_API_PORT ?? 4199);
  const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT ?? 5199);
  const mongoBase = process.env.FEDERIX_TEST_MONGO ?? "mongodb://127.0.0.1:27017";
  const redisUrl = process.env.FEDERIX_TEST_REDIS ?? "redis://127.0.0.1:6379/15";
  const accessTtlSeconds = 6;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  const mongoUri = `${mongoBase}/federix_dashtest_${process.pid}_${hex(4)}`;
  const storageDir = mkdtempSync(join(tmpdir(), "federix-dash-storage-"));
  const superAdmin: Account = { email: `owner_${hex(3)}@federix.test`, password: `Pw_${hex(8)}`, name: "Ada Lovelace" };
  const viewer: Account = { email: `viewer_${hex(3)}@federix.test`, password: `Pw_${hex(8)}`, name: "Grace Hopper" };
  const pids: number[] = [];

  if (!existsSync(join(DASHBOARD, ".next", "BUILD_ID"))) throw new Error("run `npm run build` before the e2e tests (npm run test:e2e does it)");

  const seeded = node(["scripts/seed-super-admin.js"], { MONGO_URI: mongoUri, SEED_EMAIL: superAdmin.email, SEED_NAME: superAdmin.name, SEED_PASSWORD: superAdmin.password });
  if (seeded.status !== 0) throw new Error(`could not seed the backend database (is MongoDB running?)\n${seeded.stdout}${seeded.stderr}`);

  const backend = spawn("node", ["src/index.js"], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      MONGO_URI: mongoUri,
      REDIS_URL: redisUrl,
      INTERNAL_SERVICE_TOKEN: `internal_${hex(12)}`,
      PUBLIC_BASE_URL: apiUrl,
      STORAGE_DIR: storageDir,
      LOG_LEVEL: "warn",
      SCHEDULER_INTERVAL_MS: "3600000",
      RATE_LIMIT_ENABLED: "false",
      JWT_ACCESS_EXPIRES_IN: `${accessTtlSeconds}s`,
      CORS_ALLOWED_ORIGINS: dashboardUrl,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  pids.push(backend.pid!);
  const state: StackState = { apiUrl, dashboardUrl, mongoUri, storageDir, pids, superAdmin, viewer, accessTtlSeconds };
  writeState(state);

  await waitFor(`${apiUrl}/federix.v1.SystemService/HealthCheck`, async (r) => r.ok && (await r.json()).db === "connected", backend, "backend");

  const auth = createClient(AuthService, createConnectTransport({ baseUrl: apiUrl, useBinaryFormat: true }));
  const login = await auth.adminLogin({ email: superAdmin.email, password: superAdmin.password });
  await auth.createAdminUser(
    { email: viewer.email, password: viewer.password, name: viewer.name, role: Role.VIEWER },
    { headers: { authorization: `Bearer ${login.accessToken}` } },
  );

  const dashboard = spawn(join(DASHBOARD, "node_modules", ".bin", "next"), ["start", "-p", String(dashboardPort), "-H", "127.0.0.1"], {
    cwd: DASHBOARD,
    env: { ...process.env, FEDERIX_API_URL: apiUrl, FEDERIX_HEALTH_POLL_MS: "1500", NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  pids.push(dashboard.pid!);
  writeState(state);
  await waitFor(`${dashboardUrl}/login`, async (r) => r.ok, dashboard, "dashboard");
  return state;
}

export function writeState(state: StackState) {
  spawnSync("mkdir", ["-p", join(DASHBOARD, "test-results")]);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function readState(): StackState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as StackState;
}

export function stopStack() {
  if (!existsSync(STATE_FILE)) return;
  const state = readState();
  for (const pid of [...state.pids].reverse()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  node(
    ["-e", "import('mongoose').then(async ({default: m}) => { await m.connect(process.env.MONGO_URI); await m.connection.dropDatabase(); await m.disconnect(); })"],
    { MONGO_URI: state.mongoUri },
  );
  rmSync(state.storageDir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}
