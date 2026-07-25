const buildApp = require('./app');
const config = require('./config');
const { SystemConfig } = require('./models/SystemConfig');
const Round = require('./models/Round');
const Client = require('./models/Client');

const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000; // 3 missed 30s beats

async function ensureDefaultConfig() {
  const existing = await SystemConfig.findOne({ singleton_key: 'active_config' });
  if (!existing) {
    await SystemConfig.create({ singleton_key: 'active_config' });
  }
}

// Marks clients as 'dropped' from active rounds after 3 missed heartbeats,
// per the /api/v1/client/heartbeat contract in the API reference.
function startHeartbeatWatcher(app) {
  setInterval(async () => {
    try {
      const rounds = await Round.find({ status: 'active' });
      for (const round of rounds) {
        let changed = false;
        for (const p of round.participants) {
          if (p.status !== 'joined') continue;
          const lastBeat = p.last_heartbeat_at ? p.last_heartbeat_at.getTime() : p.joined_at.getTime();
          if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) {
            p.status = 'dropped';
            p.left_at = new Date();
            p.leave_reason = 'missed heartbeats';
            changed = true;
            app.wsBroadcast('round:client_left', { round_id: round.round_id, client_id: p.client_id, reason: 'missed heartbeats' }, app.wsAdminRoles);
          }
        }
        if (changed) await round.save();
      }
    } catch (err) {
      app.log.error({ err }, 'Heartbeat watcher failed');
    }
  }, HEARTBEAT_CHECK_INTERVAL_MS);
}

async function start() {
  const app = buildApp();

  await app.ready();

  try {
    await ensureDefaultConfig();
  } catch (err) {
    app.log.warn({ err: err.message }, 'Could not verify/create default SystemConfig (DB unreachable?) — will retry on first request.');
  }

  startHeartbeatWatcher(app);

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
