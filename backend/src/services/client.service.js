import { Client } from '../../models/Client.js';
import { config as appConfig } from '../../config/index.js';
import { Round } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { computeUtilityScore, utilityTier, utilityConfigToProto } from '../../utils/utilityScore.js';
import { dateToIso, UPDATE_STATUS_TO_PROTO, COMPRESSION_LEVEL_TO_PROTO, stringMapToPlain, labelDistributionFromMessage } from '../../utils/protoMappers.js';
import { authOf, configForRound, configForCurrentRound, clampN, joinedCount, num } from '../lib/helpers.js';
import { invalidArg, notFound, permissionDenied, failedPrecondition } from '../lib/errors.js';
import { requireFinite, requireLabelDistribution } from '../lib/validate.js';
import { publish, ADMIN_ROLES } from '../lib/events.js';

const modelUrl = (version) => (version == null ? '' : signedUrl.sign(`/models/${version}`).url);

export function createClientService() {
  const clientIdOf = (ctx) => authOf(ctx).client_id;

  async function refreshUtilityAverage(clientId) {
    const recent = await Update.find({ client_id: clientId, utility_score: { $ne: null } })
      .sort({ prepared_at: -1 })
      .limit(appConfig.limits.utilityAvgWindow)
      .select('utility_score');
    if (recent.length) {
      const avg = recent.reduce((sum, u) => sum + u.utility_score, 0) / recent.length;
      await Client.updateOne({ client_id: clientId }, { utility_avg: Number(avg.toFixed(4)) });
    }
  }

  async function loadSubmittableRound(ctx, roundId) {
    const clientId = clientIdOf(ctx);
    const client = await loadClient(ctx);
    if (client.isBanned()) throw permissionDenied('Client is banned from participating');

    const round = await Round.findOne({ round_id: roundId });
    if (!round) throw notFound('Round not found');
    if (round.status !== 'active') throw failedPrecondition(`Round is ${round.status}, not accepting updates`);
    if (new Date() > round.deadline_at) throw failedPrecondition('Round deadline has passed, not accepting updates');

    const participant = round.participants.find((p) => p.client_id === clientId && p.status === 'joined');
    if (!participant) throw permissionDenied('Client is not an active participant in this round');
    return { round, participant };
  }

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
        status: client.isBanned() ? 'banned' : (client.status === 'banned' ? 'idle' : client.status),
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
      requireFinite(req.localDataSize, 'local_data_size', { min: 1 });

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

      const now = new Date();
      const joinable = {
        round_id: round.round_id,
        status: 'active',
        deadline_at: { $gt: now },
        $expr: {
          $lt: [
            { $size: { $filter: { input: '$participants', cond: { $eq: ['$$this.status', 'joined'] } } } },
            '$max_clients',
          ],
        },
      };
      const fields = {
        local_data_size: req.localDataSize,
        device_info: stringMapToPlain(req.deviceInfo),
        status: 'joined',
        joined_at: now,
        last_heartbeat_at: now,
        left_at: null,
        leave_reason: null,
        missed_heartbeats: 0,
      };

      const updated = existing
        ? await Round.findOneAndUpdate(
          { ...joinable, participants: { $elemMatch: { client_id: client.client_id, status: { $ne: 'joined' } } } },
          { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`participants.$[p].${k}`, v])) },
          { arrayFilters: [{ 'p.client_id': client.client_id }], returnDocument: 'after' }
        )
        : await Round.findOneAndUpdate(
          { ...joinable, 'participants.client_id': { $ne: client.client_id } },
          { $push: { participants: { client_id: client.client_id, ...fields } } },
          { returnDocument: 'after' }
        );

      if (!updated) {
        const fresh = await Round.findOne({ round_id: round.round_id });
        if (fresh?.participants.some((p) => p.client_id === client.client_id && p.status === 'joined')) {
          return { accepted: true, modelDownloadUrl: modelUrl(fresh.model_version_before), instructions: 'Already joined this round' };
        }
        if (!fresh || fresh.status !== 'active') {
          return { accepted: false, modelDownloadUrl: '', instructions: `Round is ${fresh?.status ?? 'gone'}, not accepting joins` };
        }
        if (new Date() > fresh.deadline_at) {
          return { accepted: false, modelDownloadUrl: '', instructions: 'Round deadline has passed' };
        }
        return { accepted: false, modelDownloadUrl: '', instructions: 'Round is at capacity (max_clients reached)' };
      }

      await Client.updateOne({ client_id: client.client_id }, { status: 'active', last_seen: now });

      publish('round_client_joined', {
        round_id: updated.round_id,
        client_id: client.client_id,
        participant_count: joinedCount(updated),
      }, ADMIN_ROLES);

      return { accepted: true, modelDownloadUrl: modelUrl(updated.model_version_before), instructions: 'Begin local training' };
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

    async prepareUpdate(req, ctx) {
      const clientId = clientIdOf(ctx);
      if (!req.roundId) throw invalidArg('round_id is required');
      requireFinite(req.dataSize, 'data_size', { min: 1 });
      requireFinite(req.localLossBefore, 'local_loss_before', { min: 0 });
      requireFinite(req.localLossAfter, 'local_loss_after', { min: 0 });
      requireFinite(req.trainingTimeMs, 'training_time_ms', { min: 0 });
      const labelDistribution = requireLabelDistribution(labelDistributionFromMessage(req.labelDistribution));

      const { round, participant } = await loadSubmittableRound(ctx, req.roundId);
      if (participant.local_data_size && req.dataSize > participant.local_data_size) {
        throw invalidArg(`data_size (${req.dataSize}) is larger than the local_data_size declared when joining (${participant.local_data_size})`);
      }

      const config = await configForRound(round);
      const utility = computeUtilityScore({
        localLossBefore: req.localLossBefore,
        localLossAfter: req.localLossAfter,
        dataSize: req.dataSize,
        labelDistribution,
      }, config);
      const tier = utilityTier(utility, config);
      const rejected = tier.status === 'rejected';
      const maxBytes = appConfig.limits.maxUpdateSizeMb * 1024 * 1024;
      const now = new Date();

      const update = await Update.findOneAndUpdate(
        { round_id: round.round_id, client_id: clientId },
        {
          $set: {
            local_loss_before: req.localLossBefore,
            local_loss_after: req.localLossAfter,
            label_distribution: labelDistribution,
            data_size: req.dataSize,
            training_time_ms: req.trainingTimeMs,
            status: rejected ? 'rejected' : 'prepared',
            planned_status: rejected ? null : tier.status,
            utility_score: utility,
            compression_level: tier.level,
            compression_required: tier.level === 'partial' || tier.level === 'full',
            compression_ratio: rejected ? null : tier.ratio,
            reason: tier.reason,
            max_bytes: rejected ? null : maxBytes,
            delta_weights_url: null,
            bytes_uploaded: null,
            sha256: null,
            prepared_at: now,
            uploaded_at: null,
            submitted_at: rejected ? now : null,
          },
          $setOnInsert: { update_id: newId(), round_id: round.round_id, client_id: clientId },
        },
        { upsert: true, returnDocument: 'after' }
      );

      if (rejected) {
        await refreshUtilityAverage(clientId);
        publish('round_update_received', {
          round_id: round.round_id, update_id: update.update_id, client_id: clientId, utility_score: utility, status: 'rejected',
        }, ADMIN_ROLES);
        return {
          updateId: update.update_id,
          accepted: false,
          utilityScore: num(utility),
          compressionLevel: 0,
          compressionRatio: 0,
          reason: tier.reason ?? '',
        };
      }

      const uploadPath = `/updates/${update.update_id}`;
      await Update.updateOne({ update_id: update.update_id }, { $set: { upload_path: uploadPath } });
      const signed = signedUrl.sign(uploadPath, { method: 'PUT', maxBytes, overwrite: true });

      return {
        updateId: update.update_id,
        accepted: true,
        utilityScore: num(utility),
        compressionLevel: COMPRESSION_LEVEL_TO_PROTO[tier.level],
        compressionRatio: tier.ratio,
        upload: {
          url: signed.url,
          expiresAt: dateToIso(signed.expiresAt),
          refreshUntil: dateToIso(signed.refreshUntil),
          maxBytes: BigInt(maxBytes),
        },
        reason: '',
      };
    },

    async submitUpdate(req, ctx) {
      const clientId = clientIdOf(ctx);
      if (!req.updateId) {
        throw invalidArg('update_id is required: call PrepareUpdate, upload the file to the returned URL, then SubmitUpdate');
      }
      if (!/^[0-9a-f]{64}$/.test(req.sha256 ?? '')) throw invalidArg('sha256 must be the 64-character hex digest of the uploaded file');

      const update = await Update.findOne({ update_id: req.updateId, client_id: clientId });
      if (!update) throw notFound('Update not found');
      if (req.roundId && req.roundId !== update.round_id) throw invalidArg('round_id does not match this update');

      const compressionRequired = update.compression_level === 'partial' || update.compression_level === 'full';
      if (['accepted', 'compressed'].includes(update.status)) {
        if (update.sha256 === req.sha256) return { updateId: update.update_id, accepted: true, compressionRequired };
        throw failedPrecondition('This update was already submitted with a different file; call PrepareUpdate to send a new one');
      }
      if (update.status === 'rejected') throw failedPrecondition(`This update was rejected: ${update.reason ?? 'no reason recorded'}`);
      if (update.status !== 'prepared') throw failedPrecondition(`Update is ${update.status}`);

      await loadSubmittableRound(ctx, update.round_id);

      if (update.bytes_uploaded === null || !update.sha256) {
        throw failedPrecondition('The file has not been fully uploaded yet; finish the upload, then call SubmitUpdate');
      }
      if (update.sha256 !== req.sha256) {
        throw failedPrecondition('sha256 does not match the uploaded file; upload the file again or send the correct digest');
      }
      if (update.max_bytes !== null && update.bytes_uploaded > update.max_bytes) {
        throw failedPrecondition('Uploaded file is larger than allowed');
      }

      const submitted = await Update.findOneAndUpdate(
        { update_id: update.update_id, status: 'prepared', sha256: req.sha256 },
        { $set: { status: update.planned_status, delta_weights_url: update.upload_path, submitted_at: new Date() } },
        { returnDocument: 'after' }
      );
      if (!submitted) throw failedPrecondition('The update changed while submitting; check GetUpdateStatus and try again');

      await refreshUtilityAverage(clientId);
      publish('round_update_received', {
        round_id: submitted.round_id,
        update_id: submitted.update_id,
        client_id: clientId,
        utility_score: submitted.utility_score,
        status: submitted.status,
        bytes: submitted.bytes_uploaded,
      }, ADMIN_ROLES);

      return { updateId: submitted.update_id, accepted: true, compressionRequired };
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
        .sort({ prepared_at: -1 })
        .limit(clampN(req.limit, appConfig.limits.selfMetricsLimitDefault, appConfig.limits.selfMetricsLimitMax));

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
      const client = await loadClient(ctx);
      if (client.isBanned()) throw permissionDenied('Client is banned from participating');

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
      const config = await configForCurrentRound();
      return {
        mu: config.mu,
        localEpochs: config.local_epochs,
        batchSize: config.batch_size,
        compressionThreshold: config.utility_threshold_high,
        utility: utilityConfigToProto(config),
      };
    },
  };
}

