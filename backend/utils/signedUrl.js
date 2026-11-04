import crypto from 'crypto';
import { config } from '../config/index.js';

export function sign(resourcePath, ttlSeconds = config.signedUrl.defaultTtlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${resourcePath}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', config.signedUrl.secret).update(payload).digest('hex');

  const url = `/storage${resourcePath}?expires=${expiresAt}&sig=${signature}`;
  return { url, expiresAt: new Date(expiresAt) };
}

export function verify(resourcePath, expires, signature) {
  if (!expires || !signature) return false;
  if (Date.now() > Number(expires)) return false;

  const payload = `${resourcePath}:${expires}`;
  const expected = crypto.createHmac('sha256', config.signedUrl.secret).update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
