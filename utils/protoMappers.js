// Keeps every enum <-> string mapping in one place — see design.md / rules.md
// (proto is the source of truth for the numeric values; this file is the only
// place that translates them to/from the plain strings used in Mongo + business logic).

export const ROLE_TO_PROTO = {
  super_admin: 1,
  admin: 2,
  fl_engineer: 3,
  viewer: 4,
  sdk_client: 5,
};
export const ROLE_FROM_PROTO = Object.fromEntries(Object.entries(ROLE_TO_PROTO).map(([k, v]) => [v, k]));

export const ROUND_STATUS_TO_PROTO = {
  pending: 1,
  active: 2,
  aggregating: 3,
  complete: 4,
  failed: 5,
  aborted: 6,
};

export const UPDATE_STATUS_TO_PROTO = {
  pending: 1,
  accepted: 2,
  compressed: 3,
  rejected: 4,
};

export const COMPRESSION_LEVEL_TO_PROTO = {
  none: 1,
  partial: 2,
  full: 3,
};

export function dateToIso(date) {
  if (!date) return '';
  return new Date(date).toISOString();
}

export function labelDistributionToMessage(obj = {}) {
  return { counts: obj };
}

export function labelDistributionFromMessage(msg) {
  return msg?.counts || {};
}

export function stringMapToPlain(msg) {
  return msg?.entries || {};
}

export function stringMapFromPlain(obj = {}) {
  return { entries: obj };
}
