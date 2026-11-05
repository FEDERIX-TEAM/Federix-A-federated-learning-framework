import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../utils/signedUrl.js';

const parse = (url) => {
  const u = new URL(url, 'http://local');
  return { path: u.pathname, expires: u.searchParams.get('expires'), sig: u.searchParams.get('sig') };
};

test('sign returns a /storage URL with expiry and signature', () => {
  const { url, expiresAt } = sign('/models/3', 60);
  const { path, expires, sig } = parse(url);
  assert.equal(path, '/storage/models/3');
  assert.equal(Number(expires), expiresAt.getTime());
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('verify accepts an untouched signature', () => {
  const { expires, sig } = parse(sign('/updates/abc', 60).url);
  assert.equal(verify('/updates/abc', expires, sig), true);
});

test('verify rejects a different resource path', () => {
  const { expires, sig } = parse(sign('/updates/abc', 60).url);
  assert.equal(verify('/updates/abd', expires, sig), false);
});

test('verify rejects a changed expiry', () => {
  const { expires, sig } = parse(sign('/models/1', 60).url);
  assert.equal(verify('/models/1', String(Number(expires) + 1000), sig), false);
});

test('verify rejects a tampered signature', () => {
  const { expires, sig } = parse(sign('/models/1', 60).url);
  const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  assert.equal(verify('/models/1', expires, flipped), false);
});

test('verify rejects an expired URL', () => {
  const { expires, sig } = parse(sign('/models/1', -1).url);
  assert.equal(verify('/models/1', expires, sig), false);
});

test('verify rejects missing or malformed parameters', () => {
  const { expires, sig } = parse(sign('/models/1', 60).url);
  assert.equal(verify('/models/1', undefined, sig), false);
  assert.equal(verify('/models/1', expires, undefined), false);
  assert.equal(verify('/models/1', expires, 'short'), false);
});
