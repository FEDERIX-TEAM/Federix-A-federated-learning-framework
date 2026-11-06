import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Code, ConnectError } from '@connectrpc/connect';
import { CompressionLevel, UpdateStatus } from '../src/gen/common_pb.js';
import { SystemConfig, ConfigHistory } from '../models/SystemConfig.js';
import { Round } from '../models/Round.js';
import { Update } from '../models/Update.js';
import { startTestServer, collect } from './support/testServer.js';

const vectors = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../spec/utility_vectors.json', import.meta.url)), 'utf8'));
const DEFAULTS = vectors.default_config;

let srv;

before(async () => {
  srv = await startTestServer();
});

after(async () => {
  await srv?.stop();
});

const isInvalid = (pattern) => (err) => err instanceof ConnectError && err.code === Code.InvalidArgument && pattern.test(err.message);
const UTILITY_KEYS = {
  weight_quality: 'weightQuality',
  weight_size: 'weightSize',
  weight_diversity: 'weightDiversity',
  size_saturation: 'sizeSaturation',
  num_classes: 'numClasses',
  temperature: 'temperature',
  ratio_high: 'ratioHigh',
  ratio_medium: 'ratioMedium',
  ratio_low: 'ratioLow',
  reject_below: 'rejectBelow',
};

function configRequest(snake) {
  const req = { utility: {} };
  for (const [k, v] of Object.entries(snake)) {
    if (k === 'utility_threshold_high') req.utilityThresholdHigh = v;
    else if (k === 'utility_threshold_low') req.utilityThresholdLow = v;
    else req.utility[UTILITY_KEYS[k]] = v;
  }
  return req;
}

async function setConfig(snake) {
  return srv.api.admin.updateConfig({ minClientsPerRound: 1, ...configRequest(snake) }, srv.superAdmin);
}

async function runOneUpdate(input) {
  const c = await srv.newSdkClient('utility');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId }, c);
    const res = await srv.api.client.submitUpdate({
      roundId: round.roundId,
      deltaWeightsUrl: 's3://u.bin',
      localLossBefore: input.localLossBefore,
      localLossAfter: input.localLossAfter,
      labelDistribution: { counts: input.labelDistribution },
      dataSize: input.dataSize,
      trainingTimeMs: 10,
    }, c);
    const stored = await Update.findOne({ update_id: res.updateId }).lean();
    return { res, stored, round, client: c };
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
}

test('a fresh install exposes the paper defaults', async () => {
  const cfg = await srv.api.admin.getConfig({}, srv.superAdmin);
  assert.deepEqual(cfg.utility, {
    $typeName: 'federix.v1.UtilityConfig',
    weightQuality: 1,
    weightSize: 0.5,
    weightDiversity: 0.3,
    sizeSaturation: 500,
    numClasses: 10,
    temperature: 1,
    thresholdHigh: 0.8,
    thresholdLow: 0.2,
    ratioHigh: 1,
    ratioMedium: 0.5,
    ratioLow: 0.1,
    rejectBelow: 0,
  });
});

const VALID_CASES = vectors.cases.filter((c) => c.expected !== null && Number.isInteger(c.input.data_size) && c.input.data_size >= 1);

for (const c of VALID_CASES) {
  test(`server matches shared vector: ${c.name}`, async () => {
    await setConfig({ ...DEFAULTS, ...c.config });
    const { res, stored } = await runOneUpdate({
      localLossBefore: c.input.local_loss_before,
      localLossAfter: c.input.local_loss_after,
      dataSize: c.input.data_size,
      labelDistribution: c.input.label_distribution,
    });
    assert.ok(Math.abs(stored.utility_score - c.expected.score) < 1e-12, `score ${stored.utility_score} vs ${c.expected.score}`);
    assert.equal(stored.status, c.tier.status);
    assert.equal(stored.compression_level, c.tier.level);
    assert.equal(res.accepted, c.tier.status !== 'rejected');
    assert.equal(res.compressionRequired, c.tier.level === 'partial' || c.tier.level === 'full');
  });
}

test('by default a poor update is compressed hard, not rejected, and reaches the FL server', async () => {
  await setConfig(DEFAULTS);
  const c = await srv.newSdkClient('poor');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId }, c);
    const res = await srv.api.client.submitUpdate({
      roundId: round.roundId, deltaWeightsUrl: 's3://u.bin', localLossBefore: 1, localLossAfter: 1,
      labelDistribution: { counts: { a: 1 } }, dataSize: 1, trainingTimeMs: 1,
    }, c);
    assert.equal(res.accepted, true);
    assert.equal(res.compressionRequired, true);
    const status = await srv.api.client.getUpdateStatus({ roundId: round.roundId }, c);
    assert.equal(status.status, UpdateStatus.COMPRESSED);
    const ups = await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal));
    assert.equal(ups.length, 1);
    const util = await collect(srv.api.fl.computeUtility({ roundId: round.roundId, updateIds: [res.updateId] }, srv.internal));
    assert.equal(util[0].compressionLevel, CompressionLevel.FULL);
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('reject_below turns rejection on, with a clear reason', async () => {
  await setConfig({ ...DEFAULTS, reject_below: 0.1 });
  const { res, stored } = await runOneUpdate({ localLossBefore: 1, localLossAfter: 1, dataSize: 1, labelDistribution: { a: 1 } });
  assert.equal(res.accepted, false);
  assert.equal(stored.status, 'rejected');
  assert.match(stored.reason, /below the rejection threshold 0\.1$/);
});

test('C2 end to end: two balanced classes no longer count as full diversity', async () => {
  await setConfig({ ...DEFAULTS, weight_quality: 0, weight_size: 0, weight_diversity: 1 });
  const two = await runOneUpdate({ localLossBefore: 1, localLossAfter: 0.5, dataSize: 100, labelDistribution: { 0: 50, 1: 50 } });
  const ten = await runOneUpdate({
    localLossBefore: 1, localLossAfter: 0.5, dataSize: 100,
    labelDistribution: Object.fromEntries([...Array(10).keys()].map((i) => [String(i), 10])),
  });
  assert.ok(Math.abs(two.stored.utility_score - 1 / Math.log2(10)) < 1e-12);
  assert.equal(ten.stored.utility_score, 1);
});

test('UpdateConfig stores utility settings and records them in the history', async () => {
  const res = await srv.api.admin.updateConfig({ utility: { weightQuality: 2, temperature: 0.5, numClasses: 100 } }, srv.superAdmin);
  assert.equal(res.updatedConfig.utility.weightQuality, 2);
  const stored = await SystemConfig.findOne({ singleton_key: 'active_config' }).lean();
  assert.equal(stored.weight_quality, 2);
  assert.equal(stored.temperature, 0.5);
  assert.equal(stored.num_classes, 100);
  const last = await ConfigHistory.findOne().sort({ changed_at: -1 }).lean();
  assert.deepEqual(last.diff, { weight_quality: 2, temperature: 0.5, num_classes: 100 });
});

test('compressionRatio is an alias for the medium-tier ratio', async () => {
  await setConfig(DEFAULTS);
  const res = await srv.api.admin.updateConfig({ compressionRatio: 0.3 }, srv.superAdmin);
  assert.equal(res.updatedConfig.compressionRatio, 0.3);
  assert.equal(res.updatedConfig.utility.ratioMedium, 0.3);
  const stored = await SystemConfig.findOne({ singleton_key: 'active_config' }).lean();
  assert.equal(stored.ratio_medium, 0.3);
  assert.equal(stored.compression_ratio, 0.3);
  await assert.rejects(
    srv.api.admin.updateConfig({ compressionRatio: 0.3, utility: { ratioMedium: 0.4 } }, srv.superAdmin),
    isInvalid(/same setting/)
  );
});

test('invalid utility settings are refused with a reason', async () => {
  await setConfig(DEFAULTS);
  const cases = [
    [{ weightQuality: -1 }, /weight_quality must be >= 0/],
    [{ weightQuality: 0, weightSize: 0, weightDiversity: 0 }, /at least one of/],
    [{ sizeSaturation: 0 }, /size_saturation must be > 0/],
    [{ numClasses: 1 }, /num_classes must be an integer >= 2/],
    [{ temperature: 0 }, /temperature must be > 0/],
    [{ ratioLow: 1.5 }, /ratio_low must be within \(0, 1\]/],
    [{ ratioHigh: 0.4 }, /ratio_high >= ratio_medium >= ratio_low/],
    [{ rejectBelow: 0.5 }, /reject_below must be within \[0, utility_threshold_low\]/],
    [{ temperature: NaN }, /temperature must be a finite number/],
  ];
  for (const [utility, pattern] of cases) {
    await assert.rejects(srv.api.admin.updateConfig({ utility }, srv.superAdmin), isInvalid(pattern), JSON.stringify(utility));
  }
  const stored = await SystemConfig.findOne({ singleton_key: 'active_config' }).lean();
  assert.equal(stored.weight_quality, DEFAULTS.weight_quality);
  assert.equal(stored.num_classes, DEFAULTS.num_classes);
});

test('a running round keeps its utility settings when they change mid-round', async () => {
  await setConfig({ ...DEFAULTS, weight_quality: 0, weight_size: 0, weight_diversity: 1 });
  const c = await srv.newSdkClient('snapshot');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    await srv.api.client.joinRound({ roundId: round.roundId }, c);
    await srv.api.admin.updateConfig({ utility: { weightQuality: 1, weightDiversity: 0 } }, srv.superAdmin);

    const res = await srv.api.client.submitUpdate({
      roundId: round.roundId, deltaWeightsUrl: 's3://u.bin', localLossBefore: 1, localLossAfter: 0,
      labelDistribution: { counts: { 0: 1 } }, dataSize: 10, trainingTimeMs: 1,
    }, c);
    assert.equal((await Update.findOne({ update_id: res.updateId }).lean()).utility_score, 0);

    const fl = await srv.api.fl.getFlConfig({}, srv.internal);
    assert.equal(fl.utility.weightDiversity, 1);
    assert.equal(fl.utility.weightQuality, 0);
    const clientCfg = await srv.api.client.getConfig({}, c);
    assert.equal(clientCfg.utility.weightDiversity, 1);
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});

test('rounds whose snapshot predates utility v2 fall back to the live utility settings', async () => {
  await setConfig({ ...DEFAULTS, weight_size: 0, weight_diversity: 0 });
  const c = await srv.newSdkClient('old-snapshot');
  const round = await srv.api.admin.startRound({ maxClients: 5, deadlineSeconds: 600 }, srv.superAdmin);
  try {
    const legacy = {};
    for (const k of Object.keys(UTILITY_KEYS)) legacy[`config_snapshot.${k}`] = 1;
    await Round.updateOne({ round_id: round.roundId }, { $unset: legacy });
    await srv.api.client.joinRound({ roundId: round.roundId }, c);
    const res = await srv.api.client.submitUpdate({
      roundId: round.roundId, deltaWeightsUrl: 's3://u.bin', localLossBefore: 2, localLossAfter: 1,
      labelDistribution: { counts: { 0: 1 } }, dataSize: 10, trainingTimeMs: 1,
    }, c);
    const score = (await Update.findOne({ update_id: res.updateId }).lean()).utility_score;
    assert.ok(Math.abs(score - (1 / (2 + 1e-8))) < 1e-12, String(score));
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  }
});
