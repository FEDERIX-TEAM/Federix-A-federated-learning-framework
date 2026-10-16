import { AuditLog } from '../models/AuditLog.js';

export async function logEvent({ level = 'info', actor, eventType, details = {} }) {
  try {
    await AuditLog.create({ level, actor, event_type: eventType, details });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}
