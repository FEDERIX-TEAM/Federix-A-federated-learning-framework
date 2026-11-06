import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { AuthService } from '../src/gen/auth_pb.js';
import { ClientService } from '../src/gen/client_pb.js';
import { AdminService } from '../src/gen/admin_pb.js';
import { SystemService } from '../src/gen/system_pb.js';
import { FlBridgeService } from '../src/gen/fl_bridge_pb.js';
import { EventStreamService } from '../src/gen/events_pb.js';
import { FlServerState, RoundReadyReason } from '../src/gen/common_pb.js';
import { ruleFor } from '../interceptors/rbacRules.js';
import { SystemConfig } from '../models/SystemConfig.js';
import { startTestServer, collect } from './support/testServer.js';

let srv;
let client;

before(async () => {
  srv = await startTestServer();
  client = await srv.newSdkClient('proto-v11');
});

after(async () => {
  await srv?.stop();
});

const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;
const unimplemented = (err) => isCode(Code.Unimplemented)(err) && /protocol v1\.1/.test(err.message);

test('every RPC in every service has an access rule', () => {
  const missing = [];
  for (const service of [AuthService, ClientService, AdminService, SystemService, FlBridgeService, EventStreamService]) {
    for (const method of service.methods) {
      if (ruleFor(service.name, method.name) === undefined) missing.push(`${service.name}.${method.name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the new RPCs exist in the generated contract', () => {
  const names = (svc) => svc.methods.map((m) => m.name);
  assert.ok(names(ClientService).includes('PrepareUpdate'));
  for (const rpc of ['WatchRounds', 'GetModelUploadUrl', 'ReportFlStatus']) assert.ok(names(FlBridgeService).includes(rpc), rpc);
  assert.ok(names(AdminService).includes('GetFlServerStatus'));
  assert.equal(FlBridgeService.method.watchRounds.methodKind, 'server_streaming');
  assert.equal(RoundReadyReason.ALL_SUBMITTED, 2);
  assert.equal(FlServerState.AGGREGATING, 3);
});

test('PrepareUpdate: SDK clients reach the not-yet-implemented handler, others are refused', async () => {
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'r' }, client), unimplemented);
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'r' }, srv.superAdmin), isCode(Code.PermissionDenied));
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'r' }), isCode(Code.Unauthenticated));
});

test('WatchRounds, GetModelUploadUrl and ReportFlStatus need the internal token', async () => {
  await assert.rejects(collect(srv.api.fl.watchRounds({ workerId: 'w1' }, srv.internal)), unimplemented);
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: 1 }, srv.internal), unimplemented);
  await assert.rejects(srv.api.fl.reportFlStatus({ workerId: 'w1', state: FlServerState.IDLE }, srv.internal), unimplemented);

  await assert.rejects(collect(srv.api.fl.watchRounds({}, client)), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: 1 }, srv.superAdmin), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.reportFlStatus({}), isCode(Code.Unauthenticated));
});

test('GetFlServerStatus is open to dashboard roles only', async () => {
  await assert.rejects(srv.api.admin.getFlServerStatus({}, srv.superAdmin), unimplemented);
  await assert.rejects(srv.api.admin.getFlServerStatus({}, client), isCode(Code.PermissionDenied));
  await assert.rejects(srv.api.admin.getFlServerStatus({}), isCode(Code.Unauthenticated));
});

test('admin GetConfig now includes local_epochs and batch_size', async () => {
  await srv.api.admin.updateConfig({ localEpochs: 4, batchSize: 48 }, srv.superAdmin);
  const cfg = await srv.api.admin.getConfig({}, srv.superAdmin);
  const stored = await SystemConfig.findOne({ singleton_key: 'active_config' }).lean();
  assert.equal(cfg.localEpochs, 4);
  assert.equal(cfg.batchSize, 48);
  assert.equal(cfg.localEpochs, stored.local_epochs);
});

test('GetFlConfig now includes local_epochs, batch_size and max_clients', async () => {
  await srv.api.admin.updateConfig({ localEpochs: 5, batchSize: 64, maxClientsPerRound: 42 }, srv.superAdmin);
  const fl = await srv.api.fl.getFlConfig({}, srv.internal);
  assert.equal(fl.localEpochs, 5);
  assert.equal(fl.batchSize, 64);
  assert.equal(fl.maxClients, 42);
});

test('ListModels reports the stored model format', async () => {
  const version = 1 + Math.floor(Math.random() * 1e9);
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: `/models/${version}` }, srv.internal);
  const m = (await collect(srv.api.admin.listModels({}, srv.superAdmin))).find((x) => x.modelVersion === version);
  assert.equal(m.format, 'bin');
});

test('existing calls keep working when they send the new optional fields', async () => {
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5 }, srv.superAdmin);
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  await srv.api.client.joinRound({ roundId: round.roundId }, client);
  const res = await srv.api.client.submitUpdate({
    roundId: round.roundId, deltaWeightsUrl: 's3://u.bin', localLossBefore: 1, localLossAfter: 0.2,
    labelDistribution: { counts: { a: 5, b: 5 } }, dataSize: 500, trainingTimeMs: 10,
    updateId: 'ignored-for-now', sha256: 'f'.repeat(64),
  }, client);
  assert.equal(res.accepted, true);

  const ups = await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal));
  await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: ups.map((u) => u.updateId) }, srv.internal);
  const done = await srv.api.fl.completeRound({
    roundId: round.roundId,
    newModelVersion: 1 + Math.floor(Math.random() * 1e9),
    modelUrl: '/models/x',
    globalLoss: 0.3,
    globalAccuracy: 0.9,
    usedUpdateIds: ups.map((u) => u.updateId),
  }, srv.internal);
  assert.equal(done.success, true);
});
