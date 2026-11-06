import { Client } from '../models/Client.js';
import { logEvent } from '../utils/auditLog.js';
import { config } from '../config/index.js';

const PERMANENT_BAN = new Date(0);

export async function refreshClientStatuses({ idleAfterMs, disconnectedAfterMs } = config.clientStatus, now = Date.now()) {
  const expired = await Client.find({ banned_until: { $gt: PERMANENT_BAN, $lte: new Date(now) } }).select('client_id').lean();
  if (expired.length) {
    const ids = expired.map((c) => c.client_id);
    await Client.updateMany(
      { client_id: { $in: ids }, banned_until: { $gt: PERMANENT_BAN, $lte: new Date(now) } },
      { $set: { banned_until: null, ban_reason: null, status: 'idle' } }
    );
    await Promise.all(ids.map((id) => logEvent({ actor: 'system', eventType: 'client.ban_expired', details: { client_id: id } })));
  }

  const idle = await Client.updateMany(
    { status: 'active', $or: [{ last_seen: null }, { last_seen: { $lt: new Date(now - idleAfterMs) } }] },
    { $set: { status: 'idle' } }
  );
  const disconnected = await Client.updateMany(
    { status: { $in: ['active', 'idle'] }, $or: [{ last_seen: null }, { last_seen: { $lt: new Date(now - disconnectedAfterMs) } }] },
    { $set: { status: 'disconnected' } }
  );

  return { bansExpired: expired.length, idle: idle.modifiedCount, disconnected: disconnected.modifiedCount };
}

export function startClientStatusWatcher(logger, settings = config.clientStatus) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await refreshClientStatuses(settings);
    } catch (err) {
      logger.error({ err }, 'client status watcher failed');
    } finally {
      running = false;
    }
  }, settings.checkIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
