import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Role } from '../src/gen/common_pb.js';
import { EnrollmentToken } from '../models/EnrollmentToken.js';
import { Client } from '../models/Client.js';
import { hashToken } from '../src/lib/enrollment.js';
import { startTestServer, bearer, collect } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer({ env: { ENROLLMENT_TOKEN_MAX_USES: '50', ENROLLMENT_TOKEN_MAX_TTL_HOURS: '48', ENROLLMENT_TOKEN_DEFAULT_TTL_HOURS: '48', SUPPORTED_SDK_VERSIONS: '1.0.0,1.1.0' } });
});

after(async () => {
  await srv?.stop();
});

const isCode = (code, pattern) => (err) => err instanceof ConnectError && err.code === code && (!pattern || pattern.test(err.message));
const create = (req = {}, who = srv.superAdmin) => srv.api.admin.createEnrollmentToken({ maxUses: 1, ttlHours: 1, ...req }, who);
const register = (enrollmentToken, extra = {}) => srv.api.auth.register({ name: 'enrolled', sdkVersion: '1.0.0', platform: 'test', enrollmentToken, ...extra });

async function newAdmin(role) {
  const email = `enroll_${randomBytes(4).toString('hex')}@federix.test`;
  const password = `Pw_${randomBytes(8).toString('hex')}`;
  await srv.api.auth.createAdminUser({ email, password, role, name: 'enroll' }, srv.superAdmin);
  return bearer((await srv.api.auth.adminLogin({ email, password })).accessToken);
}

test('Register without an enrollment token is refused', async () => {
  await assert.rejects(register(undefined), isCode(Code.Unauthenticated, /enrollment_token is missing or invalid/));
  await assert.rejects(register('fdx_enroll_' + '0'.repeat(64)), isCode(Code.Unauthenticated, /missing or invalid/));
  await assert.rejects(register('garbage'), isCode(Code.Unauthenticated, /missing or invalid/));
});

test('a valid token registers a client that is linked to it', async () => {
  const t = await create({ label: 'lab A', maxUses: 2 });
  assert.match(t.token, /^fdx_enroll_[0-9a-f]{64}$/);
  const reg = await register(t.token);
  const client = await Client.findOne({ client_id: reg.clientId }).lean();
  assert.equal(client.enrollment_token_id, t.tokenId);
  assert.ok((await srv.api.auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey })).accessToken);

  const stored = await EnrollmentToken.findOne({ token_id: t.tokenId }).lean();
  assert.equal(stored.uses, 1);
  assert.equal(stored.label, 'lab A');
  assert.ok(stored.last_used_at);
});

test('only a hash of the token is stored and the plaintext is never listed', async () => {
  const t = await create({ label: 'secret check' });
  const stored = await EnrollmentToken.findOne({ token_id: t.tokenId }).lean();
  assert.equal(stored.token_hash, hashToken(t.token));
  assert.equal(JSON.stringify(stored).includes(t.token), false);
  const listed = (await collect(srv.api.admin.listEnrollmentTokens({}, srv.superAdmin))).find((x) => x.tokenId === t.tokenId);
  assert.equal(JSON.stringify(listed, (k, v) => (typeof v === 'bigint' ? String(v) : v)).includes(t.token), false);
  assert.equal(listed.active, true);
});

test('a token stops working after max_uses registrations', async () => {
  const t = await create({ maxUses: 2 });
  await register(t.token);
  await register(t.token);
  await assert.rejects(register(t.token), isCode(Code.PermissionDenied, /used up/));
  assert.equal((await EnrollmentToken.findOne({ token_id: t.tokenId }).lean()).uses, 2);
});

test('10 concurrent registrations on a 3-use token register exactly 3 clients', async () => {
  const t = await create({ maxUses: 3 });
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => register(t.token)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.ok(isCode(Code.PermissionDenied, /used up/)(r.reason));
  assert.equal(await Client.countDocuments({ enrollment_token_id: t.tokenId }), 3);
  assert.equal((await EnrollmentToken.findOne({ token_id: t.tokenId }).lean()).uses, 3);
});

test('an expired token is refused', async () => {
  const t = await create({ maxUses: 5 });
  await EnrollmentToken.updateOne({ token_id: t.tokenId }, { expires_at: new Date(Date.now() - 1000) });
  await assert.rejects(register(t.token), isCode(Code.PermissionDenied, /expired/));
});

test('a revoked token is refused, but clients it already registered keep working', async () => {
  const t = await create({ maxUses: 5 });
  const reg = await register(t.token);
  assert.equal((await srv.api.admin.revokeEnrollmentToken({ tokenId: t.tokenId }, srv.superAdmin)).revoked, true);
  assert.equal((await srv.api.admin.revokeEnrollmentToken({ tokenId: t.tokenId }, srv.superAdmin)).revoked, true);

  await assert.rejects(register(t.token), isCode(Code.PermissionDenied, /revoked/));
  assert.ok((await srv.api.auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey })).accessToken);

  const revocations = await collect(srv.api.admin.getLogs({ eventType: 'enrollment.token_revoked' }, srv.superAdmin));
  assert.equal(revocations.filter((l) => JSON.parse(l.detailsJson).token_id === t.tokenId).length, 1);
  await assert.rejects(srv.api.admin.revokeEnrollmentToken({ tokenId: 'nope' }, srv.superAdmin), isCode(Code.NotFound));
});

test('ListEnrollmentTokens hides inactive tokens unless asked', async () => {
  const live = await create({ label: 'live', maxUses: 5 });
  const spent = await create({ label: 'spent', maxUses: 1 });
  await register(spent.token);

  const activeOnly = (await collect(srv.api.admin.listEnrollmentTokens({}, srv.superAdmin))).map((x) => x.tokenId);
  assert.ok(activeOnly.includes(live.tokenId));
  assert.equal(activeOnly.includes(spent.tokenId), false);

  const all = await collect(srv.api.admin.listEnrollmentTokens({ includeInactive: true }, srv.superAdmin));
  const spentEntry = all.find((x) => x.tokenId === spent.tokenId);
  assert.equal(spentEntry.active, false);
  assert.equal(spentEntry.uses, 1);
  assert.equal(spentEntry.maxUses, 1);
});

test('token limits come from configuration', async () => {
  await assert.rejects(create({ maxUses: 51 }), isCode(Code.InvalidArgument, /max_uses must be between 1 and 50/));
  await assert.rejects(create({ ttlHours: 49 }), isCode(Code.InvalidArgument, /ttl_hours must be between 1 and 48/));
  await assert.rejects(create({ label: 'x'.repeat(101) }), isCode(Code.InvalidArgument, /label/));

  const defaults = await srv.api.admin.createEnrollmentToken({}, srv.superAdmin);
  assert.equal(defaults.maxUses, 1);
  const hours = (new Date(defaults.expiresAt).getTime() - Date.now()) / 3600000;
  assert.ok(hours > 47 && hours <= 48, `default ttl ${hours}h`);
});

test('only admins and super admins manage enrollment tokens', async () => {
  const admin = await newAdmin(Role.ADMIN);
  const engineer = await newAdmin(Role.FL_ENGINEER);
  const sdk = await srv.newSdkClient('not-an-admin');
  assert.ok((await create({}, admin)).token);
  await assert.rejects(create({}, engineer), isCode(Code.PermissionDenied));
  await assert.rejects(create({}, sdk), isCode(Code.PermissionDenied));
  await assert.rejects(collect(srv.api.admin.listEnrollmentTokens({}, engineer)), isCode(Code.PermissionDenied));
});

test('an unsupported sdk_version is refused before the token is used', async () => {
  const t = await create({ maxUses: 1 });
  await assert.rejects(register(t.token, { sdkVersion: '0.9.0' }), isCode(Code.FailedPrecondition, /supported versions: 1\.0\.0, 1\.1\.0/));
  assert.equal((await EnrollmentToken.findOne({ token_id: t.tokenId }).lean()).uses, 0);
  assert.ok((await register(t.token, { sdkVersion: '1.1.0' })).clientId);
});

test('creating and using tokens is recorded in the audit log', async () => {
  const t = await create({ label: 'audited' });
  const reg = await register(t.token);
  const created = await collect(srv.api.admin.getLogs({ eventType: 'enrollment.token_created' }, srv.superAdmin));
  assert.ok(created.some((l) => JSON.parse(l.detailsJson).token_id === t.tokenId));
  const registered = await collect(srv.api.admin.getLogs({ eventType: 'client.registered', actor: reg.clientId }, srv.superAdmin));
  assert.equal(JSON.parse(registered[0].detailsJson).enrollment_token_id, t.tokenId);
});
