import { Round } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { Client } from '../../models/Client.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { config as appConfig } from '../../config/index.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { computeUtilityScore, utilityTier, utilityConfigToProto } from '../../utils/utilityScore.js';
import { logEvent } from '../../utils/auditLog.js';
import { COMPRESSION_LEVEL_TO_PROTO, ROUND_READY_REASON_TO_PROTO, FL_SERVER_STATE_FROM_PROTO, labelDistributionToMessage } from '../../utils/protoMappers.js';
import { FlServerStatus } from '../../models/FlServerStatus.js';
import { readyEventOf, usableUpdateIds } from '../roundScheduler.js';
import { configForRound, configForCurrentRound, num } from '../lib/helpers.js';
import { invalidArg, notFound, alreadyExists, failedPrecondition, throwIfDeadlineExceeded } from '../lib/errors.js';
import { publish, ADMIN_ROLES, ADMIN_AND_CLIENTS } from '../lib/events.js';
import { storage } from '../storage.js';

const START_TIME = Date.now();

const MB = 1024 * 1024;
const modelPath = (version) => `/models/${version}`;

async function storedModelFile(version, url) {
  const expected = modelPath(version);
  if (url !== expected) {
    throw invalidArg(`model_url must be ${expected}; upload the file with GetModelUploadUrl first`);
  }
  const file = await storage.digest(expected);
  if (!file) throw failedPrecondition(`The model file ${expected} has not been uploaded`);
  return file;
}

async function assertNewVersion(version) {
  if (await GlobalModel.exists({ model_version: version })) throw alreadyExists(`Model version ${version} already exists`);
  const latest = await GlobalModel.findOne().sort({ model_version: -1 }).select('model_version').lean();
  if (latest && version <= latest.model_version) {
    throw failedPrecondition(`Model version must be greater than the latest version ${latest.model_version}`);
  }
}

async function activateNewModel(fields) {
  await assertNewVersion(fields.model_version);
  await GlobalModel.updateMany({}, { is_active: false });
  return GlobalModel.create({ model_id: newId(), ...fields, is_active: true });
}

export function createFlBridgeService({ scheduler } = {}) {
  return {
    async triggerRound(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (round.status !== 'active') throw failedPrecondition(`Round is ${round.status}; aggregation can only start on an active round`);

      const usable = await usableUpdateIds(req.roundId);
      const requested = req.updateIds ?? [];
      const unknown = requested.filter((id) => !usable.includes(id));
      if (unknown.length) throw invalidArg(`update_ids contains updates that are not usable in this round: ${unknown.join(', ')}`);
      const chosen = requested.length ? requested : usable;

      const now = new Date();
      const updated = await Round.findOneAndUpdate(
        { round_id: req.roundId, status: 'active' },
        { $set: { status: 'aggregating', aggregating_started_at: now, aggregation_update_ids: chosen, ready_at: round.ready_at ?? now } },
        { returnDocument: 'after' }
      );
      if (!updated) throw failedPrecondition('Aggregation for this round was already started');

      publish('round_aggregating', { round_id: req.roundId, accepted_updates: chosen.length }, ADMIN_ROLES);
      await logEvent({ actor: 'fl-server', eventType: 'round.aggregation_triggered', details: { round_id: req.roundId, updates: chosen.length } });

      const { baseMs, perUpdateMs } = appConfig.aggregationEstimate;
      return { accepted: true, estimatedDurationMs: Math.max(baseMs, chosen.length * perUpdateMs) };
    },

    async completeRound(req) {
      if (!req.roundId || !req.modelUrl || req.newModelVersion <= 0) {
        throw invalidArg('round_id, new_model_version (> 0) and model_url are required');
      }
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (round.status !== 'aggregating') {
        throw failedPrecondition(`Round is ${round.status}; call TriggerRound before CompleteRound`);
      }

      const usable = await Update.find({ round_id: req.roundId, status: { $in: ['accepted', 'compressed'] } }).select('update_id').lean();
      const usableIds = new Set(usable.map((u) => u.update_id));
      const used = req.usedUpdateIds ?? [];
      const unknown = used.filter((id) => !usableIds.has(id));
      if (unknown.length) throw invalidArg(`used_update_ids contains updates that are not usable in this round: ${unknown.join(', ')}`);

      const file = await storedModelFile(req.newModelVersion, req.modelUrl);
      const claimed = await Round.findOneAndUpdate(
        { round_id: req.roundId, status: 'aggregating' },
        { $set: { status: 'complete', completed_at: new Date() }, $unset: { running: 1 } },
        { returnDocument: 'after' }
      );
      if (!claimed) throw failedPrecondition('This round was completed or failed while the model was being registered');

      let model;
      try {
        model = await activateNewModel({
          model_version: req.newModelVersion,
          size_bytes: file.bytes,
          sha256: file.sha256,
          round_id: req.roundId,
          weights_url: req.modelUrl,
          metrics: { global_loss: req.globalLoss, global_accuracy: req.globalAccuracy },
        });
      } catch (err) {
        await Round.updateOne({ round_id: req.roundId, status: 'complete' }, { $set: { status: 'aggregating', running: true, completed_at: null } });
        throw err;
      }

      await Round.updateOne(
        { round_id: req.roundId },
        { $set: { model_version_after: req.newModelVersion, global_loss: req.globalLoss, global_accuracy: req.globalAccuracy } }
      );

      if (used.length) {
        await Update.updateMany(
          { round_id: req.roundId, status: { $in: ['accepted', 'compressed'] }, update_id: { $nin: used } },
          { $set: { status: 'rejected', reason: 'not used in aggregation' } }
        );
      }
      const contributors = await Update.distinct('client_id', { round_id: req.roundId, status: { $in: ['accepted', 'compressed'] } });
      if (contributors.length) {
        await Client.updateMany({ client_id: { $in: contributors } }, { $inc: { rounds_participated: 1 } });
      }

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
          downloadUrl: signedUrl.sign(u.upload_path ?? `/updates/${u.update_id}`).url,
          utilityScore: num(u.utility_score),
          labelDistribution: labelDistributionToMessage(u.label_distribution),
          sha256: u.sha256 ?? '',
          bytes: BigInt(u.bytes_uploaded ?? 0),
          compressionRatio: num(u.compression_ratio),
          dataSize: u.data_size,
          compressionLevel: COMPRESSION_LEVEL_TO_PROTO[u.compression_level] ?? 0,
        };
      }
    },

    async pushModel(req) {
      if (req.modelVersion <= 0 || !req.weightsUrl) throw invalidArg('model_version (> 0) and weights_url are required');
      if (await Round.exists({ status: { $in: ['active', 'aggregating'] } })) {
        throw failedPrecondition('A round is running; the active model can only change through CompleteRound');
      }

      const file = await storedModelFile(req.modelVersion, req.weightsUrl);
      const model = await activateNewModel({
        model_version: req.modelVersion,
        size_bytes: file.bytes,
        sha256: file.sha256,
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
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      const [updates, config] = await Promise.all([
        Update.find({ round_id: req.roundId, update_id: { $in: req.updateIds } }),
        configForRound(round),
      ]);

      for (const u of updates) {
        const score = computeUtilityScore({
          localLossBefore: u.local_loss_before,
          localLossAfter: u.local_loss_after,
          dataSize: u.data_size,
          labelDistribution: u.label_distribution,
        }, config);
        const level = utilityTier(score, config).level ?? 'full';

        yield { updateId: u.update_id, utilityScore: num(score), compressionLevel: COMPRESSION_LEVEL_TO_PROTO[level] };
      }
    },

    async *watchRounds(req, ctx) {
      if (!scheduler) throw failedPrecondition('Round scheduler is not running on this server');
      const queue = [];
      let wake = null;
      const push = (event) => {
        queue.push(event);
        wake?.();
      };
      const unsubscribe = scheduler.onReady((event) => push({ ...event, reason: ROUND_READY_REASON_TO_PROTO[event.reason] }));
      const onAbort = () => wake?.();
      ctx.signal.addEventListener('abort', onAbort);

      try {
        const pending = await Round.find({ status: { $in: ['active', 'aggregating'] }, ready_at: { $ne: null } }).sort({ round_number: 1 });
        for (const r of pending) {
          const reason = r.status === 'aggregating' ? 'resumed' : r.ready_reason;
          yield { ...readyEventOf(r, reason), reason: ROUND_READY_REASON_TO_PROTO[reason] };
        }
        await logEvent({ actor: 'fl-server', eventType: 'fl.watch_started', details: { worker_id: req.workerId || null } });

        while (!ctx.signal.aborted) {
          if (queue.length === 0) {
            let timer;
            await new Promise((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, appConfig.scheduler.watchKeepaliveMs);
            });
            clearTimeout(timer);
            wake = null;
            if (ctx.signal.aborted) break;
            if (queue.length === 0) {
              yield { roundId: '', roundNumber: 0, reason: ROUND_READY_REASON_TO_PROTO.keepalive, updateCount: 0, modelVersionBefore: 0, readyAt: new Date().toISOString() };
              continue;
            }
          }
          yield queue.shift();
        }
        throwIfDeadlineExceeded(ctx.signal);
      } finally {
        unsubscribe();
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },

    async getModelUploadUrl(req) {
      if (!Number.isInteger(req.modelVersion) || req.modelVersion <= 0) throw invalidArg('model_version must be > 0');
      await assertNewVersion(req.modelVersion);
      const maxBytes = appConfig.limits.maxModelSizeMb * MB;
      const resourcePath = modelPath(req.modelVersion);
      if (await storage.remove(resourcePath)) {
        await logEvent({ level: 'warn', actor: 'fl-server', eventType: 'model.orphan_removed', details: { model_version: req.modelVersion } });
      }
      const signed = signedUrl.sign(resourcePath, { method: 'PUT', maxBytes, overwrite: false });
      return {
        upload: {
          url: signed.url,
          expiresAt: signed.expiresAt.toISOString(),
          refreshUntil: signed.refreshUntil.toISOString(),
          maxBytes: BigInt(maxBytes),
        },
        resourcePath,
      };
    },

    async reportFlStatus(req) {
      const workerId = (req.workerId ?? '').trim();
      if (!/^[A-Za-z0-9._:-]{1,64}$/.test(workerId)) throw invalidArg('worker_id must be 1-64 characters of letters, digits, . _ : -');
      const state = FL_SERVER_STATE_FROM_PROTO[req.state];
      if (!state) throw invalidArg('state must be one of STARTING, IDLE, AGGREGATING, ERROR');
      const clip = (v, n) => String(v ?? '').slice(0, n);
      const now = new Date();

      const previous = await FlServerStatus.findOneAndUpdate(
        { worker_id: workerId },
        {
          $set: {
            state,
            current_round_id: req.currentRoundId || null,
            version: clip(req.version, 64),
            message: clip(req.message, 500),
            last_error: clip(req.lastError, 2000),
            last_report_at: now,
          },
        },
        { upsert: true, returnDocument: 'before' }
      );
      if (!previous || previous.state !== state) {
        publish('fl_server_status', { worker_id: workerId, state, current_round_id: req.currentRoundId || null }, ADMIN_ROLES);
        await logEvent({
          level: state === 'error' ? 'error' : 'info',
          actor: 'fl-server',
          eventType: 'fl.status_changed',
          details: { worker_id: workerId, state, last_error: clip(req.lastError, 500) || null },
        });
      }
      return { accepted: true, serverTime: now.toISOString() };
    },

    async getFlConfig() {
      const config = await configForCurrentRound();
      return {
        mu: config.mu,
        utilityThresholdHigh: config.utility_threshold_high,
        utilityThresholdLow: config.utility_threshold_low,
        compressionRatio: config.ratio_medium,
        minClients: config.min_clients_per_round,
        utility: utilityConfigToProto(config),
        localEpochs: config.local_epochs,
        batchSize: config.batch_size,
        maxClients: config.max_clients_per_round,
      };
    },
  };
}
