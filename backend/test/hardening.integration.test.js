import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Role } from '../src/gen/common_pb.js';
import { AuditLog, ensureAuditRetention } from '../models/AuditLog.js';
import { startTestServer, bearer, collect } from './support/testServer.js';

const WINDOW_MS = 2000;
const ALLOWED_ORIGIN = 'http://dash.example';
let srv;

before(async () => {
  srv = await startTestServer({
    env: {
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_WINDOW_SECONDS: '2',
      RATE_LIMIT_PER_IP: '5',
      RATE_LIMIT_PER_PRINCIPAL: '8',
      LOGIN_MAX_ATTEMPTS: '3',
      LOGIN_LOCKOUT_SECONDS: '2',
      AUDIT_LOG_RETENTION_DAYS: '7',
      CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    },
  });
});

after(async () => {
  await srv?.stop();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshWindow = () => sleep(WINDOW_MS - (Date.now() % WINDOW_MS) + 30);
const isCode = (code, pattern) => (err) => err instanceof ConnectError && err.code === code && (!pattern || pattern.test(err.message));
async function pacedClients(names) {
  const out = [];
  for (let i = 0; i < names.length; i += 2) {
    await freshWindow();
    out.push(...(await Promise.all(names.slice(i, i + 2).map((n) => srv.newSdkClient(n)))));
  }
  return out;
}

const health = (headers = {}) => fetch(`${srv.baseUrl}/federix.v1.SystemService/HealthCheck`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: '{}',
});

test('CORS answers only for allowed origins; requests without an Origin are unaffected', async () => {
  await freshWindow();
  const allowed = await health({ origin: ALLOWED_ORIGIN });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);

  const denied = await health({ origin: 'http://evil.example' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const preflight = await fetch(`${srv.baseUrl}/federix.v1.SystemService/HealthCheck`, {
    method: 'OPTIONS',
    headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/i);

  const deniedPreflight = await fetch(`${srv.baseUrl}/federix.v1.SystemService/HealthCheck`, {
    method: 'OPTIONS',
    headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null);

  assert.equal((await health()).status, 200);
});

test('public RPCs are limited per IP and recover in the next window', async () => {
  await freshWindow();
  for (let i = 0; i < 5; i += 1) assert.equal((await srv.api.system.healthCheck({})).status, 'ok');
  await assert.rejects(srv.api.system.healthCheck({}), isCode(Code.ResourceExhausted, /at most 5 calls per 2s; try again in \d+s/));
  await freshWindow();
  assert.equal((await srv.api.system.healthCheck({})).status, 'ok');
});

test('a client cannot dodge the IP limit by sending its own IP header', async () => {
  await freshWindow();
  let refused = 0;
  for (let i = 0; i < 8; i += 1) {
    const res = await health({ 'x-federix-client-ip': `10.0.0.${i}` });
    if (res.status === 429 || (await res.json()).code === 'resource_exhausted') refused += 1;
  }
  assert.equal(refused, 3);
});

test('signed-in callers are limited per principal, independently of each other', async () => {
  const [c] = await pacedClients(['limited']);
  await freshWindow();
  for (let i = 0; i < 8; i += 1) await srv.api.auth.getMe({}, srv.superAdmin);
  await assert.rejects(srv.api.auth.getMe({}, srv.superAdmin), isCode(Code.ResourceExhausted));
  assert.equal((await srv.api.auth.getMe({}, c)).role, Role.SDK_CLIENT);
  assert.equal((await srv.api.system.healthCheck({})).status, 'ok');
});

test('the FL server\'s internal calls are not rate limited', async () => {
  await freshWindow();
  for (let i = 0; i < 20; i += 1) assert.ok((await srv.api.fl.getFlConfig({}, srv.internal)).minClients >= 1);
});

test('an admin account locks after LOGIN_MAX_ATTEMPTS failures, even for the right password, then unlocks', async () => {
  await freshWindow();
  const email = `lock_${randomBytes(4).toString('hex')}@federix.test`;
  const password = 'correct-password-123';
  await srv.api.auth.createAdminUser({ email, password, role: Role.VIEWER, name: 'lock' }, srv.superAdmin);

  await freshWindow();
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(srv.api.auth.adminLogin({ email, password: 'wrong' }), isCode(Code.Unauthenticated));
  }
  await assert.rejects(srv.api.auth.adminLogin({ email, password }), isCode(Code.ResourceExhausted, /Too many failed login attempts; try again in \d+s/));
  await assert.rejects(srv.api.auth.adminLogin({ email: email.toUpperCase(), password }), isCode(Code.ResourceExhausted));

  await sleep(2100);
  assert.ok((await srv.api.auth.adminLogin({ email, password })).accessToken);
  const logs = await collect(srv.api.admin.getLogs({ eventType: 'auth.login_locked' }, srv.superAdmin));
  assert.ok(logs.some((l) => l.actor === email && l.level === 'warn'));
});

test('a successful login resets the failure count', async () => {
  await freshWindow();
  const email = `reset_${randomBytes(4).toString('hex')}@federix.test`;
  const password = 'another-password-123';
  await srv.api.auth.createAdminUser({ email, password, role: Role.VIEWER, name: 'reset' }, srv.superAdmin);

  await freshWindow();
  await assert.rejects(srv.api.auth.adminLogin({ email, password: 'wrong' }), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.auth.adminLogin({ email, password: 'wrong' }), isCode(Code.Unauthenticated));
  assert.ok((await srv.api.auth.adminLogin({ email, password })).accessToken);
  await freshWindow();
  await assert.rejects(srv.api.auth.adminLogin({ email, password: 'wrong' }), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.auth.adminLogin({ email, password: 'wrong' }), isCode(Code.Unauthenticated));
  assert.ok((await srv.api.auth.adminLogin({ email, password })).accessToken);
});

test('an SDK client locks after repeated bad API keys', async () => {
  await freshWindow();
  const c = await srv.newSdkClient('lock-client');
  await freshWindow();
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(srv.api.auth.clientLogin({ clientId: c.id, apiKey: 'fdx_wrong' }), isCode(Code.Unauthenticated));
  }
  await assert.rejects(srv.api.auth.clientLogin({ clientId: c.id, apiKey: c.apiKey }), isCode(Code.ResourceExhausted));
  await sleep(2100);
  assert.ok((await srv.api.auth.clientLogin({ clientId: c.id, apiKey: c.apiKey })).accessToken);
});

test('audit log retention is a TTL index managed from AUDIT_LOG_RETENTION_DAYS', async () => {
  const byName = async () => Object.fromEntries((await AuditLog.collection.indexes()).map((i) => [i.name, i]));
  let idx = await byName();
  assert.equal(idx.audit_retention.expireAfterSeconds, 7 * 86400);
  assert.deepEqual(idx.audit_retention.key, { timestamp: 1 });
  assert.equal(idx.timestamp_1, undefined);

  await ensureAuditRetention(30);
  idx = await byName();
  assert.equal(idx.audit_retention.expireAfterSeconds, 30 * 86400);

  await ensureAuditRetention(0);
  idx = await byName();
  assert.equal(idx.audit_retention.expireAfterSeconds, undefined);
  assert.deepEqual(idx.audit_retention.key, { timestamp: 1 });

  await ensureAuditRetention(7);
  assert.equal((await byName()).audit_retention.expireAfterSeconds, 7 * 86400);
});

test('the fairness rate counts scored updates below the round\'s low threshold', async () => {
  await freshWindow();
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.5, utilityThresholdHigh: 0.9 }, srv.superAdmin);
  const round = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, srv.superAdmin);
  const [good, low1, low2, idle] = await pacedClients(['good', 'low1', 'low2', 'idle']);
  await freshWindow();
  for (const c of [good, low1, low2, idle]) await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 10000 }, c);
  await srv.submitUpdate(good, { roundId: round.roundId, localLossBefore: 1, localLossAfter: 0.2, dataSize: 5000, labelDistribution: { a: 1, b: 1, c: 1 } });
  for (const c of [low1, low2]) {
    await srv.submitUpdate(c, { roundId: round.roundId, localLossBefore: 1, localLossAfter: 0.99, dataSize: 10, labelDistribution: { a: 1 } });
  }
  await freshWindow();
  await srv.completeRound(round.roundId);

  const points = await collect(srv.api.admin.getFairnessMetrics({ lastNRounds: 1 }, srv.superAdmin));
  const p = points[points.length - 1];
  assert.equal(p.roundNumber, round.roundNumber);
  assert.equal(p.utilityDistribution.length, 3);
  assert.equal(p.minorityParticipationRate, 0.6667);
});

test('FlushCache keeps maintenance mode', async () => {
  await freshWindow();
  await srv.api.system.setMaintenance({ enabled: true, message: 'flush test' }, srv.superAdmin);
  const res = await srv.api.system.flushCache({}, srv.superAdmin);
  assert.match(res.warning, /Maintenance mode was kept/);

  await assert.rejects(srv.api.auth.getMe({}, srv.superAdmin), isCode(Code.Unauthenticated));

  await freshWindow();
  const c = await srv.newSdkClient('after-flush');
  await assert.rejects(srv.api.client.getStatus({}, c), isCode(Code.Unavailable));

  const relogin = await srv.api.auth.adminLogin(srv.adminCredentials);
  await srv.api.system.setMaintenance({ enabled: false }, bearer(relogin.accessToken));
  assert.equal((await srv.api.client.getStatus({}, c)).clientId, c.id);
});
