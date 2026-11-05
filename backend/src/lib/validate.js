import { invalidArg } from './errors.js';

export const MAX_LABEL_CLASSES = 1000;
export const MAX_LABEL_KEY_LENGTH = 64;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function rangeText(min, max) {
  if (min !== -Infinity && max !== Infinity) return `within [${min}, ${max}]`;
  if (min !== -Infinity) return `>= ${min}`;
  return `<= ${max}`;
}

export function requireFinite(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (!isFiniteNumber(value)) throw invalidArg(`${field} must be a finite number`);
  if (value < min || value > max) throw invalidArg(`${field} must be ${rangeText(min, max)}`);
  return value;
}

export function isValidLabelKey(key) {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= MAX_LABEL_KEY_LENGTH &&
    !key.includes('.') &&
    !key.includes('$') &&
    !FORBIDDEN_KEYS.has(key)
  );
}

export function isValidLabelDistribution(dist) {
  if (dist == null) return true;
  if (typeof dist !== 'object' || Array.isArray(dist)) return false;
  const entries = Object.entries(dist);
  if (entries.length > MAX_LABEL_CLASSES) return false;
  return entries.every(([k, v]) => isValidLabelKey(k) && isFiniteNumber(v) && v >= 0);
}

export function requireLabelDistribution(dist, field = 'label_distribution') {
  if (dist == null) return {};
  if (typeof dist !== 'object' || Array.isArray(dist)) throw invalidArg(`${field} must be a map of label to count`);
  const entries = Object.entries(dist);
  if (entries.length > MAX_LABEL_CLASSES) throw invalidArg(`${field} has more than ${MAX_LABEL_CLASSES} labels`);
  for (const [k, v] of entries) {
    if (!isValidLabelKey(k)) {
      throw invalidArg(`${field} label '${String(k).slice(0, MAX_LABEL_KEY_LENGTH)}' is invalid (1-${MAX_LABEL_KEY_LENGTH} chars, no '.' or '$')`);
    }
    if (!isFiniteNumber(v) || v < 0) throw invalidArg(`${field} count for label '${k}' must be a finite number >= 0`);
  }
  return Object.fromEntries(entries);
}
