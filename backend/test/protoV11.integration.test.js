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

test('PrepareUpdate: SDK clients reach the handler, others are refused', async () => {
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'no-such-round', localLossBefore: 1, localLossAfter: 0.5, dataSize: 1, trainingTimeMs: 1 }, client), isCode(Code.NotFound));
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'r' }, srv.superAdmin), isCode(Code.PermissionDenied));
  await assert.rejects(srv.api.client.prepareUpdate({ roundId: 'r' }), isCode(Code.Unauthenticated));
});

test('WatchRounds, GetModelUploadUrl and ReportFlStatus need the internal token', async () => {
  const ac = new AbortController();
  const stream = srv.api.fl.watchRounds({ workerId: 'w1' }, { ...srv.internal, signal: ac.signal });
  const reader = (async () => {
    try {
      for await (const e of stream) return e;
    } catch {
      return null;
    }
    return null;
  })();
  await new Promise((r) => setTimeout(r, 200));
  ac.abort();
  await reader;
  assert.match((await srv.api.fl.getModelUploadUrl({ modelVersion: 1 }, srv.internal)).upload.url, /\/storage\/models\/1\?/);
  assert.equal((await srv.api.fl.reportFlStatus({ workerId: 'w1', state: FlServerState.IDLE }, srv.internal)).accepted, true);

  await assert.rejects(collect(srv.api.fl.watchRounds({}, client)), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: 1 }, srv.superAdmin), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.reportFlStatus({}), isCode(Code.Unauthenticated));
});

test('GetFlServerStatus is open to dashboard roles only', async () => {
  assert.equal((await srv.api.admin.getFlServerStatus({}, srv.superAdmin)).workerId, 'w1');
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
  const version = await srv.nextModelVersion();
  await srv.uploadModel(version);
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: `/models/${version}` }, srv.internal);
  const m = (await collect(srv.api.admin.listModels({}, srv.superAdmin))).find((x) => x.modelVersion === version);
  assert.equal(m.format, 'bin');
});

test('the old one-shot SubmitUpdate with a client-supplied URL is refused with guidance', async () => {
  await srv.api.admin.updateConfig({ minClientsPerRound: 1 }, srv.superAdmin);
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 500 }, client);
    await assert.rejects(
      srv.api.client.submitUpdate({
        roundId: round.roundId, deltaWeightsUrl: 'http://attacker.example/x', localLossBefore: 1, localLossAfter: 0.2,
        labelDistribution: { counts: { a: 5 } }, dataSize: 500, trainingTimeMs: 10,
      }, client),
      (err) => isCode(Code.InvalidArgument)(err) && /call PrepareUpdate/.test(err.message)
    );
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});
