import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Role } from '../src/gen/common_pb.js';
import { Round } from '../models/Round.js';
import { AdminUser } from '../models/AdminUser.js';
import { startTestServer, runServerUntilExit, collect } from './support/testServer.js';

const SETTINGS = {
  HEARTBEAT_CHECK_INTERVAL_MS: '200',
  HEARTBEAT_TIMEOUT_MS: '800',
  SIGNED_URL_TTL_SECONDS: '1',
  EVENT_PING_INTERVAL_MS: '300',
  PAGE_SIZE_DEFAULT: '2',
  PAGE_SIZE_MAX: '3',
  BCRYPT_ROUNDS: '4',
  MIN_PASSWORD_LENGTH: '12',
  MAINTENANCE_TTL_SECONDS: '1',
  AGGREGATION_BASE_MS: '1234',
  AGGREGATION_PER_UPDATE_MS: '0',
  CLIENT_HISTORY_LIMIT: '1',
};

let srv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;

before(async () => {
  srv = await startTestServer({ env: SETTINGS });
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5 }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

test('invalid settings stop the server and every problem is listed', async () => {
  const { code, output } = await runServerUntilExit({
    HEARTBEAT_TIMEOUT_MS: 'abc',
    EVENT_QUEUE_MAX: '-5',
    LOG_LEVEL: 'loud',
    HTTP2: 'maybe',
    JWT_ACCESS_EXPIRES_IN: '2 days',
    PAGE_SIZE_DEFAULT: '50',
    PAGE_SIZE_MAX: '10',
    BCRYPT_ROUNDS: '40',
    PORT: '70000',
    TLS_KEY: '/tmp/key.pem',
    TLS_CERT: '',
  });
  assert.equal(code, 1);
  assert.match(output, /Invalid configuration:/);
  for (const expected of [
    /HEARTBEAT_TIMEOUT_MS must be an integer >= 100 \(got "abc"\)/,
    /EVENT_QUEUE_MAX must be an integer >= 1 \(got "-5"\)/,
    /LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent \(got "loud"\)/,
    /HTTP2 must be true or false \(got "maybe"\)/,
    /JWT_ACCESS_EXPIRES_IN must be a number followed by s, m, h or d/,
    /PAGE_SIZE_DEFAULT \(50\) must not be greater than PAGE_SIZE_MAX \(10\)/,
    /BCRYPT_ROUNDS must be an integer between 4 and 15 \(got "40"\)/,
    /PORT must be an integer between 1 and 65535 \(got "70000"\)/,
    /TLS_KEY and TLS_CERT must be set together/,
  ]) {
    assert.match(output, expected);
  }
});

test('HEARTBEAT_TIMEOUT_MS drops a silent participant and keeps an active one', async () => {
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    const [active, silent] = await Promise.all([srv.newSdkClient('active'), srv.newSdkClient('silent')]);
    await srv.api.client.joinRound({ roundId: round.roundId }, active);
    await srv.api.client.joinRound({ roundId: round.roundId }, silent);

    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      await srv.api.client.heartbeat({ roundId: round.roundId }, active);
      await sleep(150);
    }

    const doc = await Round.findOne({ round_id: round.roundId }).lean();
    const status = Object.fromEntries(doc.participants.map((p) => [p.client_id, p]));
    assert.equal(status[active.id].status, 'joined');
    assert.equal(status[silent.id].status, 'dropped');
    assert.equal(status[silent.id].leave_reason, 'missed heartbeats');
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('SIGNED_URL_TTL_SECONDS controls how long a download URL works', async () => {
  const version = 1 + Math.floor(Math.random() * 1e9);
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: 's3://m/x.bin' }, srv.internal);
  const c = await srv.newSdkClient('downloader');

  const dl = await srv.api.client.getModelDownload({ modelVersion: version }, c);
  const lifetimeMs = new Date(dl.expiresAt).getTime() - Date.now();
  assert.ok(lifetimeMs > 0 && lifetimeMs <= 1000, `lifetime ${lifetimeMs}ms`);

  assert.equal((await fetch(srv.baseUrl + dl.downloadUrl)).status, 404);
  await sleep(1200);
  assert.equal((await fetch(srv.baseUrl + dl.downloadUrl)).status, 403);
});

test('EVENT_PING_INTERVAL_MS sets the keep-alive rate of the event stream', async () => {
  const ac = new AbortController();
  const types = [];
  const reader = (async () => {
    try {
      for await (const e of srv.api.events.subscribe({}, { ...srv.superAdmin, signal: ac.signal })) types.push(e.type);
    } catch {
      return;
    }
  })();
  await sleep(1100);
  ac.abort();
  await reader;

  assert.equal(types[0], 'connected');
  const pings = types.filter((t) => t === 'ping').length;
  assert.ok(pings >= 2 && pings <= 4, `got ${pings} pings in 1.1s`);
});

test('PAGE_SIZE_DEFAULT and PAGE_SIZE_MAX limit list results', async () => {
  await Promise.all(Array.from({ length: 5 }, (_, i) => srv.newSdkClient(`page-${i}`)));
  assert.equal((await collect(srv.api.admin.listClients({}, srv.superAdmin))).length, 2);
  assert.equal((await collect(srv.api.admin.listClients({ limit: 100 }, srv.superAdmin))).length, 3);
  assert.equal((await collect(srv.api.admin.listClients({ limit: 1 }, srv.superAdmin))).length, 1);
});

test('BCRYPT_ROUNDS sets the cost of stored password hashes', async () => {
  const email = `cost_${randomBytes(4).toString('hex')}@federix.test`;
  const created = await srv.api.auth.createAdminUser({ email, password: 'a-long-password-123', role: Role.VIEWER, name: 'cost' }, srv.superAdmin);
  const user = await AdminUser.findOne({ user_id: created.userId }).lean();
  assert.match(user.password_hash, /^\$2[aby]\$04\$/);
});

test('MIN_PASSWORD_LENGTH is enforced when creating users', async () => {
  const email = `short_${randomBytes(4).toString('hex')}@federix.test`;
  await assert.rejects(
    srv.api.auth.createAdminUser({ email, password: 'elevenchars', role: Role.VIEWER, name: 'short' }, srv.superAdmin),
    (err) => isCode(Code.InvalidArgument)(err) && /at least 12 characters/.test(err.message)
  );
});

test('AGGREGATION_BASE_MS and AGGREGATION_PER_UPDATE_MS drive the TriggerRound estimate', async () => {
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    const res = await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: ['a', 'b', 'c'] }, srv.internal);
    assert.equal(res.estimatedDurationMs, 1234);
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('CLIENT_HISTORY_LIMIT caps the history in GetClientDetail', async () => {
  const c = await srv.newSdkClient('history');
  for (let i = 0; i < 2; i += 1) {
    const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
    await srv.api.client.joinRound({ roundId: round.roundId }, c);
    await srv.api.client.submitUpdate({
      roundId: round.roundId, deltaWeightsUrl: 's3://u.bin', localLossBefore: 1, localLossAfter: 0.5,
      labelDistribution: { counts: { a: 1 } }, dataSize: 100, trainingTimeMs: 10,
    }, c);
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
  const detail = await srv.api.admin.getClientDetail({ clientId: c.id }, srv.superAdmin);
  assert.equal(detail.history.length, 1);
});

test('MAINTENANCE_TTL_SECONDS makes the maintenance flag expire on its own', async () => {
  const c = await srv.newSdkClient('maintenance');
  await srv.api.system.setMaintenance({ enabled: true, message: 'short window' }, srv.superAdmin);
  await assert.rejects(srv.api.client.getStatus({}, c), isCode(Code.Unavailable));
  await sleep(1300);
  assert.equal((await srv.api.client.getStatus({}, c)).clientId, c.id);
});
