import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Role } from '../src/gen/common_pb.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';
import { newId } from '../utils/ids.js';
import { startTestServer, bearer, collect } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer();
});

after(async () => {
  await srv?.stop();
});

const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;
const rejectsWith = (promise, code) => assert.rejects(promise, isCode(code));

async function newAdmin(role = Role.ADMIN) {
  const email = `user_${randomBytes(5).toString('hex')}@federix.test`;
  const password = `Pw_${randomBytes(8).toString('hex')}`;
  const created = await srv.api.auth.createAdminUser({ email, password, role, name: 'test' }, srv.superAdmin);
  const login = await srv.api.auth.adminLogin({ email, password });
  return { id: created.userId, email, password, access: login.accessToken, refresh: login.refreshToken };
}

async function newClientSession() {
  const reg = await srv.api.auth.register({ name: 'session-test', sdkVersion: '1.0.0', platform: 'test' });
  const login = await srv.api.auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey });
  return { id: reg.clientId, apiKey: reg.apiKey, access: login.accessToken, refresh: login.refreshToken };
}

const refresh = (token) => srv.api.auth.refreshToken({ refreshToken: token });
const getMe = (access) => srv.api.auth.getMe({}, bearer(access));

test('refresh returns a new access token and a new refresh token', async () => {
  const u = await newAdmin();
  const r = await refresh(u.refresh);
  assert.ok(r.accessToken);
  assert.ok(r.refreshToken);
  assert.notEqual(r.refreshToken, u.refresh);
  assert.ok(r.expiresIn > 0);
  assert.equal((await getMe(r.accessToken)).id, u.id);
  assert.equal((await getMe(u.access)).id, u.id);
  const again = await refresh(r.refreshToken);
  assert.notEqual(again.refreshToken, r.refreshToken);
});

test('reusing a rotated refresh token revokes the whole session', async () => {
  const u = await newAdmin();
  const first = await refresh(u.refresh);

  await assert.rejects(refresh(u.refresh), (err) => isCode(Code.Unauthenticated)(err) && /already used/.test(err.message));
  await rejectsWith(refresh(first.refreshToken), Code.Unauthenticated);
  await rejectsWith(getMe(first.accessToken), Code.Unauthenticated);
  await rejectsWith(getMe(u.access), Code.Unauthenticated);

  const fresh = await srv.api.auth.adminLogin({ email: u.email, password: u.password });
  assert.equal((await getMe(fresh.accessToken)).id, u.id);
});

test('reuse is recorded in the audit log', async () => {
  const u = await newAdmin();
  await refresh(u.refresh);
  await rejectsWith(refresh(u.refresh), Code.Unauthenticated);
  const logs = await collect(srv.api.admin.getLogs({ eventType: 'session.refresh_reuse', actor: u.id }, srv.superAdmin));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'warn');
});

test('concurrent refreshes with the same token: at most one succeeds and the session is revoked', async () => {
  const u = await newAdmin();
  const results = await Promise.allSettled([refresh(u.refresh), refresh(u.refresh), refresh(u.refresh)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.ok(ok.length <= 1);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.ok(isCode(Code.Unauthenticated)(r.reason));
  if (ok.length === 1) await rejectsWith(refresh(ok[0].value.refreshToken), Code.Unauthenticated);
});

test('refresh after demotion carries the new role from the database', async () => {
  const u = await newAdmin(Role.ADMIN);
  await collect(srv.api.admin.listClients({}, bearer(u.access)));

  await srv.api.admin.updateUserRole({ userId: u.id, role: Role.VIEWER }, srv.superAdmin);
  const r = await refresh(u.refresh);

  assert.equal((await getMe(r.accessToken)).role, Role.VIEWER);
  await rejectsWith(collect(srv.api.admin.listClients({}, bearer(r.accessToken))), Code.PermissionDenied);
});

test('refresh after promotion carries the new role from the database', async () => {
  const u = await newAdmin(Role.VIEWER);
  await srv.api.admin.updateUserRole({ userId: u.id, role: Role.ADMIN }, srv.superAdmin);
  const r = await refresh(u.refresh);
  assert.equal((await getMe(r.accessToken)).role, Role.ADMIN);
  await collect(srv.api.admin.listClients({}, bearer(r.accessToken)));
});

test('a deleted user cannot refresh', async () => {
  const u = await newAdmin();
  await srv.api.admin.deleteUser({ userId: u.id }, srv.superAdmin);
  await rejectsWith(refresh(u.refresh), Code.Unauthenticated);
});

test('logout ends the session for both the access and the refresh token', async () => {
  const u = await newAdmin();
  const r = await refresh(u.refresh);
  await srv.api.auth.logout({}, bearer(r.accessToken));

  await rejectsWith(getMe(r.accessToken), Code.Unauthenticated);
  await rejectsWith(getMe(u.access), Code.Unauthenticated);
  await assert.rejects(refresh(r.refreshToken), (err) => isCode(Code.Unauthenticated)(err) && /Session has ended/.test(err.message));
});

test('logging out one session leaves other sessions of the same user working', async () => {
  const u = await newAdmin();
  const second = await srv.api.auth.adminLogin({ email: u.email, password: u.password });
  await srv.api.auth.logout({}, bearer(u.access));
  assert.equal((await getMe(second.accessToken)).id, u.id);
  assert.ok((await refresh(second.refreshToken)).accessToken);
});

test('SDK clients refresh with role sdk_client', async () => {
  const c = await newClientSession();
  const r = await refresh(c.refresh);
  const me = await getMe(r.accessToken);
  assert.equal(me.role, Role.SDK_CLIENT);
  assert.equal(me.id, c.id);
  assert.ok((await srv.api.client.getStatus({}, bearer(r.accessToken))).clientId === c.id);
});

test('a banned client cannot refresh and its session ends', async () => {
  const c = await newClientSession();
  await srv.api.admin.banClient({ clientId: c.id, reason: 'test', durationHours: 1 }, srv.superAdmin);
  await rejectsWith(refresh(c.refresh), Code.PermissionDenied);
  await rejectsWith(getMe(c.access), Code.Unauthenticated);
});

test('a deleted client cannot refresh', async () => {
  const c = await newClientSession();
  await srv.api.admin.deleteClient({ clientId: c.id }, srv.superAdmin);
  await rejectsWith(refresh(c.refresh), Code.Unauthenticated);
});

test('tokens without a session are rejected', async () => {
  const me = await getMe(srv.superAdmin.headers.authorization.slice(7));
  const legacyAccess = signAccessToken({ sub: me.id, role: 'super_admin', jti: newId() });
  await rejectsWith(getMe(legacyAccess), Code.Unauthenticated);

  const legacyRefresh = signRefreshToken({ sub: me.id, role: 'super_admin', jti: newId() });
  await rejectsWith(refresh(legacyRefresh), Code.Unauthenticated);

  const forgedFamily = signAccessToken({ sub: me.id, role: 'super_admin', fam: newId(), jti: newId() });
  await rejectsWith(getMe(forgedFamily), Code.Unauthenticated);
});

test('an access token is not accepted as a refresh token', async () => {
  const u = await newAdmin();
  await rejectsWith(refresh(u.access), Code.Unauthenticated);
});

test('the internal service token is checked exactly', async () => {
  const ok = await srv.api.fl.getFlStatus({}, srv.internal);
  assert.equal(ok.status, 'ok');

  const real = srv.internal.headers['x-internal-service-token'];
  const sameLength = real.slice(0, -1) + (real.endsWith('a') ? 'b' : 'a');
  for (const bad of [sameLength, real.slice(0, -1), `${real}x`, '']) {
    await rejectsWith(srv.api.fl.getFlConfig({}, { headers: { 'x-internal-service-token': bad } }), Code.Unauthenticated);
  }
});

test('HealthCheck reports real MongoDB and Redis connections', async () => {
  const h = await srv.api.system.healthCheck({});
  assert.equal(h.status, 'ok');
  assert.equal(h.db, 'connected');
  assert.equal(h.redis, 'connected');
});

test('FlushCache ends every session, including the caller', async () => {
  const u = await newAdmin();
  const c = await newClientSession();
  const res = await srv.api.system.flushCache({}, srv.superAdmin);
  assert.ok(res.flushedKeys >= 2);
  assert.match(res.warning, /every session was ended/);

  await rejectsWith(getMe(u.access), Code.Unauthenticated);
  await rejectsWith(getMe(c.access), Code.Unauthenticated);
  await rejectsWith(refresh(u.refresh), Code.Unauthenticated);
  await rejectsWith(srv.api.auth.getMe({}, srv.superAdmin), Code.Unauthenticated);
});
