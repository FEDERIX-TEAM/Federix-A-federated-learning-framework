import { FlServerStatus } from '../../models/FlServerStatus.js';
import { config } from '../../config/index.js';

export async function latestFlStatus(now = Date.now()) {
  const doc = await FlServerStatus.findOne().sort({ last_report_at: -1 }).lean();
  if (!doc) return null;
  return { ...doc, online: now - doc.last_report_at.getTime() <= config.scheduler.flStatusStaleAfterMs };
}
