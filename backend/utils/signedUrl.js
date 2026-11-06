import crypto from 'crypto';
import { config } from '../config/index.js';

export const STORAGE_PREFIX = '/storage';

const DIGITS = /^\d+$/;

function payloadOf({ method, resourcePath, issuedAt, expires, maxBytes, overwrite }) {
  return [method, resourcePath, issuedAt, expires, maxBytes ?? '', overwrite ? '1' : '0'].join('\n');
}

function hmac(payload) {
  return crypto.createHmac('sha256', config.signedUrl.secret).update(payload).digest('hex');
}

const lifetimeEnd = (issuedAt) => issuedAt + config.signedUrl.maxLifetimeSeconds * 1000;

export function sign(resourcePath, options = {}) {
  const opts = typeof options === 'number' ? { ttlSeconds: options } : options;
  const method = opts.method ?? 'GET';
  const ttlSeconds = opts.ttlSeconds ?? (method === 'PUT' ? config.signedUrl.uploadTtlSeconds : config.signedUrl.defaultTtlSeconds);
  const issuedAt = opts.issuedAt ?? Date.now();
  const expires = Math.min(Date.now() + ttlSeconds * 1000, lifetimeEnd(issuedAt));
  const maxBytes = method === 'PUT' ? opts.maxBytes : undefined;
  const overwrite = method === 'PUT' ? Boolean(opts.overwrite) : false;

  const params = new URLSearchParams({ iat: String(issuedAt), expires: String(expires) });
  if (maxBytes !== undefined) params.set('max', String(maxBytes));
  if (method === 'PUT') params.set('ow', overwrite ? '1' : '0');
  params.set('sig', hmac(payloadOf({ method, resourcePath, issuedAt, expires, maxBytes, overwrite })));

  const relative = `${STORAGE_PREFIX}${resourcePath}?${params}`;
  return {
    url: `${config.storage.publicBaseUrl}${relative}`,
    path: relative,
    method,
    issuedAt: new Date(issuedAt),
    expiresAt: new Date(expires),
    refreshUntil: new Date(lifetimeEnd(issuedAt)),
    maxBytes,
  };
}

export function verify(resourcePath, query = {}, method = 'GET', { allowExpired = false } = {}) {
  const { iat, expires, sig } = query ?? {};
  if (!iat || !expires || !sig) return null;
  if (!DIGITS.test(String(iat)) || !DIGITS.test(String(expires))) return null;
  if (!allowExpired && Date.now() > Number(expires)) return null;

  let maxBytes;
  let overwrite = false;
  if (method === 'PUT') {
    if (!DIGITS.test(String(query.max ?? ''))) return null;
    if (!['0', '1'].includes(String(query.ow))) return null;
    maxBytes = Number(query.max);
    overwrite = query.ow === '1';
  } else if (query.max !== undefined || query.ow !== undefined) {
    return null;
  }

  const issuedAt = Number(iat);
  const expected = hmac(payloadOf({ method, resourcePath, issuedAt, expires: Number(expires), maxBytes, overwrite }));
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { maxBytes, overwrite, issuedAt, expires: Number(expires) };
}

export function methodOf(query = {}) {
  return query.max !== undefined || query.ow !== undefined ? 'PUT' : 'GET';
}

export function refresh(resourcePath, query = {}) {
  const method = methodOf(query);
  const grant = verify(resourcePath, query, method, { allowExpired: true });
  if (!grant) return { error: 'invalid' };
  if (Date.now() >= lifetimeEnd(grant.issuedAt)) return { error: 'too_old' };
  return { signed: sign(resourcePath, { method, maxBytes: grant.maxBytes, overwrite: grant.overwrite, issuedAt: grant.issuedAt }) };
}
