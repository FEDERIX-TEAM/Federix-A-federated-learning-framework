import { randomUUID, randomBytes } from 'crypto';

export function newId() {
  return randomUUID();
}

export function newApiKey() {
  return `fdx_${randomBytes(24).toString('hex')}`;
}
