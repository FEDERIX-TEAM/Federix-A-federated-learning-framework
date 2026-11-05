import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUtilityScore, labelEntropy } from '../utils/utilityScore.js';

const uniform = (classes, n = 100) => Object.fromEntries([...Array(classes).keys()].map((c) => [String(c), n]));

test('labelEntropy is 0 for empty or single-class distributions', () => {
  assert.equal(labelEntropy({}), 0);
  assert.equal(labelEntropy(), 0);
  assert.equal(labelEntropy({ 0: 50 }), 0);
});

test('labelEntropy is 1 for a uniform distribution', () => {
  assert.equal(labelEntropy({ 0: 10, 1: 10 }), 1);
  assert.ok(Math.abs(labelEntropy(uniform(10)) - 1) < 1e-12);
});

test('labelEntropy of a skewed distribution is between 0 and 1', () => {
  const h = labelEntropy({ 0: 3, 1: 1 });
  assert.ok(Math.abs(h - 0.8112781244591328) < 1e-12);
});

test('labelEntropy ignores zero, negative and non-numeric counts', () => {
  assert.equal(labelEntropy({ 0: 10, 1: 0, 2: -4, 3: 'x' }), 0);
  assert.equal(labelEntropy({ 0: 10, 1: 10, 2: 0 }), 1);
});

test('computeUtilityScore is 0 with no improvement, no data and no labels', () => {
  assert.equal(computeUtilityScore({ localLossBefore: 1, localLossAfter: 1, dataSize: 0, labelDistribution: {} }), 0);
});

test('computeUtilityScore clips a worse loss to zero improvement', () => {
  const worse = computeUtilityScore({ localLossBefore: 1, localLossAfter: 2, dataSize: 0, labelDistribution: {} });
  assert.equal(worse, 0);
});

test('computeUtilityScore treats a zero starting loss as no improvement', () => {
  assert.equal(computeUtilityScore({ localLossBefore: 0, localLossAfter: 0, dataSize: 0, labelDistribution: {} }), 0);
});

test('computeUtilityScore weights loss 0.5, size 0.3 and entropy 0.2', () => {
  assert.equal(computeUtilityScore({ localLossBefore: 2, localLossAfter: 1, dataSize: 0, labelDistribution: {} }), 0.25);
  assert.equal(computeUtilityScore({ localLossBefore: 1, localLossAfter: 1, dataSize: 500, labelDistribution: {} }), 0.1896);
  assert.equal(computeUtilityScore({ localLossBefore: 1, localLossAfter: 1, dataSize: 0, labelDistribution: uniform(4) }), 0.2);
});

test('computeUtilityScore approaches 1 for a perfect update', () => {
  const score = computeUtilityScore({ localLossBefore: 1, localLossAfter: 0, dataSize: 1e6, labelDistribution: uniform(10) });
  assert.equal(score, 1);
});

test('labelEntropy ignores infinite counts', () => {
  assert.equal(labelEntropy({ 0: Infinity, 1: 10 }), 0);
  assert.equal(labelEntropy({ 0: Infinity, 1: 10, 2: 10 }), 1);
});

test('computeUtilityScore returns null instead of NaN for non-finite losses', () => {
  const base = { localLossBefore: 2, localLossAfter: 1, dataSize: 100, labelDistribution: { 0: 5 } };
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(computeUtilityScore({ ...base, localLossAfter: bad }), null);
    assert.equal(computeUtilityScore({ ...base, localLossBefore: bad }), null);
  }
});

test('computeUtilityScore returns null for negative losses, bad sizes or bad label counts', () => {
  const base = { localLossBefore: 2, localLossAfter: 1, dataSize: 100, labelDistribution: { 0: 5 } };
  assert.equal(computeUtilityScore({ ...base, localLossAfter: -1 }), null);
  assert.equal(computeUtilityScore({ ...base, dataSize: -5 }), null);
  assert.equal(computeUtilityScore({ ...base, dataSize: NaN }), null);
  assert.equal(computeUtilityScore({ ...base, labelDistribution: { 0: Infinity, 1: 3 } }), null);
  assert.equal(computeUtilityScore({ ...base, labelDistribution: { 0: NaN } }), null);
  assert.equal(computeUtilityScore({ ...base, labelDistribution: { 'a.b': 1 } }), null);
});

test('a null score can never pass a threshold check', () => {
  const score = computeUtilityScore({ localLossBefore: 2, localLossAfter: NaN, dataSize: 100, labelDistribution: {} });
  assert.equal(score, null);
  assert.notEqual(typeof score, 'number');
});

test('computeUtilityScore stays within [0, 1] and is rounded to 4 decimals', () => {
  for (const [before, after, n] of [[1, 0.3, 37], [5, 4.2, 1200], [0.7, 0.69, 3]]) {
    const s = computeUtilityScore({ localLossBefore: before, localLossAfter: after, dataSize: n, labelDistribution: { 0: 2, 1: 5 } });
    assert.ok(s >= 0 && s <= 1);
    assert.equal(s, Number(s.toFixed(4)));
  }
});
