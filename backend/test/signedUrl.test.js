import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/index.js';
import { sign, verify } from '../utils/signedUrl.js';

const parse = (url) => {
  const u = new URL(url);
  return { path: u.pathname, query: Object.fromEntries(u.searchParams) };
};

test('sign returns an absolute /storage URL under PUBLIC_BASE_URL', () => {
  const s = sign('/models/3', 60);
  assert.ok(s.url.startsWith(`${config.storage.publicBaseUrl}/storage/models/3?`));
  assert.equal(s.url, `${config.storage.publicBaseUrl}${s.path}`);
  const { query } = parse(s.url);
  assert.equal(Number(query.expires), s.expiresAt.getTime());
  assert.match(query.sig, /^[0-9a-f]{64}$/);
  assert.equal(s.method, 'GET');
});

test('a GET signature verifies for GET only', () => {
  const { query } = parse(sign('/updates/abc', 60).url);
  const grant = verify('/updates/abc', query, 'GET');
  assert.equal(grant.maxBytes, undefined);
  assert.equal(grant.overwrite, false);
  assert.equal(grant.issuedAt, Number(query.iat));
  assert.equal(verify('/updates/abc', { ...query, max: '10', ow: '1' }, 'PUT'), null);
});

test('a PUT signature carries its size limit and overwrite flag', () => {
  const s = sign('/updates/abc', { method: 'PUT', maxBytes: 1234, overwrite: true });
  const { query } = parse(s.url);
  assert.equal(query.max, '1234');
  assert.equal(query.ow, '1');
  const grant = verify('/updates/abc', query, 'PUT');
  assert.equal(grant.maxBytes, 1234);
  assert.equal(grant.overwrite, true);
  assert.equal(verify('/updates/abc', query, 'GET'), null);
});

test('PUT URLs default to UPLOAD_URL_TTL_SECONDS and GET URLs to SIGNED_URL_TTL_SECONDS', () => {
  const put = sign('/models/1', { method: 'PUT', maxBytes: 1 });
  const get = sign('/models/1');
  const near = (actual, seconds) => Math.abs(actual.getTime() - Date.now() - seconds * 1000) < 2000;
  assert.ok(near(put.expiresAt, config.signedUrl.uploadTtlSeconds));
  assert.ok(near(get.expiresAt, config.signedUrl.defaultTtlSeconds));
});

test('changing the size limit or overwrite flag breaks a PUT signature', () => {
  const { query } = parse(sign('/updates/abc', { method: 'PUT', maxBytes: 100, overwrite: false }).url);
  assert.equal(verify('/updates/abc', { ...query, max: '1000000' }, 'PUT'), null);
  assert.equal(verify('/updates/abc', { ...query, ow: '1' }, 'PUT'), null);
  assert.equal(verify('/updates/abc', { ...query, max: 'abc' }, 'PUT'), null);
});

test('verify rejects a different resource path', () => {
  const { query } = parse(sign('/updates/abc', 60).url);
  assert.equal(verify('/updates/abd', query, 'GET'), null);
});

test('verify rejects a changed expiry', () => {
  const { query } = parse(sign('/models/1', 60).url);
  assert.equal(verify('/models/1', { ...query, expires: String(Number(query.expires) + 1000) }, 'GET'), null);
});

test('verify rejects a tampered signature', () => {
  const { query } = parse(sign('/models/1', 60).url);
  const flipped = (query.sig[0] === 'a' ? 'b' : 'a') + query.sig.slice(1);
  assert.equal(verify('/models/1', { ...query, sig: flipped }, 'GET'), null);
});

test('verify rejects an expired URL', () => {
  const { query } = parse(sign('/models/1', -1).url);
  assert.equal(verify('/models/1', query, 'GET'), null);
});

test('verify rejects missing or malformed parameters', () => {
  const { query } = parse(sign('/models/1', 60).url);
  assert.equal(verify('/models/1', { sig: query.sig }, 'GET'), null);
  assert.equal(verify('/models/1', { expires: query.expires }, 'GET'), null);
  assert.equal(verify('/models/1', { ...query, sig: 'short' }, 'GET'), null);
  assert.equal(verify('/models/1', { ...query, expires: '12abc' }, 'GET'), null);
  assert.equal(verify('/models/1', undefined, 'GET'), null);
});

test('refresh issues a new URL with the same rights and the same issue time', async () => {
  const { refresh } = await import('../utils/signedUrl.js');
  const original = sign('/updates/abc', { method: 'PUT', maxBytes: 777, overwrite: true, ttlSeconds: -1 });
  const { query } = parse(original.url);
  assert.equal(verify('/updates/abc', query, 'PUT'), null);

  const { signed, error } = refresh('/updates/abc', query);
  assert.equal(error, undefined);
  const fresh = parse(signed.url).query;
  assert.equal(fresh.iat, query.iat);
  assert.equal(fresh.max, '777');
  assert.equal(fresh.ow, '1');
  assert.ok(verify('/updates/abc', fresh, 'PUT'));
});

test('refresh refuses tampered URLs and URLs past their maximum lifetime', async () => {
  const { refresh } = await import('../utils/signedUrl.js');
  const { query } = parse(sign('/models/1').url);
  assert.equal(refresh('/models/2', query).error, 'invalid');
  assert.equal(refresh('/models/1', { ...query, sig: 'x'.repeat(64) }).error, 'invalid');

  const old = parse(sign('/models/1', { issuedAt: Date.now() - (config.signedUrl.maxLifetimeSeconds + 5) * 1000 }).url).query;
  assert.equal(refresh('/models/1', old).error, 'too_old');
});

test('no URL is valid past its maximum lifetime, whatever the TTL', () => {
  const issuedAt = Date.now() - (config.signedUrl.maxLifetimeSeconds - 2) * 1000;
  const s = sign('/models/1', { issuedAt, ttlSeconds: 3600 });
  assert.ok(s.expiresAt.getTime() <= issuedAt + config.signedUrl.maxLifetimeSeconds * 1000);
});
