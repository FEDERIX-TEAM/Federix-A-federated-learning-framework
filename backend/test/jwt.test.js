import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/index.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiresInSeconds,
} from '../utils/jwt.js';

function withAccessExpiry(value, fn) {
  const original = config.jwt.accessExpiresIn;
  config.jwt.accessExpiresIn = value;
  try {
    return fn();
  } finally {
    config.jwt.accessExpiresIn = original;
  }
}

test('expiresInSeconds converts s, m, h and d units', () => {
  assert.equal(withAccessExpiry('30s', expiresInSeconds), 30);
  assert.equal(withAccessExpiry('15m', expiresInSeconds), 900);
  assert.equal(withAccessExpiry('1h', expiresInSeconds), 3600);
  assert.equal(withAccessExpiry('7d', expiresInSeconds), 604800);
});

test('expiresInSeconds falls back to 900 for unparseable values', () => {
  assert.equal(withAccessExpiry('abc', expiresInSeconds), 900);
  assert.equal(withAccessExpiry('15', expiresInSeconds), 900);
  assert.equal(withAccessExpiry('1w', expiresInSeconds), 900);
});

test('access tokens round-trip their payload', () => {
  const token = signAccessToken({ sub: 'u1', role: 'admin', jti: 'j1' });
  const decoded = verifyAccessToken(token);
  assert.equal(decoded.sub, 'u1');
  assert.equal(decoded.role, 'admin');
  assert.equal(decoded.jti, 'j1');
  assert.ok(decoded.exp > decoded.iat);
});

test('refresh tokens round-trip their payload', () => {
  const token = signRefreshToken({ sub: 'c1', role: 'sdk_client', client_id: 'c1', jti: 'j2' });
  const decoded = verifyRefreshToken(token);
  assert.equal(decoded.client_id, 'c1');
  assert.equal(decoded.role, 'sdk_client');
});

test('access and refresh tokens are not interchangeable', (t) => {
  if (config.jwt.accessSecret === config.jwt.refreshSecret) {
    t.skip('access and refresh secrets are configured identically');
    return;
  }
  const access = signAccessToken({ sub: 'u1', role: 'admin', jti: 'a' });
  const refresh = signRefreshToken({ sub: 'u1', role: 'admin', jti: 'r' });
  assert.throws(() => verifyRefreshToken(access));
  assert.throws(() => verifyAccessToken(refresh));
});

test('a tampered token is rejected', () => {
  const token = signAccessToken({ sub: 'u1', role: 'viewer', jti: 'j' });
  const [h, p, s] = token.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url').toString());
  forged.role = 'super_admin';
  const tampered = [h, Buffer.from(JSON.stringify(forged)).toString('base64url'), s].join('.');
  assert.throws(() => verifyAccessToken(tampered));
});
