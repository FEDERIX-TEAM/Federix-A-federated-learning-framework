import { Round } from '../models/Round.js';
import { publish, ADMIN_ROLES } from './lib/events.js';

const CHECK_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 90_000; // 3 missed 30s beats

/** Marks participants as 'dropped' after 3 missed heartbeats. Returns a stop() function. */
export function startHeartbeatWatcher(logger) {
  const timer = setInterval(async () => {
    try {
      const rounds = await Round.find({ status: 'active' });
      for (const round of rounds) {
        let changed = false;
        for (const p of round.participants) {
          if (p.status !== 'joined') continue;
          const last = (p.last_heartbeat_at ?? p.joined_at).getTime();
          if (Date.now() - last > TIMEOUT_MS) {
            p.status = 'dropped';
            p.left_at = new Date();
            p.leave_reason = 'missed heartbeats';
            changed = true;
            publish('round_client_left', { round_id: round.round_id, client_id: p.client_id, reason: 'missed heartbeats' }, ADMIN_ROLES);
          }
        }
        if (changed) await round.save();
      }
    } catch (err) {
      logger.error({ err }, 'heartbeat watcher failed');
    }
  }, CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
