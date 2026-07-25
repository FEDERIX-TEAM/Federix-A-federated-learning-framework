const Client = require('../models/Client');
const Round = require('../models/Round');
const Update = require('../models/Update');
const GlobalModel = require('../models/GlobalModel');
const AdminUser = require('../models/AdminUser');
const AuditLog = require('../models/AuditLog');
const { SystemConfig, ConfigHistory } = require('../models/SystemConfig');
const { newId } = require('../utils/ids');
const signedUrl = require('../utils/signedUrl');
const { logEvent } = require('../utils/auditLog');

const ALL_DASHBOARD_ROLES = ['admin', 'super_admin', 'fl_engineer', 'viewer'];
const MANAGE_ROLES = ['admin', 'super_admin'];
const SUPER_ONLY = ['super_admin'];

function giniCoefficient(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  let cumulative = 0;
  sorted.forEach((v, i) => {
    cumulative += (i + 1) * v;
  });

  return Number((((2 * cumulative) / (n * sum)) - (n + 1) / n).toFixed(4));
}

async function adminRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  const auth = (roles) => fastify.authorize(roles);

  // GET /api/v1/admin/overview
  fastify.get('/overview', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const [total_clients, active_clients, activeRound, latestModel] = await Promise.all([
      Client.countDocuments({}),
      Client.countDocuments({ status: 'active' }),
      Round.findOne({ status: { $in: ['active', 'aggregating'] } }).sort({ round_number: -1 }),
      GlobalModel.findOne({ is_active: true }),
    ]);

    return reply.send({
      total_clients,
      active_clients,
      current_round: activeRound ? { round_id: activeRound.round_id, status: activeRound.status } : null,
      latest_model_version: latestModel?.model_version ?? null,
      health: 'ok',
    });
  });

  // GET /api/v1/admin/clients
  fastify.get('/clients', { preHandler: auth(MANAGE_ROLES) }, async (request, reply) => {
    const { page = 1, limit = 20, status, sort_by = 'created_at' } = request.query || {};
    const filter = {};
    if (status === 'banned') filter.banned_until = { $ne: null };
    else if (status) filter.status = status;

    const clients = await Client.find(filter)
      .sort({ [sort_by]: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    return reply.send(
      clients.map((c) => ({
        client_id: c.client_id,
        name: c.name,
        status: c.isBanned() ? 'banned' : c.status,
        last_seen: c.last_seen,
        rounds_participated: c.rounds_participated,
        utility_avg: c.utility_avg,
      }))
    );
  });

  // GET /api/v1/admin/clients/:clientId
  fastify.get('/clients/:clientId', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const client = await Client.findOne({ client_id: request.params.clientId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    const updates = await Update.find({ client_id: client.client_id }).sort({ submitted_at: -1 }).limit(50);
    const scores = updates.map((u) => u.utility_score).filter((s) => s != null);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return reply.send({
      client_id: client.client_id,
      name: client.name,
      history: updates.map((u) => ({ round_id: u.round_id, status: u.status, submitted_at: u.submitted_at })),
      utility_scores: updates.map((u) => ({ round_id: u.round_id, score: u.utility_score })),
      label_entropy_avg: Number(avgScore.toFixed(4)),
    });
  });

  // PUT /api/v1/admin/clients/:clientId/ban
  fastify.put('/clients/:clientId/ban', { preHandler: auth(MANAGE_ROLES) }, async (request, reply) => {
    const { reason, duration_hours = 0 } = request.body || {};
    const client = await Client.findOne({ client_id: request.params.clientId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    client.banned_until = duration_hours === 0 ? new Date(0) : new Date(Date.now() + duration_hours * 3600 * 1000);
    client.ban_reason = reason || null;
    client.status = 'banned';
    await client.save();

    // Void any pending/accepted updates in the currently active round.
    const activeRound = await Round.findOne({ status: 'active' });
    if (activeRound) {
      await Update.updateMany(
        { round_id: activeRound.round_id, client_id: client.client_id },
        { status: 'rejected', reason: 'client banned' }
      );
    }

    await logEvent({ actor: request.user.sub, eventType: 'client.banned', details: { client_id: client.client_id, reason, duration_hours } });
    fastify.wsBroadcast('client:banned', { client_id: client.client_id, banned_until: client.banned_until }, fastify.wsAdminRoles);

    return reply.send({ success: true, banned_until: client.banned_until });
  });

  // PUT /api/v1/admin/clients/:clientId/unban
  fastify.put('/clients/:clientId/unban', { preHandler: auth(MANAGE_ROLES) }, async (request, reply) => {
    const client = await Client.findOne({ client_id: request.params.clientId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    client.banned_until = null;
    client.ban_reason = null;
    client.status = 'idle';
    await client.save();

    await logEvent({ actor: request.user.sub, eventType: 'client.unbanned', details: { client_id: client.client_id } });

    return reply.send({ success: true, client_status: client.status });
  });

  // DELETE /api/v1/admin/clients/:clientId
  fastify.delete('/clients/:clientId', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    const client = await Client.findOne({ client_id: request.params.clientId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    const updateResult = await Update.deleteMany({ client_id: client.client_id });
    await client.deleteOne();

    await logEvent({ actor: request.user.sub, eventType: 'client.deleted', details: { client_id: request.params.clientId } });

    return reply.send({ deleted: true, purged_records: updateResult.deletedCount });
  });

  // GET /api/v1/admin/rounds
  fastify.get('/rounds', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const { page = 1, limit = 20, status } = request.query || {};
    const filter = status ? { status } : {};

    const rounds = await Round.find(filter)
      .sort({ round_number: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    return reply.send(
      rounds.map((r) => ({
        round_id: r.round_id,
        round_number: r.round_number,
        status: r.status,
        participant_count: r.participants.filter((p) => p.status === 'joined').length,
        accuracy: r.global_accuracy,
        started_at: r.started_at,
        completed_at: r.completed_at,
      }))
    );
  });

  // GET /api/v1/admin/rounds/:roundId
  fastify.get('/rounds/:roundId', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const round = await Round.findOne({ round_id: request.params.roundId });
    if (!round) return reply.code(404).send({ error: 'Round not found' });

    const updates = await Update.find({ round_id: round.round_id });

    return reply.send({
      round_id: round.round_id,
      updates: updates.map((u) => ({ update_id: u.update_id, client_id: u.client_id, status: u.status })),
      utility_scores: updates.map((u) => ({ client_id: u.client_id, score: u.utility_score })),
      global_metrics: { global_loss: round.global_loss, global_accuracy: round.global_accuracy },
      timeline: {
        started_at: round.started_at,
        completed_at: round.completed_at,
        status: round.status,
      },
    });
  });

  // POST /api/v1/admin/rounds/start
  fastify.post('/rounds/start', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const { max_clients, deadline_seconds, notes = '' } = request.body || {};
    if (!max_clients || !deadline_seconds) {
      return reply.code(400).send({ error: 'max_clients and deadline_seconds are required' });
    }

    const active = await Round.findOne({ status: { $in: ['active', 'aggregating'] } });
    if (active) return reply.code(409).send({ error: 'A round is already active', round_id: active.round_id });

    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    if (!config) return reply.code(503).send({ error: 'System config not initialized' });

    const latestModel = await GlobalModel.findOne({ is_active: true });
    const lastRound = await Round.findOne().sort({ round_number: -1 });
    const round_number = (lastRound?.round_number || 0) + 1;

    const round = await Round.create({
      round_id: newId(),
      round_number,
      status: 'active',
      max_clients,
      min_clients: config.min_clients_per_round,
      deadline_seconds,
      deadline_at: new Date(Date.now() + deadline_seconds * 1000),
      notes,
      config_snapshot: config.toObject(),
      model_version_before: latestModel?.model_version ?? null,
    });

    await logEvent({ actor: request.user.sub, eventType: 'round.started', details: { round_id: round.round_id } });
    fastify.wsBroadcast('round:started', {
      round_id: round.round_id,
      round_number: round.round_number,
      max_clients,
      deadline: round.deadline_at,
    }, [...fastify.wsAdminRoles, 'sdk_client']);

    return reply.code(201).send({ round_id: round.round_id, round_number: round.round_number, started_at: round.started_at });
  });

  // POST /api/v1/admin/rounds/:roundId/stop
  fastify.post('/rounds/:roundId/stop', { preHandler: auth(MANAGE_ROLES) }, async (request, reply) => {
    const { reason = '' } = request.body || {};
    const round = await Round.findOne({ round_id: request.params.roundId });
    if (!round) return reply.code(404).send({ error: 'Round not found' });
    if (!['active', 'aggregating'].includes(round.status)) {
      return reply.code(400).send({ error: `Round is already ${round.status}` });
    }

    round.status = 'aborted';
    round.aborted_reason = reason;
    round.completed_at = new Date();
    await round.save();

    await Update.updateMany({ round_id: round.round_id, status: 'pending' }, { status: 'rejected', reason: 'round aborted' });

    fastify.wsBroadcast('round:aborted', { round_id: round.round_id, reason }, [...fastify.wsAdminRoles, 'sdk_client']);
    await logEvent({ actor: request.user.sub, eventType: 'round.aborted', details: { round_id: round.round_id, reason } });

    return reply.send({ success: true, round_status: round.status });
  });

  // GET /api/v1/admin/rounds/:roundId/updates
  fastify.get('/rounds/:roundId/updates', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const updates = await Update.find({ round_id: request.params.roundId });
    return reply.send(
      updates.map((u) => ({
        update_id: u.update_id,
        client_id: u.client_id,
        utility_score: u.utility_score,
        status: u.status,
        compression_level: u.compression_level,
        submitted_at: u.submitted_at,
      }))
    );
  });

  // GET /api/v1/admin/metrics/convergence
  fastify.get('/metrics/convergence', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const last_n_rounds = Math.min(parseInt(request.query?.last_n_rounds || '20', 10), 200);
    const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(last_n_rounds);

    const ordered = rounds.slice().reverse();
    const result = ordered.map((r, i) => ({
      round_number: r.round_number,
      global_loss: r.global_loss,
      global_accuracy: r.global_accuracy,
      delta_loss: i > 0 && ordered[i - 1].global_loss != null && r.global_loss != null
        ? Number((r.global_loss - ordered[i - 1].global_loss).toFixed(4))
        : null,
    }));

    return reply.send(result);
  });

  // GET /api/v1/admin/metrics/clients
  fastify.get('/metrics/clients', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const { client_id, last_n_rounds = 20 } = request.query || {};
    const filter = client_id ? { client_id } : {};

    const updates = await Update.find(filter).sort({ submitted_at: -1 }).limit(Number(last_n_rounds) * (client_id ? 1 : 50));

    const byClient = new Map();
    for (const u of updates) {
      if (!byClient.has(u.client_id)) byClient.set(u.client_id, []);
      byClient.get(u.client_id).push({ round_id: u.round_id, score: u.utility_score });
    }

    const result = Array.from(byClient.entries()).map(([cid, scores]) => ({
      client_id: cid,
      round_scores: scores,
      avg_utility: Number((scores.reduce((a, b) => a + (b.score || 0), 0) / scores.length).toFixed(4)),
    }));

    return reply.send(result);
  });

  // GET /api/v1/admin/metrics/communication
  fastify.get('/metrics/communication', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const last_n_rounds = Math.min(parseInt(request.query?.last_n_rounds || '20', 10), 200);
    const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(last_n_rounds);

    const result = [];
    for (const r of rounds.reverse()) {
      const updates = await Update.find({ round_id: r.round_id });
      const full_count = updates.filter((u) => u.compression_level === 'none' && u.status !== 'rejected').length;
      const compressed_count = updates.filter((u) => u.compression_level && u.compression_level !== 'none').length;
      const skipped_count = updates.filter((u) => u.status === 'rejected').length;

      // Approximate bytes from reported data_size (real byte accounting belongs to the transport layer).
      const bytes_received = updates.reduce((sum, u) => sum + (u.data_size || 0) * 4, 0);
      const bytes_saved = updates
        .filter((u) => u.compression_level && u.compression_level !== 'none')
        .reduce((sum, u) => sum + (u.data_size || 0) * 2, 0);

      result.push({
        round_number: r.round_number,
        bytes_received,
        bytes_saved,
        full_count,
        compressed_count,
        skipped_count,
      });
    }

    return reply.send(result);
  });

  // GET /api/v1/admin/metrics/fairness
  fastify.get('/metrics/fairness', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const last_n_rounds = Math.min(parseInt(request.query?.last_n_rounds || '20', 10), 200);
    const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(last_n_rounds);

    const result = [];
    for (const r of rounds.reverse()) {
      const updates = await Update.find({ round_id: r.round_id });
      const scores = updates.map((u) => u.utility_score || 0);
      const joined = r.participants.filter((p) => p.status === 'joined').length;
      const lowUtilityCount = scores.filter((s) => s < 0.3).length;

      result.push({
        round_number: r.round_number,
        minority_participation_rate: joined > 0 ? Number((lowUtilityCount / joined).toFixed(4)) : 0,
        gini_coefficient: giniCoefficient(scores),
        utility_distribution: scores,
      });
    }

    return reply.send(result);
  });

  // GET /api/v1/admin/config
  fastify.get('/config', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    if (!config) return reply.code(503).send({ error: 'System config not initialized' });

    return reply.send({
      mu: config.mu,
      min_clients_per_round: config.min_clients_per_round,
      max_round_duration_seconds: config.max_round_duration_seconds,
      utility_threshold_high: config.utility_threshold_high,
      utility_threshold_low: config.utility_threshold_low,
      compression_ratio: config.compression_ratio,
      max_clients_per_round: config.max_clients_per_round,
    });
  });

  // PUT /api/v1/admin/config
  fastify.put('/config', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    const updates = request.body || {};
    const allowedFields = [
      'mu', 'min_clients_per_round', 'max_clients_per_round', 'max_round_duration_seconds',
      'utility_threshold_high', 'utility_threshold_low', 'compression_ratio', 'local_epochs', 'batch_size',
    ];

    const diff = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) diff[field] = updates[field];
    }

    const config = await SystemConfig.findOneAndUpdate(
      { singleton_key: 'active_config' },
      { ...diff, updated_by: request.user.sub },
      { new: true, upsert: true }
    );

    const lastRound = await Round.findOne().sort({ round_number: -1 });
    await ConfigHistory.create({
      changed_by: request.user.sub,
      diff,
      round_number_applied: (lastRound?.round_number || 0) + 1,
    });

    await logEvent({ actor: request.user.sub, eventType: 'config.updated', details: diff });

    return reply.send({ updated_config: config, effective_from_round: (lastRound?.round_number || 0) + 1 });
  });

  // GET /api/v1/admin/config/history
  fastify.get('/config/history', { preHandler: auth(['super_admin', 'admin']) }, async (request, reply) => {
    const history = await ConfigHistory.find().sort({ changed_at: -1 }).limit(100);
    return reply.send(
      history.map((h) => ({
        changed_at: h.changed_at,
        changed_by: h.changed_by,
        diff: h.diff,
        round_number_applied: h.round_number_applied,
      }))
    );
  });

  // GET /api/v1/admin/models
  fastify.get('/models', { preHandler: auth(ALL_DASHBOARD_ROLES) }, async (request, reply) => {
    const models = await GlobalModel.find().sort({ model_version: -1 });
    return reply.send(
      models.map((m) => ({
        model_id: m.model_id,
        model_version: m.model_version,
        round_id: m.round_id,
        accuracy: m.metrics?.global_accuracy ?? null,
        size_bytes: m.size_bytes,
        created_at: m.created_at,
      }))
    );
  });

  // GET /api/v1/admin/models/:modelId/download
  fastify.get('/models/:modelId/download', { preHandler: auth(['admin', 'super_admin', 'fl_engineer']) }, async (request, reply) => {
    const model = await GlobalModel.findOne({ model_id: request.params.modelId });
    if (!model) return reply.code(404).send({ error: 'Model not found' });

    const { url, expiresAt } = signedUrl.sign(`/models/${model.model_version}`);
    return reply.send({ download_url: url, expires_at: expiresAt, model_version: model.model_version });
  });

  // DELETE /api/v1/admin/models/:modelId
  fastify.delete('/models/:modelId', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    const model = await GlobalModel.findOne({ model_id: request.params.modelId });
    if (!model) return reply.code(404).send({ error: 'Model not found' });
    if (model.is_active) return reply.code(400).send({ error: 'Cannot delete the currently active model' });

    await model.deleteOne();
    await logEvent({ actor: request.user.sub, eventType: 'model.deleted', details: { model_id: request.params.modelId } });

    return reply.send({ deleted: true });
  });

  // GET /api/v1/admin/logs
  fastify.get('/logs', { preHandler: auth(['super_admin', 'admin']) }, async (request, reply) => {
    const { level, actor, event_type, from_date, to_date, limit = 100 } = request.query || {};
    const filter = {};
    if (level) filter.level = level;
    if (actor) filter.actor = actor;
    if (event_type) filter.event_type = event_type;
    if (from_date || to_date) {
      filter.timestamp = {};
      if (from_date) filter.timestamp.$gte = new Date(from_date);
      if (to_date) filter.timestamp.$lte = new Date(to_date);
    }

    const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(Math.min(Number(limit), 500));
    return reply.send(
      logs.map((l) => ({ timestamp: l.timestamp, level: l.level, actor: l.actor, event_type: l.event_type, details: l.details }))
    );
  });

  // GET /api/v1/admin/users
  fastify.get('/users', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    const users = await AdminUser.find();
    return reply.send(
      users.map((u) => ({ user_id: u.user_id, name: u.name, email: u.email, role: u.role, created_at: u.created_at, last_login: u.last_login }))
    );
  });

  // PUT /api/v1/admin/users/:userId/role
  fastify.put('/users/:userId/role', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    const { role } = request.body || {};
    if (!['admin', 'fl_engineer', 'viewer'].includes(role)) {
      return reply.code(400).send({ error: "role must be one of 'admin', 'fl_engineer', 'viewer'" });
    }

    const user = await AdminUser.findOne({ user_id: request.params.userId });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    user.role = role;
    await user.save();

    await logEvent({ actor: request.user.sub, eventType: 'admin.role_changed', details: { user_id: user.user_id, new_role: role } });

    return reply.send({ user_id: user.user_id, new_role: user.role });
  });

  // DELETE /api/v1/admin/users/:userId
  fastify.delete('/users/:userId', { preHandler: auth(SUPER_ONLY) }, async (request, reply) => {
    if (request.params.userId === request.user.sub) {
      return reply.code(400).send({ error: 'Cannot delete your own account' });
    }

    const target = await AdminUser.findOne({ user_id: request.params.userId });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    if (target.role === 'super_admin') {
      const superAdminCount = await AdminUser.countDocuments({ role: 'super_admin' });
      if (superAdminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot delete the last Super Admin' });
      }
    }

    await target.deleteOne();
    await logEvent({ actor: request.user.sub, eventType: 'admin.user_deleted', details: { deleted_user_id: request.params.userId } });

    return reply.send({ deleted: true });
  });
}

module.exports = adminRoutes;
