const Client = require('../models/Client');
const Round = require('../models/Round');
const Update = require('../models/Update');
const GlobalModel = require('../models/GlobalModel');
const { SystemConfig } = require('../models/SystemConfig');
const { newId } = require('../utils/ids');
const signedUrl = require('../utils/signedUrl');
const { computeUtilityScore } = require('../utils/utilityScore');
const { logEvent } = require('../utils/auditLog');

async function clientRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.authorize(['sdk_client']));

  // GET /api/v1/client/status
  fastify.get('/status', async (request, reply) => {
    const client = await Client.findOne({ client_id: request.user.client_id });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    return reply.send({
      client_id: client.client_id,
      status: client.isBanned() ? 'banned' : client.status,
      last_seen: client.last_seen,
      round_count: client.rounds_participated,
    });
  });

  // GET /api/v1/client/round/current
  fastify.get('/round/current', async (request, reply) => {
    const round = await Round.findOne({ status: { $in: ['active', 'aggregating'] } }).sort({ round_number: -1 });
    if (!round) return reply.code(404).send({ error: 'No active round' });

    return reply.send({
      round_id: round.round_id,
      round_number: round.round_number,
      model_version: round.model_version_before,
      deadline: round.deadline_at,
      participants: round.participants.filter((p) => p.status === 'joined').length,
    });
  });

  // POST /api/v1/client/round/join
  fastify.post('/round/join', async (request, reply) => {
    const { round_id, local_data_size, device_info = {} } = request.body || {};
    if (!round_id) return reply.code(400).send({ error: 'round_id is required' });

    const client = await Client.findOne({ client_id: request.user.client_id });
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    if (client.isBanned()) return reply.code(403).send({ error: 'Client is banned from participating' });

    const round = await Round.findOne({ round_id });
    if (!round) return reply.code(404).send({ error: 'Round not found' });
    if (round.status !== 'active') {
      return reply.send({ accepted: false, instructions: `Round is ${round.status}, not accepting joins` });
    }

    const activeCount = round.participants.filter((p) => p.status === 'joined').length;
    if (activeCount >= round.max_clients) {
      return reply.send({ accepted: false, instructions: 'Round is at capacity (max_clients reached)' });
    }

    const already = round.participants.find((p) => p.client_id === client.client_id);
    if (already && already.status === 'joined') {
      return reply.send({
        accepted: true,
        model_download_url: signedUrl.sign(`/models/${round.model_version_before}`).url,
        instructions: 'Already joined this round',
      });
    }

    round.participants.push({
      client_id: client.client_id,
      local_data_size,
      device_info,
      status: 'joined',
      last_heartbeat_at: new Date(),
    });
    await round.save();

    client.rounds_participated += 1;
    await client.save();

    fastify.wsBroadcast('round:client_joined', {
      round_id: round.round_id,
      client_id: client.client_id,
      participant_count: round.participants.filter((p) => p.status === 'joined').length,
    }, fastify.wsAdminRoles);

    const { url } = signedUrl.sign(`/models/${round.model_version_before}`);
    return reply.send({ accepted: true, model_download_url: url, instructions: 'Begin local training' });
  });

  // POST /api/v1/client/round/leave
  fastify.post('/round/leave', async (request, reply) => {
    const { round_id, reason = '' } = request.body || {};
    if (!round_id) return reply.code(400).send({ error: 'round_id is required' });

    const round = await Round.findOne({ round_id });
    if (!round) return reply.code(404).send({ error: 'Round not found' });

    const participant = round.participants.find((p) => p.client_id === request.user.client_id);
    if (!participant || participant.status !== 'joined') {
      return reply.code(400).send({ error: 'Client is not an active participant in this round' });
    }

    participant.status = 'left';
    participant.left_at = new Date();
    participant.leave_reason = reason;
    await round.save();

    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    const remaining = round.participants.filter((p) => p.status === 'joined').length;

    fastify.wsBroadcast('round:client_left', {
      round_id: round.round_id,
      client_id: request.user.client_id,
      reason,
    }, fastify.wsAdminRoles);

    if (config && remaining < config.min_clients_per_round && round.status === 'active') {
      request.log.warn({ round_id }, 'Round dropped below min_clients after a client left');
    }

    return reply.send({ success: true, remaining_participants: remaining });
  });

  // GET /api/v1/client/model/download
  fastify.get('/model/download', async (request, reply) => {
    const { round_id, model_version } = request.query || {};

    let model;
    if (model_version) {
      model = await GlobalModel.findOne({ model_version: Number(model_version) });
    } else if (round_id) {
      const round = await Round.findOne({ round_id });
      if (round?.model_version_before != null) {
        model = await GlobalModel.findOne({ model_version: round.model_version_before });
      }
    } else {
      model = await GlobalModel.findOne({ is_active: true });
    }

    if (!model) return reply.code(404).send({ error: 'Model not found' });

    const { url, expiresAt } = signedUrl.sign(`/models/${model.model_version}`);
    return reply.send({
      download_url: url,
      model_version: model.model_version,
      format: model.format,
      expires_at: expiresAt,
    });
  });

  // POST /api/v1/client/update/submit
  fastify.post('/update/submit', async (request, reply) => {
    const {
      round_id,
      delta_weights_url,
      local_loss_before,
      local_loss_after,
      label_distribution = {},
      data_size,
      training_time_ms,
    } = request.body || {};

    if (!round_id || delta_weights_url == null || local_loss_before == null || local_loss_after == null || data_size == null) {
      return reply.code(400).send({ error: 'round_id, delta_weights_url, local_loss_before, local_loss_after, data_size are required' });
    }

    const round = await Round.findOne({ round_id });
    if (!round) return reply.code(404).send({ error: 'Round not found' });

    const participant = round.participants.find((p) => p.client_id === request.user.client_id && p.status === 'joined');
    if (!participant) {
      return reply.code(403).send({ error: 'Client is not an active participant in this round' });
    }

    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    const utility_score = computeUtilityScore({ localLossBefore: local_loss_before, localLossAfter: local_loss_after, dataSize: data_size, labelDistribution: label_distribution });

    let status = 'accepted';
    let compression_required = false;
    let compression_level = 'none';
    if (config) {
      if (utility_score < config.utility_threshold_low) {
        status = 'rejected';
      } else if (utility_score < config.utility_threshold_high) {
        compression_required = true;
        compression_level = 'partial';
        status = 'compressed';
      }
    }

    const update_id = newId();
    const update = await Update.findOneAndUpdate(
      { round_id, client_id: request.user.client_id },
      {
        update_id,
        round_id,
        client_id: request.user.client_id,
        delta_weights_url,
        local_loss_before,
        local_loss_after,
        label_distribution,
        data_size,
        training_time_ms,
        status,
        utility_score,
        compression_required,
        compression_level,
        submitted_at: new Date(),
      },
      { upsert: true, new: true }
    );

    fastify.wsBroadcast('round:update_received', {
      round_id,
      update_id: update.update_id,
      client_id: request.user.client_id,
      utility_score,
    }, fastify.wsAdminRoles);

    return reply.send({ update_id: update.update_id, accepted: status !== 'rejected', compression_required });
  });

  // GET /api/v1/client/update/status
  fastify.get('/update/status', async (request, reply) => {
    const { round_id } = request.query || {};
    if (!round_id) return reply.code(400).send({ error: 'round_id query param is required' });

    const update = await Update.findOne({ round_id, client_id: request.user.client_id });
    if (!update) return reply.code(404).send({ error: 'No update found for this round' });

    return reply.send({
      update_id: update.update_id,
      status: update.status,
      utility_score: update.utility_score,
      reason: update.reason,
    });
  });

  // GET /api/v1/client/metrics/self
  fastify.get('/metrics/self', async (request, reply) => {
    const limit = Math.min(parseInt(request.query?.limit || '10', 10), 100);
    const updates = await Update.find({ client_id: request.user.client_id })
      .sort({ submitted_at: -1 })
      .limit(limit);

    return reply.send(
      updates.map((u) => ({
        round_id: u.round_id,
        utility_score: u.utility_score,
        status: u.status,
        loss_improvement: u.local_loss_before > 0 ? (u.local_loss_before - u.local_loss_after) / u.local_loss_before : 0,
      }))
    );
  });

  // POST /api/v1/client/heartbeat
  fastify.post('/heartbeat', async (request, reply) => {
    const { round_id } = request.body || {};
    if (!round_id) return reply.code(400).send({ error: 'round_id is required' });

    const round = await Round.findOne({ round_id });
    if (round) {
      const participant = round.participants.find((p) => p.client_id === request.user.client_id && p.status === 'joined');
      if (participant) {
        participant.last_heartbeat_at = new Date();
        participant.missed_heartbeats = 0;
        await round.save();
      }
    }

    await Client.updateOne({ client_id: request.user.client_id }, { last_seen: new Date(), status: 'active' });

    return reply.send({ ok: true, server_time: new Date().toISOString() });
  });

  // GET /api/v1/client/config
  fastify.get('/config', async (request, reply) => {
    const config = await SystemConfig.findOne({ singleton_key: 'active_config' });
    if (!config) return reply.code(503).send({ error: 'System config not initialized' });

    return reply.send({
      mu: config.mu,
      local_epochs: config.local_epochs,
      batch_size: config.batch_size,
      compression_threshold: config.utility_threshold_high,
    });
  });
}

module.exports = clientRoutes;
