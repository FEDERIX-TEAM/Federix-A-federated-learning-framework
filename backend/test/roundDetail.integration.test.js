import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { RoundStatus, UpdateStatus, CompressionLevel } from '../src/gen/common_pb.js';
import { startTestServer, collect } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer();
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, mu: 0.05, localEpochs: 2, batchSize: 16 }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;

async function roundWithUpdates() {
  const round = await srv.api.admin.startRound({ maxClients: 3, deadlineSeconds: 600, notes: 'detail test' }, srv.superAdmin);
  const a = await srv.newSdkClient('alpha-device');
  const b = await srv.newSdkClient('beta-device');
  await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 400 }, a);
  await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 250 }, b);
  const sent = await srv.submitUpdate(a, { roundId: round.roundId, dataSize: 400, localLossBefore: 2, localLossAfter: 1, body: Buffer.alloc(3000, 1) });
  return { round, a, b, sent };
}

test('round detail tells the whole story of a round', async () => {
  const { round, a, b } = await roundWithUpdates();
  const d = await srv.api.admin.getRoundDetail({ roundId: round.roundId }, srv.superAdmin);
  assert.equal(d.roundNumber, round.roundNumber);
  assert.equal(d.maxClients, 3);
  assert.equal(d.minClients, 1);
  assert.equal(d.notes, 'detail test');
  assert.ok(Date.parse(d.deadline) > Date.parse(d.startedAt));
  assert.equal(d.status, RoundStatus.ACTIVE);
  assert.deepEqual(d.participants.map((p) => [p.clientId, p.clientName, p.status, p.localDataSize]), [
    [a.id, 'alpha-device', 'joined', 400],
    [b.id, 'beta-device', 'joined', 250],
  ]);
  assert.equal(d.config.mu, 0.05);
  assert.equal(d.config.localEpochs, 2);
  assert.equal(d.config.batchSize, 16);
  assert.ok(d.modelVersionBefore >= 0);

  const done = await srv.completeRound(round.roundId, { globalAccuracy: 0.8, globalLoss: 0.5 });
  const after = await srv.api.admin.getRoundDetail({ roundId: round.roundId }, srv.superAdmin);
  assert.equal(after.status, RoundStatus.COMPLETE);
  assert.equal(after.modelVersionAfter, done.newModelVersion);
  assert.ok(after.aggregatingStartedAt && after.readyAt);
  assert.equal(after.endReason, '');
});

test('round updates explain size, compression, losses and why one was left out', async () => {
  const { round, a, sent } = await roundWithUpdates();
  let [entry] = await collect(srv.api.admin.listRoundUpdates({ roundId: round.roundId }, srv.superAdmin));
  assert.equal(entry.updateId, sent.prepared.updateId);
  assert.equal(entry.clientName, 'alpha-device');
  assert.equal(entry.bytes, 3000n);
  assert.equal(entry.dataSize, 400);
  assert.equal(entry.localLossBefore, 2);
  assert.equal(entry.localLossAfter, 1);
  assert.ok(entry.compressionRatio > 0);
  assert.ok([CompressionLevel.NONE, CompressionLevel.PARTIAL, CompressionLevel.FULL].includes(entry.compressionLevel));
  assert.ok(entry.preparedAt && entry.submittedAt);
  assert.equal(entry.reason, '');
  assert.ok(['accepted', 'compressed'].includes(entry.stage));

  const ups = await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal));
  await srv.api.fl.triggerRound({ roundId: round.roundId }, srv.internal);
  await srv.api.fl.failRound({ roundId: round.roundId, reason: 'nothing usable', rejectionReasons: { [ups[0].updateId]: 'update norm 9.1 is above 5x the round median' } }, srv.internal);
  [entry] = await collect(srv.api.admin.listRoundUpdates({ roundId: round.roundId }, srv.superAdmin));
  assert.equal(entry.status, UpdateStatus.REJECTED);
  assert.equal(entry.reason, 'update norm 9.1 is above 5x the round median');
  const d = await srv.api.admin.getRoundDetail({ roundId: round.roundId }, srv.superAdmin);
  assert.equal(d.status, RoundStatus.FAILED);
  assert.equal(d.endReason, 'FL server: nothing usable');
  assert.ok(a.id);
});

test('the rounds list carries capacity, usable updates, the model produced and why a round ended', async () => {
  const { round } = await roundWithUpdates();
  let [first] = await collect(srv.api.admin.listRounds({ page: 1, limit: 1 }, srv.superAdmin));
  assert.equal(first.roundId, round.roundId);
  assert.equal(first.maxClients, 3);
  assert.equal(first.usableUpdates, 1);
  assert.equal(first.notes, 'detail test');
  assert.equal(first.globalLoss, undefined);

  await srv.api.admin.stopRound({ roundId: round.roundId, reason: 'x'.repeat(800) }, srv.superAdmin);
  [first] = await collect(srv.api.admin.listRounds({ page: 1, limit: 1 }, srv.superAdmin));
  assert.equal(first.status, RoundStatus.ABORTED);
  assert.equal(first.endReason.length, 500);
  assert.equal(first.usableUpdates, 0);

  const stopped = await collect(srv.api.admin.listRounds({ status: 'aborted' }, srv.superAdmin));
  assert.ok(stopped.every((r) => r.status === RoundStatus.ABORTED));
});

test('stopping a round that already finished is refused and never rewrites its outcome', async () => {
  const { round } = await roundWithUpdates();
  await srv.completeRound(round.roundId);
  await assert.rejects(srv.api.admin.stopRound({ roundId: round.roundId, reason: 'late' }, srv.superAdmin), isCode(Code.FailedPrecondition));
  const d = await srv.api.admin.getRoundDetail({ roundId: round.roundId }, srv.superAdmin);
  assert.equal(d.status, RoundStatus.COMPLETE);
});

test('a start note longer than 500 characters is refused', async () => {
  await assert.rejects(srv.api.admin.startRound({ maxClients: 2, deadlineSeconds: 60, notes: 'n'.repeat(501) }, srv.superAdmin), isCode(Code.InvalidArgument));
});
