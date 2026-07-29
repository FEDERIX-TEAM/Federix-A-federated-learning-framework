const { randomUUID, randomBytes } = require('crypto');

function newId() {
  return randomUUID();
}

function newApiKey() {
  return `fdx_${randomBytes(24).toString('hex')}`;
}

module.exports = { newId, newApiKey };
