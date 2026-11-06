import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeUtilityScore,
  utilityComponents,
  utilityTier,
  labelEntropy,
  utilityConfigToProto,
  EPSILON,
} from '../utils/utilityScore.js';

const vectorsPath = fileURLToPath(new URL('../../spec/utility_vectors.json', import.meta.url));
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
const TOLERANCE = 1e-12;

const toInput = (raw) => ({
  localLossBefore: raw.local_loss_before === 'NaN' ? NaN : raw.local_loss_before,
  localLossAfter: raw.local_loss_after === 'NaN' ? NaN : raw.local_loss_after,
  dataSize: raw.data_size,
  labelDistribution: raw.label_distribution,
});

test('the shared vectors use the same epsilon as the backend', () => {
  assert.equal(vectors.epsilon, EPSILON);
  assert.ok(vectors.cases.length >= 20);
});

for (const c of vectors.cases) {
  test(`shared vector: ${c.name}`, () => {
    const cfg = { ...vectors.default_config, ...c.config };
    const got = utilityComponents(toInput(c.input), cfg);
    if (c.expected === null) {
      assert.equal(got, null);
    } else {
      for (const key of ['quality', 'size', 'diversity', 'score']) {
        assert.ok(Math.abs(got[key] - c.expected[key]) < TOLERANCE, `${key}: got ${got[key]}, expected ${c.expected[key]}`);
      }
    }
    const tier = utilityTier(got?.score ?? null, cfg);
    assert.equal(tier.status, c.tier.status);
    assert.equal(tier.level, c.tier.level);
    assert.equal(tier.ratio, c.tier.ratio);
  });
}

test('diversity is normalised by num_classes, not by the classes a client happens to have', () => {
  assert.ok(Math.abs(labelEntropy({ 0: 50, 1: 50 }, 10) - 1 / Math.log2(10)) < TOLERANCE);
  assert.equal(labelEntropy(Object.fromEntries([...Array(10).keys()].map((i) => [i, 7])), 10), 1);
  assert.equal(labelEntropy({ 0: 50, 1: 50 }, 2), 1);
});

test('labelEntropy is 0 for empty or single-class distributions and ignores bad counts', () => {
  assert.equal(labelEntropy({}, 10), 0);
  assert.equal(labelEntropy({ 0: 50 }, 10), 0);
  assert.equal(labelEntropy({ 0: 10, 1: 0, 2: -4, 3: 'x', 4: Infinity }, 10), 0);
});

test('weights that sum to zero or a non-positive saturation make the score uncomputable', () => {
  const input = { localLossBefore: 1, localLossAfter: 0.5, dataSize: 100, labelDistribution: {} };
  const base = vectors.default_config;
  assert.equal(computeUtilityScore(input, { ...base, weight_quality: 0, weight_size: 0, weight_diversity: 0 }), null);
  assert.equal(computeUtilityScore(input, { ...base, size_saturation: 0 }), null);
  assert.equal(utilityTier(null, base).status, 'rejected');
});

test('reject_below of 0 never rejects a valid score', () => {
  const cfg = { ...vectors.default_config, reject_below: 0 };
  assert.equal(utilityTier(0, cfg).status, 'compressed');
  assert.equal(utilityTier(0, cfg).level, 'full');
});

test('utilityConfigToProto exposes every utility setting', () => {
  const proto = utilityConfigToProto(vectors.default_config);
  assert.deepEqual(proto, {
    weightQuality: 1.0,
    weightSize: 0.5,
    weightDiversity: 0.3,
    sizeSaturation: 500,
    numClasses: 10,
    temperature: 1.0,
    thresholdHigh: 0.8,
    thresholdLow: 0.2,
    ratioHigh: 1.0,
    ratioMedium: 0.5,
    ratioLow: 0.1,
    rejectBelow: 0,
  });
});
