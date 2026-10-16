import { Round } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { config as appConfig } from '../../config/index.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { computeUtilityScore } from '../../utils/utilityScore.js';
import { logEvent } from '../../utils/auditLog.js';
import { COMPRESSION_LEVEL_TO_PROTO, labelDistributionToMessage } from '../../utils/protoMappers.js';
import { getActiveConfig, num } from '../lib/helpers.js';
import { invalidArg, notFound, alreadyExists, failedPrecondition } from '../lib/errors.js';
import { publish, ADMIN_ROLES, ADMIN_AND_CLIENTS } from '../lib/events.js';

const START_TIME = Date.now();

/** Deactivate every model, then store `fields` as the new active one. */
async function activateNewModel(fields) {
  if (await GlobalModel.exists({ model_version: fields.model_version })) {
    throw alreadyExists(`Model version ${fields.model_version} already exists`);
  }
  await GlobalModel.updateMany({}, { is_active: false });
  return GlobalModel.create({ model_id: newId(), ...fields, is_active: true });
}

export function createFlBridgeService() {
  return {
    async triggerRound(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (!['active', 'aggregating'].includes(round.status)) {
        throw failedPrecondition(`Round is ${round.status}; cannot start aggregation`);
      }

      round.status = 'aggregating';
      await round.save();

      publish('round_aggregating', { round_id: req.roundId, accepted_updates: req.updateIds.length }, ADMIN_ROLES);
      await logEvent({ actor: 'fl-server', eventType: 'round.aggregation_triggered', details: { round_id: req.roundId } });

      // Heuristic estimate; the real FL server may ignore it.
      return { accepted: true, estimatedDurationMs: Math.max(5000, req.updateIds.length * 800) };
    },

    async completeRound(req) {
      if (!req.roundId || !req.modelUrl || req.newModelVersion <= 0) {
        throw invalidArg('round_id, new_model_version (> 0) and model_url are required');
      }
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (!['active', 'aggregating'].includes(round.status)) {
        throw failedPrecondition(`Round is already ${round.status}`);
      }

      const model = await activateNewModel({
        model_version: req.newModelVersion,
        round_id: req.roundId,
        weights_url: req.modelUrl,
        metrics: { global_loss: req.globalLoss, global_accuracy: req.globalAccuracy },
      });

      round.status = 'complete';
      round.model_version_after = req.newModelVersion;
      round.global_loss = req.globalLoss;
      round.global_accuracy = req.globalAccuracy;
      round.completed_at = new Date();
      await round.save();

      publish('round_completed', {
        round_id: req.roundId,
        model_version: req.newModelVersion,
        accuracy: req.globalAccuracy,
        loss: req.globalLoss,
      }, ADMIN_AND_CLIENTS);
      await logEvent({ actor: 'fl-server', eventType: 'round.completed', details: { round_id: req.roundId, new_model_version: req.newModelVersion } });

      return { success: true, nextRoundScheduled: false, modelId: model.model_id };
    },

    async *getRoundUpdates(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const updates = await Update.find({ round_id: req.roundId, status: { $in: ['accepted', 'compressed'] } });
      for (const u of updates) {
        yield {
          updateId: u.update_id,
          clientId: u.client_id,
          downloadUrl: signedUrl.sign(`/updates/${u.update_id}`).url,
          utilityScore: num(u.utility_score),
          labelDistribution: labelDistributionToMessage(u.label_distribution),
        };
      }
    },

    async pushModel(req) {
      if (req.modelVersion <= 0 || !req.weightsUrl) throw invalidArg('model_version (> 0) and weights_url are required');

      const model = await activateNewModel({
        model_version: req.modelVersion,
        round_id: req.roundId ?? null,
        weights_url: req.weightsUrl,
        metrics: {
          global_loss: req.metrics?.globalLoss ?? null,
          global_accuracy: req.metrics?.globalAccuracy ?? null,
        },
      });
      await logEvent({ actor: 'fl-server', eventType: 'model.pushed', details: { model_version: req.modelVersion } });

      return { stored: true, modelId: model.model_id };
    },

    async getFlStatus() {
      const lastRound = await Round.findOne().sort({ round_number: -1 });
      return {
        status: 'ok',
        version: appConfig.buildInfo.apiVersion,
        lastRoundId: lastRound?.round_id ?? '',
        uptimeMs: BigInt(Date.now() - START_TIME),
      };
    },

    async *computeUtility(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const [updates, config] = await Promise.all([
        Update.find({ round_id: req.roundId, update_id: { $in: req.updateIds } }),
        getActiveConfig(),
      ]);

      for (const u of updates) {
        const score = computeUtilityScore({
          localLossBefore: u.local_loss_before,
          localLossAfter: u.local_loss_after,
          dataSize: u.data_size,
          labelDistribution: u.label_distribution,
        });
        let level = 'none';
        if (score < config.utility_threshold_low) level = 'full';
        else if (score < config.utility_threshold_high) level = 'partial';

        yield { updateId: u.update_id, utilityScore: score, compressionLevel: COMPRESSION_LEVEL_TO_PROTO[level] };
      }
    },

    async getFlConfig() {
      const config = await getActiveConfig();
      return {
        mu: config.mu,
        utilityThresholdHigh: config.utility_threshold_high,
        utilityThresholdLow: config.utility_threshold_low,
        compressionRatio: config.compression_ratio,
        minClients: config.min_clients_per_round,
      };
    },
  };
}
