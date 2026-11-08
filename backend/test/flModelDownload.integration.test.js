import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { Update } from '../models/Update.js';
import { startTestServer, collect } from './support/testServer.js';

let srv;
let client;

before(async () => {
  srv = await startTestServer();
  client = await srv.newSdkClient('fl-download');
});

after(async () => {
  await srv?.stop();
});

const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;

test('GetModelDownloadUrl reports when there is no model yet', async () => {
  await assert.rejects(srv.api.fl.getModelDownloadUrl({}, srv.internal), isCode(Code.NotFound));
  await assert.rejects(srv.api.fl.getModelDownloadUrl({ modelVersion: 0 }, srv.internal), isCode(Code.InvalidArgument));
});

test('GetModelDownloadUrl signs the active model or a named version for the FL server', async () => {
  const first = await srv.nextModelVersion();
  const a = await srv.uploadModel(first, Buffer.from('model-one'));
  await srv.api.fl.pushModel({ modelVersion: first, weightsUrl: a.resourcePath }, srv.internal);
  const second = first + 1;
  const b = await srv.uploadModel(second, Buffer.from('model-two-bytes'));
  await srv.api.fl.pushModel({ modelVersion: second, weightsUrl: b.resourcePath }, srv.internal);

  const active = await srv.api.fl.getModelDownloadUrl({}, srv.internal);
  assert.equal(active.modelVersion, second);
  assert.equal(active.sha256, b.sha256);
  assert.equal(active.sizeBytes, BigInt(b.bytes));
  assert.ok(Date.parse(active.refreshUntil) >= Date.parse(active.expiresAt));
  const body = Buffer.from(await (await fetch(active.downloadUrl)).arrayBuffer());
  assert.equal(createHash('sha256').update(body).digest('hex'), b.sha256);

  const old = await srv.api.fl.getModelDownloadUrl({ modelVersion: first }, srv.internal);
  assert.equal(old.modelVersion, first);
  assert.equal(Buffer.from(await (await fetch(old.downloadUrl)).arrayBuffer()).toString(), 'model-one');
  await assert.rejects(srv.api.fl.getModelDownloadUrl({ modelVersion: second + 50 }, srv.internal), isCode(Code.NotFound));
});

test('GetModelDownloadUrl needs the internal token', async () => {
  await assert.rejects(srv.api.fl.getModelDownloadUrl({}, srv.superAdmin), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.getModelDownloadUrl({}, client), isCode(Code.Unauthenticated));
  await assert.rejects(srv.api.fl.getModelDownloadUrl({}), isCode(Code.Unauthenticated));
});

async function updateReasons(roundId) {
  const docs = await Update.find({ round_id: roundId }).lean();
  return Object.fromEntries(docs.map((d) => [d.update_id, d.status === 'rejected' ? d.reason : null]));
}

async function aggregatingRound(clients = 3) {
  await srv.api.admin.updateConfig({ minClientsPerRound: 1 }, srv.superAdmin);
  const round = await srv.api.admin.startRound({ maxClients: clients, deadlineSeconds: 600 }, srv.superAdmin);
  const updates = [];
  for (let i = 0; i < clients; i += 1) {
    const c = await srv.newSdkClient(`fail-${i}`);
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, c);
    updates.push((await srv.submitUpdate(c, { roundId: round.roundId })).prepared.updateId);
  }
  await srv.api.fl.triggerRound({ roundId: round.roundId }, srv.internal);
  return { roundId: round.roundId, updates };
}

test('FailRound ends an aggregating round with the FL server reason and per-update reasons', async () => {
  const { roundId, updates } = await aggregatingRound(2);
  await assert.rejects(srv.api.fl.failRound({ roundId, reason: '' }, srv.internal), isCode(Code.InvalidArgument));
  await assert.rejects(srv.api.fl.failRound({ roundId, reason: 'x', rejectionReasons: { nope: 'y' } }, srv.internal), isCode(Code.InvalidArgument));
  const res = await srv.api.fl.failRound({ roundId, reason: 'every update failed validation', rejectionReasons: { [updates[0]]: 'update norm too large' } }, srv.internal);
  assert.equal(res.failed, true);
  const reasons = await updateReasons(roundId);
  assert.equal(reasons[updates[0]], 'update norm too large');
  assert.equal(reasons[updates[1]], null);
  const failed = await collect(srv.api.admin.listRounds({ status: 'failed' }, srv.superAdmin));
  assert.ok(failed.some((r) => r.roundId === roundId));
  await assert.rejects(srv.api.fl.failRound({ roundId, reason: 'again' }, srv.internal), isCode(Code.FailedPrecondition));
  await assert.rejects(srv.api.fl.failRound({ roundId, reason: 'x' }, srv.superAdmin), isCode(Code.Unauthenticated));
});

test('CompleteRound records why the FL server left updates out', async () => {
  const { roundId, updates } = await aggregatingRound(3);
  const version = await srv.nextModelVersion();
  const model = await srv.uploadModel(version);
  await assert.rejects(srv.api.fl.completeRound({
    roundId, newModelVersion: version, modelUrl: model.resourcePath, usedUpdateIds: updates.slice(0, 2), rejectionReasons: { [updates[0]]: 'both' },
  }, srv.internal), isCode(Code.InvalidArgument));
  await srv.api.fl.completeRound({
    roundId, newModelVersion: version, modelUrl: model.resourcePath, usedUpdateIds: updates.slice(0, 2),
    rejectionReasons: { [updates[2]]: 'server holdout loss 9.1 is above 1.50x the round median' },
  }, srv.internal);
  const reasons = await updateReasons(roundId);
  assert.equal(reasons[updates[2]], 'server holdout loss 9.1 is above 1.50x the round median');
  assert.equal(reasons[updates[0]], null);
});
