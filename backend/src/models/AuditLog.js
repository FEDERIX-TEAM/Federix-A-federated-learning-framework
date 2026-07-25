const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  level: { type: String, enum: ['info', 'warn', 'error'], default: 'info', index: true },
  actor: { type: String, required: true, index: true },
  event_type: { type: String, required: true, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
