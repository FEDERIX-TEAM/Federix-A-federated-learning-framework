import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_TO_PROTO,
  ROLE_FROM_PROTO,
  ROUND_STATUS_TO_PROTO,
  UPDATE_STATUS_TO_PROTO,
  COMPRESSION_LEVEL_TO_PROTO,
  dateToIso,
  labelDistributionToMessage,
  labelDistributionFromMessage,
  stringMapToPlain,
  stringMapFromPlain,
} from '../utils/protoMappers.js';
import { Role, RoundStatus, UpdateStatus, CompressionLevel } from '../src/gen/common_pb.js';

const distinctNonZero = (map) => {
  const values = Object.values(map);
  return values.every((v) => Number.isInteger(v) && v > 0) && new Set(values).size === values.length;
};

test('every enum mapping uses distinct non-zero proto values', () => {
  for (const map of [ROLE_TO_PROTO, ROUND_STATUS_TO_PROTO, COMPRESSION_LEVEL_TO_PROTO]) {
    assert.ok(distinctNonZero(map));
  }
  const { prepared, ...updateStatuses } = UPDATE_STATUS_TO_PROTO;
  assert.ok(distinctNonZero(updateStatuses));
});

test('a prepared update is reported to clients as pending', () => {
  assert.equal(UPDATE_STATUS_TO_PROTO.prepared, UPDATE_STATUS_TO_PROTO.pending);
});

test('roles map to proto and back', () => {
  for (const [name, value] of Object.entries(ROLE_TO_PROTO)) {
    assert.equal(ROLE_FROM_PROTO[value], name);
  }
  assert.equal(ROLE_FROM_PROTO[0], undefined);
});

test('enum mappings agree with the generated proto enums', () => {
  assert.equal(ROLE_TO_PROTO.super_admin, Role.SUPER_ADMIN);
  assert.equal(ROLE_TO_PROTO.sdk_client, Role.SDK_CLIENT);
  assert.equal(ROUND_STATUS_TO_PROTO.active, RoundStatus.ACTIVE);
  assert.equal(ROUND_STATUS_TO_PROTO.aborted, RoundStatus.ABORTED);
  assert.equal(UPDATE_STATUS_TO_PROTO.compressed, UpdateStatus.COMPRESSED);
  assert.equal(COMPRESSION_LEVEL_TO_PROTO.full, CompressionLevel.FULL);
});

test('dateToIso returns an empty string for missing dates', () => {
  assert.equal(dateToIso(null), '');
  assert.equal(dateToIso(undefined), '');
});

test('dateToIso formats dates and timestamps', () => {
  assert.equal(dateToIso(new Date(0)), '1970-01-01T00:00:00.000Z');
  assert.equal(dateToIso('2026-11-05T10:00:00Z'), '2026-11-05T10:00:00.000Z');
});

test('label distributions convert to and from messages', () => {
  const counts = { 0: 5, 7: 2 };
  assert.deepEqual(labelDistributionFromMessage(labelDistributionToMessage(counts)), counts);
  assert.deepEqual(labelDistributionFromMessage(undefined), {});
  assert.deepEqual(labelDistributionToMessage(), { counts: {} });
});

test('string maps convert to and from messages', () => {
  const info = { os: 'linux', cpu: 'x86_64' };
  assert.deepEqual(stringMapToPlain(stringMapFromPlain(info)), info);
  assert.deepEqual(stringMapToPlain(undefined), {});
});
