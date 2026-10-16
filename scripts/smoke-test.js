/* End-to-end smoke test: drives every RPC of every service through a real Connect client.
 *
 *   1. start MongoDB + Redis + the server (npm start)
 *   2. npm run seed:super-admin   (or set SEED_* env, see seed script)
 *   3. SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... npm run smoke
 *
 * Env: SERVER_URL (default http://127.0.0.1:4000), INTERNAL_SERVICE_TOKEN (must match the server's).
 * It creates throw-away users/clients/rounds with a random suffix; it does not clean the database.
 */
import { createClient, Code, ConnectError } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AuthService } from '../src/gen/auth_pb.js';
import { ClientService } from '../src/gen/client_pb.js';
import { AdminService } from '../src/gen/admin_pb.js';
import { SystemService } from '../src/gen/system_pb.js';
import { FlBridgeService } from '../src/gen/fl_bridge_pb.js';
import { EventStreamService } from '../src/gen/events_pb.js';
import { Role, RoundStatus, UpdateStatus } from '../src/gen/common_pb.js';

const BASE = process.env.SERVER_URL || 'http://127.0.0.1:4000';
const INTERNAL = process.env.INTERNAL_SERVICE_TOKEN || 'dev_internal_service_token_change_me';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'admin@federix.test';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'ChangeMe123!';
const sfx = Math.random().toString(36).slice(2, 8);

const transport = createConnectTransport({ baseUrl: BASE, httpVersion: '1.1' });
const auth = createClient(AuthService, transport);
const client = createClient(ClientService, transport);
const admin = createClient(AdminService, transport);
const system = createClient(SystemService, transport);
const fl = createClient(FlBridgeService, transport);
const events = createClient(EventStreamService, transport);

const bearer = (t) => ({ headers: { authorization: `Bearer ${t}` } });
const internal = { headers: { 'x-internal-service-token': INTERNAL } };
const collect = async (stream) => { const out = []; for await (const m of stream) out.push(m); return out; };

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✔ ${name}`); }
  else { failed += 1; console.log(`  ✘ ${name} ${extra}`); }
}
async function expectCode(name, code, fn) {
  try { await fn(); check(name, false, '(no error thrown)'); }
  catch (e) { check(name, e instanceof ConnectError && e.code === code, `(got ${e instanceof ConnectError ? Code[e.code] : e})`); }
}
const section = (s) => console.log(`\n▸ ${s}`);

async function main() {
  section('System (public)');
  check('HealthCheck ok', (await system.healthCheck({})).status === 'ok');
  check('GetVersion', (await system.getVersion({})).apiVersion === 'v1');
  check('GetPublicConfig', (await system.getPublicConfig({})).supportedSdkVersions.length > 0);

  section('Auth: admins');
  const login = await auth.adminLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('AdminLogin as super_admin', login.role === Role.SUPER_ADMIN);
  const SA = bearer(login.accessToken);
  await expectCode('AdminLogin wrong password -> Unauthenticated', Code.Unauthenticated, () => auth.adminLogin({ email: ADMIN_EMAIL, password: 'nope' }));
  const me = await auth.getMe({}, SA);
  check('GetMe', me.role === Role.SUPER_ADMIN);

  const mk = async (role, tag) => {
    const email = `${tag}.${sfx}@federix.test`;
    const created = await auth.createAdminUser({ email, password: 'Passw0rd!123', role, name: tag }, SA);
    const l = await auth.adminLogin({ email, password: 'Passw0rd!123' });
    return { id: created.userId, ...bearer(l.accessToken), token: l.accessToken, refresh: l.refreshToken };
  };
  const adminUser = await mk(Role.ADMIN, 'admin');
  const engineer = await mk(Role.FL_ENGINEER, 'engineer');
  const viewer = await mk(Role.VIEWER, 'viewer');
  check('CreateAdminUser x3', !!adminUser.id && !!engineer.id && !!viewer.id);
  await expectCode('CreateAdminUser duplicate -> AlreadyExists', Code.AlreadyExists, () => auth.createAdminUser({ email: `admin.${sfx}@federix.test`, password: 'Passw0rd!123', role: Role.ADMIN, name: 'x' }, SA));
  await expectCode('CreateAdminUser as admin -> PermissionDenied', Code.PermissionDenied, () => auth.createAdminUser({ email: `z.${sfx}@federix.test`, password: 'Passw0rd!123', role: Role.VIEWER, name: 'z' }, adminUser));
  const refreshed = await auth.refreshToken({ refreshToken: adminUser.refresh });
  check('RefreshToken', !!refreshed.accessToken);

  section('Auth: clients');
  const clients = [];
  for (let i = 0; i < 3; i += 1) {
    const reg = await auth.register({ name: `smoke-${sfx}-${i}`, description: 'smoke', sdkVersion: '1.0.0', platform: 'linux' });
    const tok = await auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey });
    clients.push({ id: reg.clientId, apiKey: reg.apiKey, ...bearer(tok.accessToken), token: tok.accessToken });
  }
  check('Register + ClientLogin x3', clients.every((c) => c.id && c.token));
  await expectCode('ClientLogin bad key -> Unauthenticated', Code.Unauthenticated, () => auth.clientLogin({ clientId: clients[0].id, apiKey: 'fdx_bad' }));
  await expectCode('Client token on admin RPC -> PermissionDenied', Code.PermissionDenied, () => collect(admin.listUsers({}, clients[0])));
  await expectCode('No token -> Unauthenticated', Code.Unauthenticated, () => client.getStatus({}));
  const cme = await auth.getMe({}, clients[0]);
  check('GetMe as client', cme.role === Role.SDK_CLIENT && cme.id === clients[0].id);
  const rotated = await auth.rotateClientKey({ clientId: clients[2].id }, SA);
  check('RotateClientKey', rotated.newApiKey.startsWith('fdx_') && rotated.newApiKey !== clients[2].apiKey);
  await expectCode('Old key rejected after rotate', Code.Unauthenticated, () => auth.clientLogin({ clientId: clients[2].id, apiKey: clients[2].apiKey }));
  await auth.clientLogin({ clientId: clients[2].id, apiKey: rotated.newApiKey });

  section('Config');
  const cfg = await admin.getConfig({}, viewer);
  check('GetConfig as viewer', cfg.minClientsPerRound >= 1);
  await expectCode('UpdateConfig as admin -> PermissionDenied', Code.PermissionDenied, () => admin.updateConfig({ mu: 0.5 }, adminUser));
  await expectCode('UpdateConfig invalid -> InvalidArgument', Code.InvalidArgument, () => admin.updateConfig({ utilityThresholdLow: 0.9, utilityThresholdHigh: 0.1 }, SA));
  const upd = await admin.updateConfig({ minClientsPerRound: 2, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5, mu: 0.02 }, SA);
  check('UpdateConfig', upd.updatedConfig.minClientsPerRound === 2 && upd.updatedConfig.mu === 0.02);
  check('GetConfigHistory', (await collect(admin.getConfigHistory({}, adminUser))).length >= 1);
  const ccfg = await client.getConfig({}, clients[0]);
  check('Client GetConfig', ccfg.mu === 0.02 && ccfg.compressionThreshold === 0.5);

  section('Event stream + round lifecycle');
  const adminEvents = []; const clientEvents = [];
  const ac1 = new AbortController(); const ac2 = new AbortController();
  const pump = (stream, sink) => (async () => { try { for await (const e of stream) sink.push(e.type); } catch { /* aborted */ } })();
  const p1 = pump(events.subscribe({}, { ...SA, signal: ac1.signal }), adminEvents);
  const p2 = pump(events.subscribe({}, { ...clients[0], signal: ac2.signal }), clientEvents);
  await new Promise((r) => setTimeout(r, 400));

  await expectCode('StartRound as viewer -> PermissionDenied', Code.PermissionDenied, () => admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, viewer));
  await expectCode('GetCurrentRound with none running -> NotFound', Code.NotFound, async () => {
    const running = await collect(admin.listRounds({ status: 'active' }, SA));
    for (const r of running) await admin.stopRound({ roundId: r.roundId, reason: 'smoke cleanup' }, SA);
    return client.getCurrentRound({}, clients[0]);
  });
  const start = await admin.startRound({ maxClients: 10, deadlineSeconds: 600, notes: 'smoke' }, engineer);
  check('StartRound as fl_engineer', !!start.roundId && start.roundNumber >= 1);
  await expectCode('StartRound while one is running -> FailedPrecondition', Code.FailedPrecondition, () => admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, SA));
  const cur = await client.getCurrentRound({}, clients[0]);
  check('GetCurrentRound', cur.roundId === start.roundId);

  for (const c of clients) {
    const j = await client.joinRound({ roundId: start.roundId, localDataSize: 800, deviceInfo: { entries: { os: 'linux' } } }, c);
    check(`JoinRound ${c.id.slice(0, 6)}`, j.accepted === true);
  }
  check('Heartbeat', (await client.heartbeat({ roundId: start.roundId }, clients[0])).ok);
  check('Client GetStatus', (await client.getStatus({}, clients[0])).roundCount >= 1);
  const lv = await client.leaveRound({ roundId: start.roundId, reason: 'test' }, clients[2]);
  check('LeaveRound', lv.success && lv.remainingParticipants === 2);
  await expectCode('LeaveRound again -> FailedPrecondition', Code.FailedPrecondition, () => client.leaveRound({ roundId: start.roundId }, clients[2]));
  const rejoin = await client.joinRound({ roundId: start.roundId, localDataSize: 800 }, clients[2]);
  check('Re-JoinRound after leaving', rejoin.accepted);

  // good, mediocre, and poor updates -> accepted / compressed / rejected
  const submit = (c, before, after, size, dist) => client.submitUpdate({
    roundId: start.roundId, deltaWeightsUrl: `s3://bucket/${c.id}.bin`, localLossBefore: before, localLossAfter: after,
    labelDistribution: { counts: dist }, dataSize: size, trainingTimeMs: 1200,
  }, c);
  const s0 = await submit(clients[0], 1.0, 0.2, 5000, { a: 100, b: 100, c: 100 });
  const s1 = await submit(clients[1], 1.0, 0.9, 200, { a: 100 });
  const s2 = await submit(clients[2], 1.0, 1.0, 1, { a: 1 });
  check('SubmitUpdate good -> accepted', s0.accepted && !s0.compressionRequired);
  check('SubmitUpdate mediocre -> compression_required', s1.accepted && s1.compressionRequired);
  check('SubmitUpdate poor -> rejected', s2.accepted === false);
  const s0b = await submit(clients[0], 1.0, 0.2, 5000, { a: 100, b: 100, c: 100 });
  check('Resubmit keeps update_id', s0b.updateId === s0.updateId);
  const st = await client.getUpdateStatus({ roundId: start.roundId }, clients[0]);
  check('GetUpdateStatus', st.status === UpdateStatus.ACCEPTED && st.utilityScore > 0.5);
  check('GetUpdateStatus rejected has reason', (await client.getUpdateStatus({ roundId: start.roundId }, clients[2])).reason.length > 0);
  check('GetSelfMetrics', (await collect(client.getSelfMetrics({ limit: 5 }, clients[0]))).length >= 1);
  const md = await client.getModelDownload({ roundId: start.roundId }, clients[0]).catch((e) => e);
  check('GetModelDownload for round (NotFound if no model yet, else signed URL)', md instanceof ConnectError ? md.code === Code.NotFound : md.downloadUrl.includes('sig='));

  section('Admin: inspect round');
  check('ListRounds', (await collect(admin.listRounds({ limit: 5 }, viewer))).some((r) => r.roundId === start.roundId));
  const rd = await admin.getRoundDetail({ roundId: start.roundId }, engineer);
  check('GetRoundDetail', rd.updates.length === 3 && rd.status === RoundStatus.ACTIVE);
  check('ListRoundUpdates', (await collect(admin.listRoundUpdates({ roundId: start.roundId }, SA))).length === 3);
  const ov = await admin.getOverview({}, viewer);
  check('GetOverview', ov.currentRoundId === start.roundId && ov.totalClients >= 3);
  check('ListClients', (await collect(admin.listClients({ limit: 100 }, adminUser))).some((c) => c.clientId === clients[0].id));
  const cd = await admin.getClientDetail({ clientId: clients[0].id }, engineer);
  check('GetClientDetail', cd.history.length === 1 && cd.labelEntropyAvg > 0.9);

  section('FL bridge (internal token)');
  await expectCode('Bad internal token -> Unauthenticated', Code.Unauthenticated, () => fl.getFlConfig({}, { headers: { 'x-internal-service-token': 'wrong' } }));
  await expectCode('FL RPC with JWT only -> Unauthenticated', Code.Unauthenticated, () => fl.getFlConfig({}, SA));
  check('GetFlStatus (internal)', (await fl.getFlStatus({}, internal)).status === 'ok');
  check('GetFlStatus (super_admin JWT)', (await fl.getFlStatus({}, SA)).status === 'ok');
  await expectCode('GetFlStatus as admin -> PermissionDenied', Code.PermissionDenied, () => fl.getFlStatus({}, adminUser));
  check('GetFlConfig', (await fl.getFlConfig({}, internal)).minClients === 2);
  const ups = await collect(fl.getRoundUpdates({ roundId: start.roundId }, internal));
  check('GetRoundUpdates returns accepted+compressed only', ups.length === 2 && ups.every((u) => u.downloadUrl.startsWith('/storage/updates/')));
  const util = await collect(fl.computeUtility({ roundId: start.roundId, updateIds: [s0.updateId, s1.updateId, s2.updateId] }, internal));
  check('ComputeUtility', util.length === 3);
  const trig = await fl.triggerRound({ roundId: start.roundId, updateIds: ups.map((u) => u.updateId) }, internal);
  check('TriggerRound', trig.accepted && trig.estimatedDurationMs >= 5000);
  check('Round is aggregating', (await admin.getRoundDetail({ roundId: start.roundId }, SA)).status === RoundStatus.AGGREGATING);
  await expectCode('SubmitUpdate while aggregating -> FailedPrecondition', Code.FailedPrecondition, () => submit(clients[0], 1, 0.5, 100, {}));
  const done = await fl.completeRound({ roundId: start.roundId, newModelVersion: 1000 + Math.floor(Math.random() * 1e6), modelUrl: 's3://m/v1.bin', globalLoss: 0.42, globalAccuracy: 0.87 }, internal);
  check('CompleteRound', done.success && !!done.modelId);
  const pushVersion = 2000000 + Math.floor(Math.random() * 1e6);
  const push = await fl.pushModel({ modelVersion: pushVersion, weightsUrl: 's3://m/extra.bin', metrics: { globalLoss: 0.4, globalAccuracy: 0.9 } }, internal);
  check('PushModel', push.stored && !!push.modelId);
  await expectCode('PushModel duplicate version -> AlreadyExists', Code.AlreadyExists, () => fl.pushModel({ modelVersion: pushVersion, weightsUrl: 'x' }, internal));

  section('Models + signed URLs');
  const models = await collect(admin.listModels({}, viewer));
  check('ListModels', models.length >= 2);
  const active = models.find((m) => m.modelVersion === pushVersion);
  const dl = await admin.getModelDownload({ modelId: active.modelId }, engineer);
  check('Admin GetModelDownload', dl.downloadUrl.includes('sig='));
  const cdl = await client.getModelDownload({}, clients[0]);
  check('Client GetModelDownload (active)', cdl.modelVersion === pushVersion);
  const bad = await fetch(BASE + dl.downloadUrl.replace(/sig=[0-9a-f]+/, 'sig=deadbeef'));
  check('Tampered signed URL -> 403', bad.status === 403);
  const missing = await fetch(BASE + dl.downloadUrl);
  check('Valid signed URL, file absent -> 404', missing.status === 404);
  await expectCode('DeleteModel active -> FailedPrecondition', Code.FailedPrecondition, () => admin.deleteModel({ modelId: active.modelId }, SA));
  const old = models.find((m) => m.modelVersion !== pushVersion);
  check('DeleteModel inactive', (await admin.deleteModel({ modelId: old.modelId }, SA)).deleted);

  section('Metrics');
  check('GetConvergenceMetrics', (await collect(admin.getConvergenceMetrics({ lastNRounds: 5 }, viewer))).length >= 1);
  check('GetClientMetrics', (await collect(admin.getClientMetrics({ clientId: clients[0].id }, engineer))).length === 1);
  const comm = await collect(admin.getCommunicationMetrics({}, viewer));
  check('GetCommunicationMetrics', comm.length >= 1 && typeof comm[0].bytesReceived === 'bigint');
  check('GetFairnessMetrics', (await collect(admin.getFairnessMetrics({}, engineer))).length >= 1);

  section('Ban / unban / logs / users');
  await expectCode('BanClient as engineer -> PermissionDenied', Code.PermissionDenied, () => admin.banClient({ clientId: clients[1].id }, engineer));
  const ban = await admin.banClient({ clientId: clients[1].id, reason: 'smoke', durationHours: 1 }, adminUser);
  check('BanClient (timed)', ban.success && ban.bannedUntil !== '');
  await expectCode('Banned client login -> PermissionDenied', Code.PermissionDenied, () => auth.clientLogin({ clientId: clients[1].id, apiKey: clients[1].apiKey }));
  check('ListClients status=banned', (await collect(admin.listClients({ status: 'banned' }, SA))).some((c) => c.clientId === clients[1].id));
  check('UnbanClient', (await admin.unbanClient({ clientId: clients[1].id }, adminUser)).success);
  const permBan = await admin.banClient({ clientId: clients[1].id, durationHours: 0 }, SA);
  check('BanClient (permanent -> empty banned_until)', permBan.success && permBan.bannedUntil === '');
  await admin.unbanClient({ clientId: clients[1].id }, SA);
  const logs = await collect(admin.getLogs({ eventType: 'client.banned', limit: 10 }, adminUser));
  check('GetLogs filtered', logs.length >= 1 && logs.every((l) => l.eventType === 'client.banned'));
  await expectCode('GetLogs bad date -> InvalidArgument', Code.InvalidArgument, () => collect(admin.getLogs({ fromDate: 'garbage' }, SA)));
  const users = await collect(admin.listUsers({}, SA));
  check('ListUsers', users.length >= 4);
  const ur = await admin.updateUserRole({ userId: viewer.id, role: Role.FL_ENGINEER }, SA);
  check('UpdateUserRole', ur.newRole === Role.FL_ENGINEER);
  await expectCode('UpdateUserRole to super_admin -> InvalidArgument', Code.InvalidArgument, () => admin.updateUserRole({ userId: viewer.id, role: Role.SUPER_ADMIN }, SA));
  await expectCode('DeleteUser self -> FailedPrecondition', Code.FailedPrecondition, () => admin.deleteUser({ userId: me.id }, SA));
  check('DeleteUser', (await admin.deleteUser({ userId: viewer.id }, SA)).deleted);

  section('Stop round (second round)');
  const r2 = await admin.startRound({}, SA); // 0/0 -> configured defaults
  const stopped = await admin.stopRound({ roundId: r2.roundId, reason: 'smoke' }, adminUser);
  check('StartRound defaults + StopRound', stopped.success && stopped.roundStatus === RoundStatus.ABORTED);
  await expectCode('StopRound again -> FailedPrecondition', Code.FailedPrecondition, () => admin.stopRound({ roundId: r2.roundId }, SA));

  section('Maintenance mode + stats');
  check('GetStats', (await system.getStats({}, SA)).activeConnections >= 2);
  await expectCode('GetStats as viewer-less/engineer -> PermissionDenied', Code.PermissionDenied, () => system.getStats({}, engineer));
  const mm = await system.setMaintenance({ enabled: true, message: 'back soon', estimatedDurationMinutes: 5 }, SA);
  check('SetMaintenance on', mm.maintenanceMode);
  await expectCode('Client RPC during maintenance -> Unavailable', Code.Unavailable, () => client.getStatus({}, clients[0]));
  await expectCode('FL RPC during maintenance -> Unavailable', Code.Unavailable, () => fl.getFlConfig({}, internal));
  check('Admin RPC still works in maintenance', (await admin.getOverview({}, SA)).health === 'ok');
  await system.setMaintenance({ enabled: false }, SA);
  check('Client RPC after maintenance off', (await client.getStatus({}, clients[0])).clientId === clients[0].id);

  section('Event delivery');
  await new Promise((r) => setTimeout(r, 300));
  ac1.abort(); ac2.abort(); await Promise.all([p1, p2]);
  check('Admin stream got connected+round_started+round_completed', ['connected', 'round_started', 'round_completed', 'round_update_received', 'client_banned'].every((t) => adminEvents.includes(t)), JSON.stringify([...new Set(adminEvents)]));
  check('Client stream got round events only', clientEvents.includes('round_started') && clientEvents.includes('round_completed') && !clientEvents.includes('round_update_received') && !clientEvents.includes('client_banned'), JSON.stringify([...new Set(clientEvents)]));
  check('Both streams got system_maintenance', adminEvents.includes('system_maintenance') && clientEvents.includes('system_maintenance'));

  section('Logout, delete client, flush');
  await auth.logout({}, adminUser);
  await expectCode('Token rejected after Logout', Code.Unauthenticated, () => auth.getMe({}, adminUser));
  await expectCode('DeleteClient as admin -> PermissionDenied', Code.PermissionDenied, () => admin.deleteClient({ clientId: clients[0].id }, engineer));
  const del = await admin.deleteClient({ clientId: clients[0].id }, SA);
  check('DeleteClient purges updates', del.deleted && del.purgedRecords >= 1);
  await expectCode('GetClientDetail after delete -> NotFound', Code.NotFound, () => admin.getClientDetail({ clientId: clients[0].id }, SA));
  const fx = await system.flushCache({}, SA);
  check('FlushCache', typeof fx.flushedKeys === 'number' && fx.warning.length > 0);
  await auth.logout({}, SA);

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nSMOKE TEST CRASHED:', e); process.exit(2); });
