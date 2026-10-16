import { SystemConfig } from '../../models/SystemConfig.js';
import { kAuthContext } from '../../interceptors/context.js';
import { unauthenticated, invalidArg } from './errors.js';

/** The decoded JWT for the current call ({ sub, role, client_id?, jti, exp }). */
export function authOf(ctx) {
  const auth = ctx.values.get(kAuthContext);
  if (!auth) throw unauthenticated('Not authenticated');
  return auth;
}

/** Returns the singleton SystemConfig, creating it with defaults on first use. */
export async function getActiveConfig() {
  return SystemConfig.findOneAndUpdate(
    { singleton_key: 'active_config' },
    { $setOnInsert: { singleton_key: 'active_config' } },
    { upsert: true, returnDocument: 'after' }
  );
}

/** Clamp a client-supplied count: 0/negative -> def, above max -> max. */
export function clampN(n, def = 20, max = 200) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
}

export function parseDate(str, field) {
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) throw invalidArg(`${field} is not a valid date`);
  return d;
}

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const joinedCount = (round) => round.participants.filter((p) => p.status === 'joined').length;

export function giniCoefficient(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cumulative = 0;
  sorted.forEach((v, i) => {
    cumulative += (i + 1) * v;
  });
  return Number(((2 * cumulative) / (n * sum) - (n + 1) / n).toFixed(4));
}
