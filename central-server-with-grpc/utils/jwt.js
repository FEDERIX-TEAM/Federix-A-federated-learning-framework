import jwtLib from 'jsonwebtoken';
import { config } from '../config/index.js';

export function signAccessToken(payload) {
  return jwtLib.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessExpiresIn });
}

export function signRefreshToken(payload) {
  return jwtLib.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
}

export function verifyAccessToken(token) {
  return jwtLib.verify(token, config.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwtLib.verify(token, config.jwt.refreshSecret);
}

export function expiresInSeconds() {
  const str = config.jwt.accessExpiresIn;
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) return 900;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return n * mult;
}
