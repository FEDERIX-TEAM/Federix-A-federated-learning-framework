import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { CompressionLevel, UpdateStatus } from '../src/gen/common_pb.js';
import { Round } from '../models/Round.js';
import { SystemConfig } from '../models/SystemConfig.js';
import { configForRound, configForCurrentRound } from '../src/lib/helpers.js';
import { startTestServer, collect } from './support/testServer.js';

const ORIGINAL = { utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5, mu: 0.02 };
const CHANGED = { utilityThresholdLow: 0.95, utilityThresholdHigh: 0.99, mu: 0.07 };

let srv;
let round;
let good;
let mediocre;
let poor;
const updates = {};

before(async () => {
  srv = await startTestServer();
});

after(async () => {
  await srv?.stop();
});

async function submit(c, before, after, dataSize, counts) {
  const { submitted } = await srv.submitUpdate(c, {
    roundId: round.roundId, localLossBefore: before, localLossAfter: after, labelDistribution: counts, dataSize, trainingTimeMs: 1000,
  });
  return submitted;
}

test('a round stores the config that was live when it started', async () => {
  const { api, superAdmin } = srv;
  await api.admin.updateConfig({ minClientsPerRound: 1, ...ORIGINAL, utility: { rejectBelow: 0.05 } }, superAdmin);
  [good, mediocre, poor] = await Promise.all(['good', 'mediocre', 'poor'].map((n) => srv.newSdkClient(n)));

  round = await api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, superAdmin);
  for (const c of [good, mediocre, poor]) {
    assert.equal((await api.client.joinRound({ roundId: round.roundId, localDataSize: 100000 }, c)).accepted, true);
  }

  const stored = await Round.findOne({ round_id: round.roundId }).lean();
  assert.equal(stored.config_snapshot.utility_threshold_low, ORIGINAL.utilityThresholdLow);
  assert.equal(stored.config_snapshot.utility_threshold_high, ORIGINAL.utilityThresholdHigh);
  assert.equal(stored.config_snapshot.mu, ORIGINAL.mu);
});

test('a config change mid-round is saved but applies from the next round', async () => {
  const res = await srv.api.admin.updateConfig(CHANGED, srv.superAdmin);
  assert.equal(res.effectiveFromRound, round.roundNumber + 1);

  const live = await SystemConfig.findOne({ singleton_key: 'active_config' }).lean();
  assert.equal(live.utility_threshold_low, CHANGED.utilityThresholdLow);
  assert.equal(live.mu, CHANGED.mu);
});

test('updates in the running round are scored with the round snapshot, not the live config', async () => {
  updates.good = await submit(good, 1.0, 0.2, 5000, { a: 100, b: 100, c: 100 });
  updates.mediocre = await submit(mediocre, 1.0, 0.9, 200, { a: 100 });
  updates.poor = await submit(poor, 1.0, 1.0, 1, { a: 1 });

  assert.equal(updates.good.accepted, true);
  assert.equal(updates.good.compressionRequired, false);
  assert.equal(updates.mediocre.accepted, true);
  assert.equal(updates.mediocre.compressionRequired, true);
  assert.equal(updates.poor.accepted, false);

  const goodStatus = await srv.api.client.getUpdateStatus({ roundId: round.roundId }, good);
  assert.equal(goodStatus.status, UpdateStatus.ACCEPTED);
  const poorStatus = await srv.api.client.getUpdateStatus({ roundId: round.roundId }, poor);
  assert.match(poorStatus.reason, /below the rejection threshold 0\.05$/);
});

test('clients and the FL server read the running round config', async () => {
  const clientCfg = await srv.api.client.getConfig({}, good);
  assert.equal(clientCfg.mu, ORIGINAL.mu);
  assert.equal(clientCfg.compressionThreshold, ORIGINAL.utilityThresholdHigh);

  const flCfg = await srv.api.fl.getFlConfig({}, srv.internal);
  assert.equal(flCfg.mu, ORIGINAL.mu);
  assert.equal(flCfg.utilityThresholdLow, ORIGINAL.utilityThresholdLow);
  assert.equal(flCfg.utilityThresholdHigh, ORIGINAL.utilityThresholdHigh);
  assert.equal(flCfg.minClients, 1);
});

test('ComputeUtility scores with the round snapshot', async () => {
  const ids = [updates.good.updateId, updates.mediocre.updateId, updates.poor.updateId];
  const results = await collect(srv.api.fl.computeUtility({ roundId: round.roundId, updateIds: ids }, srv.internal));
  const byId = Object.fromEntries(results.map((r) => [r.updateId, r.compressionLevel]));
  assert.equal(byId[updates.good.updateId], CompressionLevel.NONE);
  assert.equal(byId[updates.mediocre.updateId], CompressionLevel.PARTIAL);
  assert.equal(byId[updates.poor.updateId], CompressionLevel.FULL);
});

test('ComputeUtility for an unknown round is NotFound', async () => {
  await assert.rejects(
    collect(srv.api.fl.computeUtility({ roundId: 'no-such-round', updateIds: [] }, srv.internal)),
    (err) => err instanceof ConnectError && err.code === Code.NotFound
  );
});

test('configForRound reads the snapshot stored in MongoDB', async () => {
  const doc = await Round.findOne({ round_id: round.roundId });
  const cfg = await configForRound(doc);
  assert.equal(cfg.utility_threshold_low, ORIGINAL.utilityThresholdLow);
  assert.equal(cfg.mu, ORIGINAL.mu);
  for (const key of ['_id', '__v', 'singleton_key', 'updated_by']) assert.equal(key in cfg, false, key);

  const current = await configForCurrentRound();
  assert.equal(current.mu, ORIGINAL.mu);
});

test('configForRound fills keys missing from an older snapshot with live values', async () => {
  await Round.updateOne({ round_id: round.roundId }, { $set: { config_snapshot: { mu: 0.3 } } });
  const cfg = await configForRound(await Round.findOne({ round_id: round.roundId }));
  assert.equal(cfg.mu, 0.3);
  assert.equal(cfg.utility_threshold_low, CHANGED.utilityThresholdLow);
  assert.equal(cfg.utility_threshold_high, CHANGED.utilityThresholdHigh);
});

test('with no running round, clients and the FL server get the live config', async () => {
  await srv.api.admin.stopRound({ roundId: round.roundId, reason: 'test' }, srv.superAdmin);

  const current = await configForCurrentRound();
  assert.equal(current.mu, CHANGED.mu);

  const clientCfg = await srv.api.client.getConfig({}, good);
  assert.equal(clientCfg.mu, CHANGED.mu);
  assert.equal(clientCfg.compressionThreshold, CHANGED.utilityThresholdHigh);
});

test('the next round starts with the changed config', async () => {
  const next = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, srv.superAdmin);
  assert.equal(next.roundNumber, round.roundNumber + 1);

  const stored = await Round.findOne({ round_id: next.roundId }).lean();
  assert.equal(stored.config_snapshot.utility_threshold_low, CHANGED.utilityThresholdLow);

  const flCfg = await srv.api.fl.getFlConfig({}, srv.internal);
  assert.equal(flCfg.utilityThresholdLow, CHANGED.utilityThresholdLow);
  assert.equal(flCfg.mu, CHANGED.mu);

  await srv.api.admin.stopRound({ roundId: next.roundId, reason: 'test' }, srv.superAdmin);
});
