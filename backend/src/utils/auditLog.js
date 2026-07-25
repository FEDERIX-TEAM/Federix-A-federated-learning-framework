const AuditLog = require('../models/AuditLog');

async function logEvent({ level = 'info', actor, eventType, details = {} }) {
  try {
    await AuditLog.create({ level, actor, event_type: eventType, details });
  } catch (err) {
    // Audit logging must never break the request it's logging.
    // eslint-disable-next-line no-console
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logEvent };
