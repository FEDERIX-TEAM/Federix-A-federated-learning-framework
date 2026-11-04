import { Client } from '../../models/Client.js';
import { Round } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { computeUtilityScore } from '../../utils/utilityScore.js';
import { dateToIso, UPDATE_STATUS_TO_PROTO, stringMapToPlain, labelDistributionFromMessage } from '../../utils/protoMappers.js';
import { authOf, getActiveConfig, clampN, joinedCount, num } from '../lib/helpers.js';
import { invalidArg, notFound, permissionDenied, failedPrecondition } from '../lib/errors.js';
import { publish, ADMIN_ROLES } from '../lib/events.js';

const modelUrl = (version) => (version == null ? '' : signedUrl.sign(`/models/${version}`).url);

export function createClientService() {
  const clientIdOf = (ctx) => authOf(ctx).client_id;

  async function loadClient(ctx) {
    const client = await Client.findOne({ client_id: clientIdOf(ctx) });
    if (!client) throw notFound('Client not found');
    return client;
  }

  return {
    async getStatus(_req, ctx) {
      const client = await loadClient(ctx);
      return {
        clientId: client.client_id,
        status: client.isBanned() ? 'banned' : client.status,
        lastSeen: dateToIso(client.last_seen),
        roundCount: client.rounds_participated,
      };
    },

    async getCurrentRound() {
      const round = await Round.findOne({ status: { $in: ['active', 'aggregating'] } }).sort({ round_number: -1 });
      if (!round) throw notFound('No active round');
      return {
        roundId: round.round_id,
        roundNumber: round.round_number,
        modelVersion: round.model_version_before ?? 0,
        deadline: dateToIso(round.deadline_at),
        participants: joinedCount(round),
      };
    },

    async joinRound(req, ctx) {
      if (!req.roundId) throw invalidArg('round_id is required');

      const client = await loadClient(ctx);
      if (client.isBanned()) throw permissionDenied('Client is banned from participating');

      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (round.status !== 'active') {
        return { accepted: false, modelDownloadUrl: '', instructions: `Round is ${round.status}, not accepting joins` };
      }
      if (new Date() > round.deadline_at) {
        return { accepted: false, modelDownloadUrl: '', instructions: 'Round deadline has passed' };
      }

      const existing = round.participants.find((p) => p.client_id === client.client_id);
      if (existing?.status === 'joined') {
        return { accepted: true, modelDownloadUrl: modelUrl(round.model_version_before), instructions: 'Already joined this round' };
      }
      if (joinedCount(round) >= round.max_clients) {
        return { accepted: false, modelDownloadUrl: '', instructions: 'Round is at capacity (max_clients reached)' };
      }

      const participant = {
        client_id: client.client_id,
        local_data_size: req.localDataSize || null,
        device_info: stringMapToPlain(req.deviceInfo),
        status: 'joined',
        joined_at: new Date(),
        last_heartbeat_at: new Date(),
      };
      if (existing) Object.assign(existing, participant, { left_at: null, leave_reason: null, missed_heartbeats: 0 });
      else round.participants.push(participant);
      await round.save();

      client.rounds_participated += 1;
      client.status = 'active';
      client.last_seen = new Date();
      await client.save();

      publish('round_client_joined', {
        round_id: round.round_id,
        client_id: client.client_id,
        participant_count: joinedCount(round),
      }, ADMIN_ROLES);

      return { accepted: true, modelDownloadUrl: modelUrl(round.model_version_before), instructions: 'Begin local training' };
    },

    async leaveRound(req, ctx) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const clientId = clientIdOf(ctx);

      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');

      const participant = round.participants.find((p) => p.client_id === clientId);
      if (!participant || participant.status !== 'joined') {
        throw failedPrecondition('Client is not an active participant in this round');
      }

      participant.status = 'left';
      participant.left_at = new Date();
      participant.leave_reason = req.reason || null;
      await round.save();

      const remaining = joinedCount(round);
      publish('round_client_left', { round_id: round.round_id, client_id: clientId, reason: req.reason }, ADMIN_ROLES);

      return { success: true, remainingParticipants: remaining };
    },

    async getModelDownload(req) {
      let model;
      if (req.modelVersion != null) {
        model = await GlobalModel.findOne({ model_version: req.modelVersion });
      } else if (req.roundId != null) {
        const round = await Round.findOne({ round_id: req.roundId });
        if (round?.model_version_before != null) {
          model = await GlobalModel.findOne({ model_version: round.model_version_before });
        }
      } else {
        model = await GlobalModel.findOne({ is_active: true });
      }
      if (!model) throw notFound('Model not found');

      const { url, expiresAt } = signedUrl.sign(`/models/${model.model_version}`);
      return { downloadUrl: url, modelVersion: model.model_version, format: model.format, expiresAt: dateToIso(expiresAt) };
    },

    async submitUpdate(req, ctx) {
      const clientId = clientIdOf(ctx);
      if (!req.roundId || !req.deltaWeightsUrl) throw invalidArg('round_id and delta_weights_url are required');
      if (req.dataSize <= 0) throw invalidArg('data_size must be > 0');
      if (req.localLossBefore < 0 || req.localLossAfter < 0) throw invalidArg('local losses must be >= 0');

      const client = await loadClient(ctx);
      if (client.isBanned()) throw permissionDenied('Client is banned from participating');

      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (round.status !== 'active') throw failedPrecondition(`Round is ${round.status}, not accepting updates`);

      const participant = round.participants.find((p) => p.client_id === clientId && p.status === 'joined');
      if (!participant) throw permissionDenied('Client is not an active participant in this round');

      const config = await getActiveConfig();
      const labelDistribution = labelDistributionFromMessage(req.labelDistribution);
      const utility = computeUtilityScore({
        localLossBefore: req.localLossBefore,
        localLossAfter: req.localLossAfter,
        dataSize: req.dataSize,
        labelDistribution,
      });

      let status = 'accepted';
      let compressionRequired = false;
      let compressionLevel = 'none';
      let reason = null;
      if (utility < config.utility_threshold_low) {
        status = 'rejected';
        reason = `utility score ${utility} below minimum threshold ${config.utility_threshold_low}`;
      } else if (utility < config.utility_threshold_high) {
        status = 'compressed';
        compressionRequired = true;
        compressionLevel = 'partial';
      }

      const update = await Update.findOneAndUpdate(
        { round_id: req.roundId, client_id: clientId },
        {
          $set: {
            delta_weights_url: req.deltaWeightsUrl,
            local_loss_before: req.localLossBefore,
            local_loss_after: req.localLossAfter,
            label_distribution: labelDistribution,
            data_size: req.dataSize,
            training_time_ms: req.trainingTimeMs,
            status,
            utility_score: utility,
            compression_required: compressionRequired,
            compression_level: compressionLevel,
            reason,
            submitted_at: new Date(),
          },
          $setOnInsert: { update_id: newId(), round_id: req.roundId, client_id: clientId },
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Keep the client's running utility average current (over its most recent 200 scored updates).
      const recent = await Update.find({ client_id: clientId, utility_score: { $ne: null } })
        .sort({ submitted_at: -1 })
        .limit(200)
        .select('utility_score');
      if (recent.length) {
        const avg = recent.reduce((sum, u) => sum + u.utility_score, 0) / recent.length;
        await Client.updateOne({ client_id: clientId }, { utility_avg: Number(avg.toFixed(4)) });
      }

      publish('round_update_received', {
        round_id: req.roundId,
        update_id: update.update_id,
        client_id: clientId,
        utility_score: utility,
        status,
      }, ADMIN_ROLES);

      return { updateId: update.update_id, accepted: status !== 'rejected', compressionRequired };
    },

    async getUpdateStatus(req, ctx) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const update = await Update.findOne({ round_id: req.roundId, client_id: clientIdOf(ctx) });
      if (!update) throw notFound('No update found for this round');

      return {
        updateId: update.update_id,
        status: UPDATE_STATUS_TO_PROTO[update.status],
        utilityScore: num(update.utility_score),
        reason: update.reason ?? '',
      };
    },

    async *getSelfMetrics(req, ctx) {
      const updates = await Update.find({ client_id: clientIdOf(ctx) })
        .sort({ submitted_at: -1 })
        .limit(clampN(req.limit, 10, 100));

      for (const u of updates) {
        yield {
          roundId: u.round_id,
          utilityScore: num(u.utility_score),
          status: UPDATE_STATUS_TO_PROTO[u.status],
          lossImprovement: u.local_loss_before > 0 ? (u.local_loss_before - u.local_loss_after) / u.local_loss_before : 0,
        };
      }
    },

    async heartbeat(req, ctx) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const clientId = clientIdOf(ctx);

      // Targeted update by array index, guarded on client_id so it can never touch another participant
      // (participants are only ever appended, so indices are stable). Avoids a full-document save() racing
      // with other clients' heartbeats and the heartbeat watcher.
      const round = await Round.findOne({ round_id: req.roundId }).select('participants');
      const idx = round ? round.participants.findIndex((p) => p.client_id === clientId && p.status === 'joined') : -1;
      if (idx >= 0) {
        await Round.updateOne(
          { round_id: req.roundId, [`participants.${idx}.client_id`]: clientId },
          { $set: { [`participants.${idx}.last_heartbeat_at`]: new Date(), [`participants.${idx}.missed_heartbeats`]: 0 } }
        );
      }
      await Client.updateOne({ client_id: clientId }, { last_seen: new Date(), status: 'active' });

      return { ok: true, serverTime: new Date().toISOString() };
    },

    async getConfig() {
      const config = await getActiveConfig();
      return {
        mu: config.mu,
        localEpochs: config.local_epochs,
        batchSize: config.batch_size,
        compressionThreshold: config.utility_threshold_high,
      };
    },
  };
}

