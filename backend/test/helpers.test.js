import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { clampN, num, parseDate, joinedCount, giniCoefficient } from '../src/lib/helpers.js';

test('clampN falls back to the default for missing, zero, negative or non-numeric input', () => {
  assert.equal(clampN(undefined), 20);
  assert.equal(clampN(0), 20);
  assert.equal(clampN(-5), 20);
  assert.equal(clampN('abc'), 20);
  assert.equal(clampN(NaN, 7), 7);
});

test('clampN floors and caps at the maximum', () => {
  assert.equal(clampN(5.9), 5);
  assert.equal(clampN('7'), 7);
  assert.equal(clampN(1000), 200);
  assert.equal(clampN(1000, 10, 50), 50);
});

test('num keeps finite numbers and maps everything else to 0', () => {
  assert.equal(num(2.5), 2.5);
  assert.equal(num(-1), -1);
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num('3'), 0);
  assert.equal(num(null), 0);
});

test('parseDate returns null for empty input and a Date for valid input', () => {
  assert.equal(parseDate('', 'x'), null);
  assert.equal(parseDate(undefined, 'x'), null);
  assert.equal(parseDate('2026-11-05T10:00:00.000Z', 'x').toISOString(), '2026-11-05T10:00:00.000Z');
});

test('parseDate throws InvalidArgument for an invalid date', () => {
  assert.throws(
    () => parseDate('not-a-date', 'from_date'),
    (err) => err instanceof ConnectError && err.code === Code.InvalidArgument && /from_date/.test(err.message)
  );
});

test('joinedCount counts only joined participants', () => {
  const round = { participants: [{ status: 'joined' }, { status: 'left' }, { status: 'joined' }, { status: 'dropped' }] };
  assert.equal(joinedCount(round), 2);
  assert.equal(joinedCount({ participants: [] }), 0);
});

test('giniCoefficient is 0 for empty, all-zero or equal values', () => {
  assert.equal(giniCoefficient([]), 0);
  assert.equal(giniCoefficient([0, 0, 0]), 0);
  assert.equal(giniCoefficient([5, 5, 5, 5]), 0);
});

test('giniCoefficient measures concentration', () => {
  assert.equal(giniCoefficient([0, 0, 10]), 0.6667);
  assert.equal(giniCoefficient([1, 2, 3, 4]), 0.25);
  assert.equal(giniCoefficient([4, 3, 2, 1]), 0.25);
});
