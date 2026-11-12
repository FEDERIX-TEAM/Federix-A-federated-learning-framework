import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer();
});

after(async () => {
  await srv?.stop();
});

test('the overview describes the federation with nothing running', async () => {
  const o = await srv.api.admin.getOverview({}, srv.superAdmin);
  assert.equal(o.currentRoundId, '');
  assert.equal(o.currentRoundNumber, 0);
  assert.equal(o.currentRoundDeadline, '');
  assert.equal(o.latestModelAccuracy, undefined);
  assert.equal(o.completedRounds, 0);
  assert.equal(o.bannedClients, 0);
});

test('the overview follows the running round, the active model and banned clients', async () => {
  await srv.api.admin.updateConfig({ minClientsPerRound: 1 }, srv.superAdmin);
  const round = await srv.api.admin.startRound({ maxClients: 4, deadlineSeconds: 600 }, srv.superAdmin);
  const a = await srv.newSdkClient('overview-a');
  const b = await srv.newSdkClient('overview-b');
  await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, a);
  await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, b);
  await srv.submitUpdate(a, { roundId: round.roundId });

  let o = await srv.api.admin.getOverview({}, srv.superAdmin);
  assert.equal(o.currentRoundId, round.roundId);
  assert.equal(o.currentRoundStatus, 'active');
  assert.equal(o.currentRoundNumber, round.roundNumber);
  assert.equal(o.currentRoundParticipants, 2);
  assert.equal(o.currentRoundMaxClients, 4);
  assert.equal(o.currentRoundUpdates, 1);
  assert.ok(Date.parse(o.currentRoundDeadline) > Date.parse(o.currentRoundStartedAt));
  assert.equal(o.totalClients, 2);

  await srv.completeRound(round.roundId, { globalAccuracy: 0.875, globalLoss: 0.41 });
  await srv.api.admin.banClient({ clientId: b.id, reason: 'test', durationHours: 1 }, srv.superAdmin);
  o = await srv.api.admin.getOverview({}, srv.superAdmin);
  assert.equal(o.currentRoundId, '');
  assert.equal(o.completedRounds, 1);
  assert.equal(o.latestModelAccuracy, 0.875);
  assert.equal(o.latestModelLoss, 0.41);
  assert.equal(o.bannedClients, 1);
});
