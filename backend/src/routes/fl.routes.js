const Round = require('../models/Round');
const Update = require('../models/Update');
const GlobalModel = require('../models/GlobalModel');
const { SystemConfig } = require('../models/SystemConfig');
const { newId } = require('../utils/ids');
const signedUrl = require('../utils/signedUrl');
const { computeUtilityScore } = require('../utils/utilityScore');
const { logEvent } = require('../utils/auditLog');
const config = require('../config');

const START_TIME = Date.now();

async function flRoutes(fastify) {
  // POST /api/v1/fl/round/trigger — Internal
  fastify.post('/round/trigger', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const { round_id, update_ids = [] } = request.body || {};
    if (!round_id) return reply.code(400).send({ error: 'round_id is required' });

    const round = await Round.findOne({ round_id });
    if (!round) return reply.code(404).send({ error: 'Round not found' });

    round.status = 'aggregating';
    await round.save();

    fastify.wsBroadcast('round:aggregating', {
      round_id,
      accepted_updates: update_ids.length,
    }, fastify.wsAdminRoles);

    await logEvent({ actor: 'fl-server', eventType: 'round.aggregation_triggered', details: { round_id } });

    // estimated_duration_ms is a heuristic based on update count — real FL server can override.
    const estimated_duration_ms = Math.max(5000, update_ids.length * 800);
    return reply.send({ accepted: true, estimated_duration_ms });
  });

  // POST /api/v1/fl/round/complete — Internal
  fastify.post('/round/complete', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const { round_id, new_model_version, model_url, global_loss, global_accuracy } = request.body || {};
    if (!round_id || new_model_version == null || !model_url) {
      return reply.code(400).send({ error: 'round_id, new_model_version, and model_url are required' });
    }

    const round = await Round.findOne({ round_id });
    if (!round) return reply.code(404).send({ error: 'Round not found' });

    await GlobalModel.updateMany({}, { is_active: false });
    const model = await GlobalModel.create({
      model_id: newId(),
      model_version: new_model_version,
      round_id,
      weights_url: model_url,
      metrics: { global_loss, global_accuracy },
      is_active: true,
    });

    round.status = 'complete';
    round.model_version_after = new_model_version;
    round.global_loss = global_loss;
    round.global_accuracy = global_accuracy;
    round.completed_at = new Date();
    await round.save();

    fastify.wsBroadcast('round:completed', {
      round_id,
      model_version: new_model_version,
      accuracy: global_accuracy,
      loss: global_loss,
    }, [...fastify.wsAdminRoles, 'sdk_client']);

    await logEvent({ actor: 'fl-server', eventType: 'round.completed', details: { round_id, new_model_version } });

    return reply.send({ success: true, next_round_scheduled: false, model_id: model.model_id });
  });

  // GET /api/v1/fl/round/:roundId/updates — Internal
  fastify.get('/round/:roundId/updates', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const { roundId } = request.params;
    const updates = await Update.find({ round_id: roundId, status: { $in: ['accepted', 'compressed'] } });

    const payload = updates.map((u) => ({
      update_id: u.update_id,
      client_id: u.client_id,
      download_url: signedUrl.sign(`/updates/${u.update_id}`).url,
      utility_score: u.utility_score,
      label_distribution: u.label_distribution,
    }));

    return reply.send(payload);
  });

  // POST /api/v1/fl/model/push — Internal
  fastify.post('/model/push', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const { round_id, model_version, weights_url, metrics = {} } = request.body || {};
    if (model_version == null || !weights_url) {
      return reply.code(400).send({ error: 'model_version and weights_url are required' });
    }

    await GlobalModel.updateMany({}, { is_active: false });
    const model_id = newId();
    const model = await GlobalModel.create({
      model_id,
      model_version,
      round_id: round_id || null,
      weights_url,
      metrics: {
        global_loss: metrics.global_loss ?? null,
        global_accuracy: metrics.global_accuracy ?? null,
      },
      is_active: true,
    });

    await logEvent({ actor: 'fl-server', eventType: 'model.pushed', details: { model_version } });

    return reply.send({ stored: true, model_id: model.model_id });
  });

  // GET /api/v1/fl/status — Internal or Super Admin
  fastify.get('/status', { preHandler: fastify.verifyInternalOrJwt }, async (request, reply) => {
    if (!request.isInternal && request.user?.role !== 'super_admin') {
      return reply.code(403).send({ error: 'Insufficient role for this resource' });
    }

    const lastRound = await Round.findOne().sort({ round_number: -1 });
    return reply.send({
      status: 'ok',
      version: config.buildInfo.apiVersion,
      last_round_id: lastRound?.round_id || null,
      uptime_ms: Date.now() - START_TIME,
    });
  });

  // POST /api/v1/fl/utility/compute — Internal
  fastify.post('/utility/compute', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const { round_id, update_ids = [] } = request.body || {};
    if (!round_id || !Array.isArray(update_ids)) {
      return reply.code(400).send({ error: 'round_id and update_ids[] are required' });
    }

    const updates = await Update.find({ round_id, update_id: { $in: update_ids } });
    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });

    const results = updates.map((u) => {
      const utility_score = computeUtilityScore({
        localLossBefore: u.local_loss_before,
        localLossAfter: u.local_loss_after,
        dataSize: u.data_size,
        labelDistribution: u.label_distribution,
      });
      let compression_level = 'none';
      if (config && utility_score < config.utility_threshold_high) compression_level = 'partial';
      if (config && utility_score < config.utility_threshold_low) compression_level = 'full';

      return { update_id: u.update_id, utility_score, compression_level };
    });

    return reply.send(results);
  });

  // GET /api/v1/fl/config — Internal
  fastify.get('/config', { preHandler: fastify.verifyInternalToken }, async (request, reply) => {
    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    if (!config) return reply.code(503).send({ error: 'System config not initialized' });

    return reply.send({
      mu: config.mu,
      utility_threshold_high: config.utility_threshold_high,
      utility_threshold_low: config.utility_threshold_low,
      compression_ratio: config.compression_ratio,
      min_clients: config.min_clients_per_round,
    });
  });
}

module.exports = flRoutes;
