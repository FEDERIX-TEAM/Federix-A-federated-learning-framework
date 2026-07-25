const jwtLib = require('jsonwebtoken');
const config = require('../config');

function signAccessToken(payload) {
  return jwtLib.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
}

function signRefreshToken(payload) {
  return jwtLib.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwtLib.verify(token, config.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwtLib.verify(token, config.jwt.refreshSecret);
}

function expiresInSeconds() {
  // Parses e.g. "15m" / "7d" into seconds for API responses.
  const str = config.jwt.accessExpiresIn;
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) return 900;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return n * mult;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiresInSeconds,
};
