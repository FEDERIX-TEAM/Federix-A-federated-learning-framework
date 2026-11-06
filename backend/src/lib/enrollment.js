import crypto from 'node:crypto';
import { EnrollmentToken } from '../../models/EnrollmentToken.js';
import { unauthenticated, permissionDenied } from './errors.js';

const PREFIX = 'fdx_enroll_';
const FORMAT = /^fdx_enroll_[0-9a-f]{64}$/;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function newEnrollmentToken() {
  return `${PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

export const isActive = (t, now = new Date()) => !t.revoked_at && t.expires_at > now && t.uses < t.max_uses;

export async function consumeEnrollmentToken(token, now = new Date()) {
  if (typeof token !== 'string' || !FORMAT.test(token)) throw unauthenticated('enrollment_token is missing or invalid');
  const tokenHash = hashToken(token);
  const consumed = await EnrollmentToken.findOneAndUpdate(
    { token_hash: tokenHash, revoked_at: null, expires_at: { $gt: now }, $expr: { $lt: ['$uses', '$max_uses'] } },
    { $inc: { uses: 1 }, $set: { last_used_at: now } },
    { returnDocument: 'after' }
  );
  if (consumed) return consumed;

  const found = await EnrollmentToken.findOne({ token_hash: tokenHash }).lean();
  if (!found) throw unauthenticated('enrollment_token is missing or invalid');
  if (found.revoked_at) throw permissionDenied('This enrollment token has been revoked');
  if (found.expires_at <= now) throw permissionDenied('This enrollment token has expired');
  throw permissionDenied('This enrollment token has been used up');
}

export async function releaseEnrollmentToken(tokenId) {
  await EnrollmentToken.updateOne({ token_id: tokenId, uses: { $gt: 0 } }, { $inc: { uses: -1 } });
}
