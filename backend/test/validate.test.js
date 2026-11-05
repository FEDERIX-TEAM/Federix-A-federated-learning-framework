import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  isFiniteNumber,
  requireFinite,
  isValidLabelKey,
  isValidLabelDistribution,
  requireLabelDistribution,
  MAX_LABEL_CLASSES,
  MAX_LABEL_KEY_LENGTH,
} from '../src/lib/validate.js';

const invalidArgument = (pattern) => (err) =>
  err instanceof ConnectError && err.code === Code.InvalidArgument && pattern.test(err.message);

test('isFiniteNumber accepts only finite numbers', () => {
  for (const v of [0, -1, 2.5, Number.MAX_VALUE]) assert.equal(isFiniteNumber(v), true);
  for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, {}]) assert.equal(isFiniteNumber(v), false);
});

test('requireFinite returns valid values unchanged', () => {
  assert.equal(requireFinite(0, 'x', { min: 0 }), 0);
  assert.equal(requireFinite(0.5, 'x', { min: 0, max: 1 }), 0.5);
  assert.equal(requireFinite(-3, 'x'), -3);
});

test('requireFinite rejects NaN and Infinity with the field name', () => {
  assert.throws(() => requireFinite(NaN, 'local_loss_after'), invalidArgument(/local_loss_after must be a finite number/));
  assert.throws(() => requireFinite(Infinity, 'mu'), invalidArgument(/mu must be a finite number/));
  assert.throws(() => requireFinite(-Infinity, 'mu'), invalidArgument(/finite/));
  assert.throws(() => requireFinite(undefined, 'mu'), invalidArgument(/finite/));
});

test('requireFinite enforces min and max', () => {
  assert.throws(() => requireFinite(-0.1, 'loss', { min: 0 }), invalidArgument(/loss must be >= 0/));
  assert.throws(() => requireFinite(2, 'p', { max: 1 }), invalidArgument(/p must be <= 1/));
  assert.throws(() => requireFinite(1.5, 'p', { min: 0, max: 1 }), invalidArgument(/within \[0, 1\]/));
});

test('isValidLabelKey rejects empty, long, dotted, dollar and prototype keys', () => {
  for (const k of ['0', 'cat', 'class_9', 'x'.repeat(MAX_LABEL_KEY_LENGTH)]) assert.equal(isValidLabelKey(k), true);
  for (const k of ['', 'a.b', '$gt', 'a$b', 'x'.repeat(MAX_LABEL_KEY_LENGTH + 1), '__proto__', 'constructor', 'prototype']) {
    assert.equal(isValidLabelKey(k), false, k);
  }
});

test('isValidLabelDistribution accepts empty and well-formed maps', () => {
  assert.equal(isValidLabelDistribution(undefined), true);
  assert.equal(isValidLabelDistribution({}), true);
  assert.equal(isValidLabelDistribution({ 0: 10, 1: 0 }), true);
});

test('isValidLabelDistribution rejects bad counts, keys and shapes', () => {
  assert.equal(isValidLabelDistribution({ 0: NaN }), false);
  assert.equal(isValidLabelDistribution({ 0: Infinity }), false);
  assert.equal(isValidLabelDistribution({ 0: -1 }), false);
  assert.equal(isValidLabelDistribution({ 0: '5' }), false);
  assert.equal(isValidLabelDistribution({ 'a.b': 1 }), false);
  assert.equal(isValidLabelDistribution([1, 2]), false);
  assert.equal(isValidLabelDistribution('x'), false);
});

test('isValidLabelDistribution caps the number of labels', () => {
  const many = Object.fromEntries([...Array(MAX_LABEL_CLASSES + 1).keys()].map((i) => [`c${i}`, 1]));
  assert.equal(isValidLabelDistribution(many), false);
});

test('requireLabelDistribution returns a plain copy of valid input', () => {
  const input = { 0: 5, 1: 7 };
  const out = requireLabelDistribution(input);
  assert.deepEqual(out, input);
  assert.notEqual(out, input);
  assert.deepEqual(requireLabelDistribution(undefined), {});
});

test('requireLabelDistribution explains what is wrong', () => {
  assert.throws(() => requireLabelDistribution({ 0: NaN }), invalidArgument(/count for label '0'/));
  assert.throws(() => requireLabelDistribution({ 0: -2 }), invalidArgument(/>= 0/));
  assert.throws(() => requireLabelDistribution({ '$where': 1 }), invalidArgument(/label '\$where' is invalid/));
  assert.throws(() => requireLabelDistribution([1]), invalidArgument(/must be a map/));
  const many = Object.fromEntries([...Array(MAX_LABEL_CLASSES + 1).keys()].map((i) => [`c${i}`, 1]));
  assert.throws(() => requireLabelDistribution(many), invalidArgument(/more than/));
});
