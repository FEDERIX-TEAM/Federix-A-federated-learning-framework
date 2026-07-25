const crypto = require('crypto');
const config = require('../config');

/**
 * Generates a signed, time-limited URL for a given resource path.
 * This stands in for a real object-storage presigned URL (e.g. S3/GCS) —
 * swap `sign`/`verify` for your storage provider's SDK in production.
 */
function sign(resourcePath, ttlSeconds = config.signedUrl.defaultTtlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${resourcePath}:${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', config.signedUrl.secret)
    .update(payload)
    .digest('hex');

  const url = `/storage${resourcePath}?expires=${expiresAt}&sig=${signature}`;
  return { url, expiresAt: new Date(expiresAt) };
}

function verify(resourcePath, expires, signature) {
  if (!expires || !signature) return false;
  if (Date.now() > Number(expires)) return false;

  const payload = `${resourcePath}:${expires}`;
  const expected = crypto
    .createHmac('sha256', config.signedUrl.secret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

module.exports = { sign, verify };
