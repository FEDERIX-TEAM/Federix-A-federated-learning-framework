import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Role } from '../src/gen/common_pb.js';
import { Client } from '../models/Client.js';
import { Round } from '../models/Round.js';
import { startTestServer, bearer, collect } from './support/testServer.js';

const SETTINGS = {
  CLIENT_STATUS_CHECK_INTERVAL_MS: '150',
  CLIENT_IDLE_AFTER_MS: '600',
  CLIENT_DISCONNECTED_AFTER_MS: '1400',
  STREAM_AUTH_RECHECK_MS: '200',
  HEARTBEAT_CHECK_INTERVAL_MS: '60000',
  HEARTBEAT_TIMEOUT_MS: '600000',
};

let srv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;

before(async () => {
  srv = await startTestServer({ env: SETTINGS });
  await srv.api.admin.updateConfig({ minClientsPerRound: 1 }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

async function statusOf(c) {
  return (await Client.findOne({ client_id: c.id }).lean()).status;
}

async function waitFor(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}

async function newAdmin(role) {
  const email = `life_${randomBytes(5).toString('hex')}@federix.test`;
  const password = `Pw_${randomBytes(8).toString('hex')}`;
  const created = await srv.api.auth.createAdminUser({ email, password, role, name: 'life' }, srv.superAdmin);
  const login = await srv.api.auth.adminLogin({ email, password });
  return { id: created.userId, email, password, ...bearer(login.accessToken), refresh: login.refreshToken };
}

function openStream(who) {
  const ac = new AbortController();
  const types = [];
  const done = (async () => {
    try {
      for await (const e of srv.api.events.subscribe({}, { ...who, signal: ac.signal })) types.push(e.type);
      return { ended: 'cleanly' };
    } catch (err) {
      return { ended: 'error', err };
    }
  })();
  return { types, done, close: () => ac.abort() };
}

async function expectStreamClosed(stream, code, pattern, timeoutMs = 2000) {
  const result = await Promise.race([stream.done, sleep(timeoutMs).then(() => ({ ended: 'timeout' }))]);
  if (result.ended === 'timeout') stream.close();
  assert.equal(result.ended, 'error', `stream still open after ${timeoutMs}ms`);
  assert.ok(isCode(code)(result.err), `expected ${Code[code]}, got ${result.err}`);
  if (pattern) assert.match(result.err.message, pattern);
  assert.equal(stream.types[0], 'connected');
}

test('a silent client goes active -> idle -> disconnected, and a heartbeat brings it back', async () => {
  const c = await srv.newSdkClient('presence');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, c);
    assert.equal(await statusOf(c), 'active');
    assert.ok(await waitFor(async () => (await statusOf(c)) === 'idle'), 'did not become idle');
    assert.ok(await waitFor(async () => (await statusOf(c)) === 'disconnected'), 'did not become disconnected');

    await srv.api.client.heartbeat({ roundId: round.roundId }, c);
    assert.equal(await statusOf(c), 'active');
    assert.equal((await srv.api.client.getStatus({}, c)).status, 'active');
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('the overview counts only clients that are really active', async () => {
  const a = await srv.newSdkClient('overview-a');
  await srv.newSdkClient('overview-b');
  assert.ok(await waitFor(async () => (await srv.api.admin.getOverview({}, srv.superAdmin)).activeClients === 0, 4000));

  const again = await srv.api.auth.clientLogin({ clientId: a.id, apiKey: a.apiKey });
  assert.ok(again.accessToken);
  assert.equal((await srv.api.admin.getOverview({}, srv.superAdmin)).activeClients, 1);
});

test('an expired ban is cleared and the client leaves the banned list', async () => {
  const c = await srv.newSdkClient('expiring-ban');
  await srv.api.admin.banClient({ clientId: c.id, reason: 'short', durationHours: 1 }, srv.superAdmin);
  const listed = async () => (await collect(srv.api.admin.listClients({ status: 'banned', limit: 200 }, srv.superAdmin))).some((x) => x.clientId === c.id);
  assert.equal(await listed(), true);

  await Client.updateOne({ client_id: c.id }, { banned_until: new Date(Date.now() - 1000) });
  assert.equal(await listed(), false);
  assert.ok(await waitFor(async () => (await Client.findOne({ client_id: c.id }).lean()).banned_until === null));

  const stored = await Client.findOne({ client_id: c.id }).lean();
  assert.equal(stored.ban_reason, null);
  assert.notEqual(stored.status, 'banned');
  const logs = await collect(srv.api.admin.getLogs({ eventType: 'client.ban_expired' }, srv.superAdmin));
  assert.ok(logs.some((l) => JSON.parse(l.detailsJson).client_id === c.id));
  const login = await srv.api.auth.clientLogin({ clientId: c.id, apiKey: c.apiKey });
  assert.ok(login.accessToken);
});

test('a permanent ban is never cleared by the status job', async () => {
  const c = await srv.newSdkClient('permanent-ban');
  await srv.api.admin.banClient({ clientId: c.id, durationHours: 0 }, srv.superAdmin);
  await sleep(500);
  const stored = await Client.findOne({ client_id: c.id }).lean();
  assert.equal(stored.banned_until.getTime(), 0);
  assert.equal(stored.status, 'banned');
  assert.ok((await collect(srv.api.admin.listClients({ status: 'banned', limit: 200 }, srv.superAdmin))).some((x) => x.clientId === c.id));
});

test('banning a client mid-round removes it, rejects its heartbeat and ends its sessions at once', async () => {
  const [banned, other] = await Promise.all([srv.newSdkClient('to-ban'), srv.newSdkClient('stays')]);
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, banned);
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, other);

    await srv.api.admin.banClient({ clientId: banned.id, reason: 'abuse', durationHours: 1 }, srv.superAdmin);

    const doc = await Round.findOne({ round_id: round.roundId }).lean();
    const p = Object.fromEntries(doc.participants.map((x) => [x.client_id, x]));
    assert.equal(p[banned.id].status, 'left');
    assert.equal(p[banned.id].leave_reason, 'client banned');
    assert.equal(p[other.id].status, 'joined');

    await assert.rejects(srv.api.client.heartbeat({ roundId: round.roundId }, banned), isCode(Code.Unauthenticated));
    await assert.rejects(srv.api.auth.getMe({}, banned), isCode(Code.Unauthenticated));
    assert.equal((await srv.api.client.heartbeat({ roundId: round.roundId }, other)).ok, true);
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('a banned client with a fresh token still cannot heartbeat', async () => {
  const c = await srv.newSdkClient('banned-heartbeat');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, c);
    await Client.updateOne({ client_id: c.id }, { banned_until: new Date(Date.now() + 3600_000), status: 'banned' });
    await assert.rejects(
      srv.api.client.heartbeat({ roundId: round.roundId }, c),
      (err) => isCode(Code.PermissionDenied)(err) && /banned/.test(err.message)
    );
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('deleting a client or a user ends all of their sessions', async () => {
  const c = await srv.newSdkClient('to-delete');
  const second = await srv.api.auth.clientLogin({ clientId: c.id, apiKey: c.apiKey });
  await srv.api.admin.deleteClient({ clientId: c.id }, srv.superAdmin);
  await assert.rejects(srv.api.auth.getMe({}, c), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.auth.getMe({}, bearer(second.accessToken)), isCode(Code.Unauthenticated));

  const u = await newAdmin(Role.VIEWER);
  await srv.api.admin.deleteUser({ userId: u.id }, srv.superAdmin);
  await assert.rejects(srv.api.auth.getMe({}, u), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.auth.refreshToken({ refreshToken: u.refresh }), isCode(Code.Unauthenticated));
});

test('an event stream closes soon after logout', async () => {
  const u = await newAdmin(Role.VIEWER);
  const stream = openStream(u);
  await sleep(100);
  await srv.api.auth.logout({}, u);
  await expectStreamClosed(stream, Code.Unauthenticated, /invalidated|Session has ended/);
});

test('an event stream closes soon after the client is banned', async () => {
  const c = await srv.newSdkClient('stream-ban');
  const stream = openStream(c);
  await sleep(100);
  await srv.api.admin.banClient({ clientId: c.id, durationHours: 1 }, srv.superAdmin);
  await expectStreamClosed(stream, Code.Unauthenticated);
});

test('an event stream closes soon after the user is deleted', async () => {
  const u = await newAdmin(Role.VIEWER);
  const stream = openStream(u);
  await sleep(100);
  await srv.api.admin.deleteUser({ userId: u.id }, srv.superAdmin);
  await expectStreamClosed(stream, Code.Unauthenticated);
});

test('an event stream closes with PermissionDenied when the role changes', async () => {
  const u = await newAdmin(Role.ADMIN);
  const stream = openStream(u);
  await sleep(100);
  await srv.api.admin.updateUserRole({ userId: u.id, role: Role.VIEWER }, srv.superAdmin);
  await expectStreamClosed(stream, Code.PermissionDenied, /role changed/);
});

test('an event stream stays open while the session is valid', async () => {
  const u = await newAdmin(Role.VIEWER);
  const stream = openStream(u);
  const result = await Promise.race([stream.done, sleep(900).then(() => ({ ended: 'still-open' }))]);
  stream.close();
  assert.equal(result.ended, 'still-open');
  assert.equal(stream.types[0], 'connected');
});
