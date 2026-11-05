import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { config } from '../../config/index.js';
import { AdminUser } from '../../models/AdminUser.js';
import { hashPassword } from '../../utils/password.js';
import { newId } from '../../utils/ids.js';
import { AuthService } from '../../src/gen/auth_pb.js';
import { ClientService } from '../../src/gen/client_pb.js';
import { AdminService } from '../../src/gen/admin_pb.js';
import { SystemService } from '../../src/gen/system_pb.js';
import { FlBridgeService } from '../../src/gen/fl_bridge_pb.js';
import { EventStreamService } from '../../src/gen/events_pb.js';

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEST_REDIS_DB = 15;
const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

export async function collect(stream) {
  const out = [];
  for await (const m of stream) out.push(m);
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function withPath(uri, pathname) {
  const u = new URL(uri);
  u.pathname = pathname;
  return u.toString();
}

async function waitForHealthy(baseUrl, child, stderr) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited with code ${child.exitCode}\n${stderr.join('')}`);
    try {
      const res = await fetch(`${baseUrl}/federix.v1.SystemService/HealthCheck`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        const body = await res.json();
        if (body.db === 'connected' && body.redis === 'connected') return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`test server did not become healthy within ${STARTUP_TIMEOUT_MS}ms\n${stderr.join('')}`);
}

export async function runServerUntilExit(envOverrides, timeoutMs = STARTUP_TIMEOUT_MS) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'warn', ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, signal, output: output.join('') };
}

export async function startTestServer() {
  const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const dbName = `federix_test_${suffix}`;
  const mongoUri = withPath(config.mongoUri, `/${dbName}`);
  const redisUrl = withPath(config.redisUrl, `/${TEST_REDIS_DB}`);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'federix-test-storage-'));
  const internalToken = `test_internal_${randomBytes(12).toString('hex')}`;
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const admin = { email: `admin_${suffix}@federix.test`, password: `Pw_${randomBytes(8).toString('hex')}` };

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
  await AdminUser.create({
    user_id: newId(),
    email: admin.email,
    name: 'Test Super Admin',
    password_hash: await hashPassword(admin.password),
    role: 'super_admin',
  });

  const stderr = [];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      HTTP2: 'false',
      MONGO_URI: mongoUri,
      REDIS_URL: redisUrl,
      INTERNAL_SERVICE_TOKEN: internalToken,
      FL_SERVER_ALLOWED_IPS: '127.0.0.1,::1,::ffff:127.0.0.1',
      STORAGE_DIR: storageDir,
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => stderr.push(String(d)));

  async function cleanup() {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const exited = once(child, 'exit');
      const timeout = new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS));
      await Promise.race([exited, timeout]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await rm(storageDir, { recursive: true, force: true });
  }

  try {
    await waitForHealthy(baseUrl, child, stderr);
  } catch (err) {
    await cleanup();
    throw err;
  }

  const transport = createConnectTransport({ baseUrl, httpVersion: '1.1' });
  const api = {
    auth: createClient(AuthService, transport),
    client: createClient(ClientService, transport),
    admin: createClient(AdminService, transport),
    system: createClient(SystemService, transport),
    fl: createClient(FlBridgeService, transport),
    events: createClient(EventStreamService, transport),
  };

  const login = await api.auth.adminLogin(admin);
  const superAdmin = bearer(login.accessToken);
  const internal = { headers: { 'x-internal-service-token': internalToken } };

  async function newSdkClient(name = 'test-client') {
    const reg = await api.auth.register({ name, sdkVersion: '1.0.0', platform: 'test' });
    const session = await api.auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey });
    return { id: reg.clientId, apiKey: reg.apiKey, ...bearer(session.accessToken) };
  }

  return { baseUrl, dbName, api, superAdmin, internal, newSdkClient, stop: cleanup };
}
