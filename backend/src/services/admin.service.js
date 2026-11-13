import { Client } from '../../models/Client.js';
import { Round, RUNNING_STATUSES } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { AdminUser } from '../../models/AdminUser.js';
import { AuditLog } from '../../models/AuditLog.js';
import { SystemConfig, ConfigHistory } from '../../models/SystemConfig.js';
import { createSessionStore } from '../lib/sessions.js';
import { storage } from '../storage.js';
import { config as appConfig } from '../../config/index.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { labelEntropy, utilityConfigToProto } from '../../utils/utilityScore.js';
import { logEvent } from '../../utils/auditLog.js';
import {
  ROLE_TO_PROTO,
  ROLE_FROM_PROTO,
  ROUND_STATUS_TO_PROTO,
  UPDATE_STATUS_TO_PROTO,
  COMPRESSION_LEVEL_TO_PROTO,
  FL_SERVER_STATE_TO_PROTO,
  dateToIso,
} from '../../utils/protoMappers.js';
import { authOf, getActiveConfig, configForRound, clampN, parseDate, num, joinedCount, giniCoefficient } from '../lib/helpers.js';
import { invalidArg, notFound, failedPrecondition } from '../lib/errors.js';
import { latestFlStatus } from '../lib/flStatus.js';
import { EnrollmentToken } from '../../models/EnrollmentToken.js';
import { newEnrollmentToken, hashToken, isActive } from '../lib/enrollment.js';
import { requireFinite } from '../lib/validate.js';
import { publish, ADMIN_ROLES, ADMIN_AND_CLIENTS } from '../lib/events.js';

const CLIENT_SORT_FIELDS = ['created_at', 'name', 'last_seen', 'rounds_participated', 'utility_avg', 'status'];
const ASSIGNABLE_ROLES = ['admin', 'fl_engineer', 'viewer'];

const displayStatus = (c) => {
  if (c.isBanned()) return 'banned';
  return c.status === 'banned' ? 'idle' : c.status;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pageArgs = (req) => {
  const limit = clampN(req.limit, appConfig.limits.pageSizeDefault, appConfig.limits.pageSizeMax);
  const page = Math.max(1, req.page || 1);
  return { limit, skip: (page - 1) * limit };
};
const metricsRounds = (req) => clampN(req.lastNRounds, appConfig.limits.metricsRoundsDefault, appConfig.limits.metricsRoundsMax);

async function clientNames(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const docs = await Client.find({ client_id: { $in: unique } }).select('client_id name').lean();
  return new Map(docs.map((d) => [d.client_id, d.name]));
}

export function createAdminService({ redis }) {
  const sessions = createSessionStore(redis);

  async function removeFromRunningRounds(clientId, reason) {
    const rounds = await Round.find({
      status: { $in: RUNNING_STATUSES },
      participants: { $elemMatch: { client_id: clientId, status: 'joined' } },
    }).select('round_id');
    const now = new Date();
    for (const r of rounds) {
      await Round.updateOne(
        { round_id: r.round_id },
        { $set: { 'participants.$[p].status': 'left', 'participants.$[p].left_at': now, 'participants.$[p].leave_reason': reason } },
        { arrayFilters: [{ 'p.client_id': clientId, 'p.status': 'joined' }] }
      );
      publish('round_client_left', { round_id: r.round_id, client_id: clientId, reason }, ADMIN_ROLES);
    }
  }

  return {
    // ───────────── Clients ─────────────
    async getOverview() {
      const [totalClients, activeClients, bannedClients, activeRound, latestModel, completedRounds] = await Promise.all([
        Client.countDocuments({}),
        Client.countDocuments({ status: 'active' }),
        Client.countDocuments({ $or: [{ banned_until: new Date(0) }, { banned_until: { $gt: new Date() } }] }),
        Round.findOne({ status: { $in: ['active', 'aggregating'] } }).sort({ round_number: -1 }),
        GlobalModel.findOne({ is_active: true }),
        Round.countDocuments({ status: 'complete' }),
      ]);
      const roundUpdates = activeRound
        ? await Update.countDocuments({ round_id: activeRound.round_id, status: { $in: ['accepted', 'compressed'] } })
        : 0;
      const metric = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      return {
        totalClients,
        activeClients,
        bannedClients,
        completedRounds,
        currentRoundId: activeRound?.round_id ?? '',
        currentRoundStatus: activeRound?.status ?? '',
        currentRoundNumber: activeRound?.round_number ?? 0,
        currentRoundParticipants: activeRound ? joinedCount(activeRound) : 0,
        currentRoundMaxClients: activeRound?.max_clients ?? 0,
        currentRoundUpdates: roundUpdates,
        currentRoundStartedAt: dateToIso(activeRound?.started_at),
        currentRoundDeadline: dateToIso(activeRound?.deadline_at),
        currentRoundReadyAt: dateToIso(activeRound?.ready_at),
        latestModelVersion: latestModel?.model_version ?? 0,
        latestModelAccuracy: metric(latestModel?.metrics?.global_accuracy),
        latestModelLoss: metric(latestModel?.metrics?.global_loss),
        health: 'ok',
      };
    },

    async *listClients(req) {
      const { limit, skip } = pageArgs(req);
      const sortBy = CLIENT_SORT_FIELDS.includes(req.sortBy) ? req.sortBy : 'created_at';
      const filter = {};
      if (req.status === 'banned') filter.$or = [{ banned_until: new Date(0) }, { banned_until: { $gt: new Date() } }];
      else if (req.status) filter.status = req.status;

      const clients = await Client.find(filter).sort({ [sortBy]: -1 }).skip(skip).limit(limit);
      for (const c of clients) {
        yield {
          clientId: c.client_id,
          name: c.name,
          status: displayStatus(c),
          lastSeen: dateToIso(c.last_seen),
          roundsParticipated: c.rounds_participated,
          utilityAvg: num(c.utility_avg),
        };
      }
    },

    async getClientDetail(req) {
      if (!req.clientId) throw invalidArg('client_id is required');
      const client = await Client.findOne({ client_id: req.clientId });
      if (!client) throw notFound('Client not found');

      const live = await getActiveConfig();
      const updates = await Update.find({ client_id: client.client_id }).sort({ prepared_at: -1 }).limit(appConfig.limits.clientHistoryLimit);
      return {
        clientId: client.client_id,
        name: client.name,
        history: updates.map((u) => ({ roundId: u.round_id, status: u.status, submittedAt: dateToIso(u.submitted_at) })),
        utilityScores: updates.map((u) => ({ roundId: u.round_id, score: num(u.utility_score) })),
        labelEntropyAvg: Number(mean(updates.map((u) => labelEntropy(u.label_distribution, live.num_classes))).toFixed(4)),
      };
    },

    async banClient(req, ctx) {
      if (!req.clientId) throw invalidArg('client_id is required');
      if (req.durationHours < 0) throw invalidArg('duration_hours must be >= 0 (0 = permanent)');
      const client = await Client.findOne({ client_id: req.clientId });
      if (!client) throw notFound('Client not found');

      const permanent = req.durationHours === 0;
      client.banned_until = permanent ? new Date(0) : new Date(Date.now() + req.durationHours * 3600 * 1000);
      client.ban_reason = req.reason || null;
      client.status = 'banned';
      await client.save();

      // Void this client's updates in any running round.
      const running = await Round.find({ status: { $in: ['active', 'aggregating'] } }).select('round_id');
      if (running.length) {
        await Update.updateMany(
          { round_id: { $in: running.map((r) => r.round_id) }, client_id: client.client_id },
          { status: 'rejected', reason: 'client banned' }
        );
      }
      await removeFromRunningRounds(client.client_id, 'client banned');
      await sessions.endAll(client.client_id);

      await logEvent({
        actor: authOf(ctx).sub,
        eventType: 'client.banned',
        details: { client_id: client.client_id, reason: req.reason, duration_hours: req.durationHours },
      });
      publish('client_banned', { client_id: client.client_id, banned_until: permanent ? null : dateToIso(client.banned_until) }, ADMIN_ROLES);

      // banned_until is "" for a permanent ban.
      return { success: true, bannedUntil: permanent ? '' : dateToIso(client.banned_until) };
    },

    async unbanClient(req, ctx) {
      if (!req.clientId) throw invalidArg('client_id is required');
      const client = await Client.findOne({ client_id: req.clientId });
      if (!client) throw notFound('Client not found');

      client.banned_until = null;
      client.ban_reason = null;
      client.status = 'idle';
      await client.save();
      await logEvent({ actor: authOf(ctx).sub, eventType: 'client.unbanned', details: { client_id: client.client_id } });

      return { success: true, clientStatus: client.status };
    },

    async deleteClient(req, ctx) {
      if (!req.clientId) throw invalidArg('client_id is required');
      const client = await Client.findOne({ client_id: req.clientId });
      if (!client) throw notFound('Client not found');

      await removeFromRunningRounds(client.client_id, 'client deleted');
      await sessions.endAll(client.client_id);
      const result = await Update.deleteMany({ client_id: client.client_id });
      await client.deleteOne();
      await logEvent({ actor: authOf(ctx).sub, eventType: 'client.deleted', details: { client_id: req.clientId } });

      return { deleted: true, purgedRecords: result.deletedCount };
    },

    // ───────────── Rounds ─────────────
    async *listRounds(req) {
      const { limit, skip } = pageArgs(req);
      const filter = {};
      if (req.status) {
        if (!(req.status in ROUND_STATUS_TO_PROTO)) throw invalidArg(`unknown round status '${req.status}'`);
        filter.status = req.status;
      }

      const rounds = await Round.find(filter).sort({ round_number: -1 }).skip(skip).limit(limit);
      const counts = await Update.aggregate([
        { $match: { round_id: { $in: rounds.map((r) => r.round_id) }, status: { $in: ['accepted', 'compressed'] } } },
        { $group: { _id: '$round_id', n: { $sum: 1 } } },
      ]);
      const usable = new Map(counts.map((c) => [c._id, c.n]));
      for (const r of rounds) {
        yield {
          roundId: r.round_id,
          roundNumber: r.round_number,
          status: ROUND_STATUS_TO_PROTO[r.status],
          participantCount: joinedCount(r),
          accuracy: num(r.global_accuracy),
          globalLoss: typeof r.global_loss === 'number' ? r.global_loss : undefined,
          startedAt: dateToIso(r.started_at),
          completedAt: dateToIso(r.completed_at),
          maxClients: r.max_clients,
          usableUpdates: usable.get(r.round_id) ?? 0,
          modelVersionAfter: r.model_version_after ?? 0,
          endReason: r.failed_reason ?? r.aborted_reason ?? '',
          notes: r.notes ?? '',
        };
      }
    },

    async getRoundDetail(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      const updates = await Update.find({ round_id: round.round_id });

      const names = await clientNames(round.participants.map((p) => p.client_id));
      const snap = round.config_snapshot ?? {};
      const snapNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return {
        roundId: round.round_id,
        roundNumber: round.round_number,
        updates: updates.map((u) => ({ updateId: u.update_id, clientId: u.client_id, status: UPDATE_STATUS_TO_PROTO[u.status] })),
        utilityScores: updates.map((u) => ({ clientId: u.client_id, score: num(u.utility_score) })),
        globalLoss: num(round.global_loss),
        globalAccuracy: num(round.global_accuracy),
        startedAt: dateToIso(round.started_at),
        completedAt: dateToIso(round.completed_at),
        status: ROUND_STATUS_TO_PROTO[round.status],
        maxClients: round.max_clients,
        minClients: round.min_clients,
        deadline: dateToIso(round.deadline_at),
        notes: round.notes ?? '',
        readyAt: dateToIso(round.ready_at),
        readyReason: round.ready_reason ?? '',
        aggregatingStartedAt: dateToIso(round.aggregating_started_at),
        modelVersionBefore: round.model_version_before ?? 0,
        modelVersionAfter: round.model_version_after ?? 0,
        endReason: round.failed_reason ?? round.aborted_reason ?? '',
        participants: round.participants.map((p) => ({
          clientId: p.client_id,
          clientName: names.get(p.client_id) ?? '',
          status: p.status,
          joinedAt: dateToIso(p.joined_at),
          leftAt: dateToIso(p.left_at),
          leaveReason: p.leave_reason ?? '',
          localDataSize: p.local_data_size ?? 0,
        })),
        config: {
          mu: snapNum(snap.mu),
          localEpochs: snapNum(snap.local_epochs),
          batchSize: snapNum(snap.batch_size),
          utilityThresholdHigh: snapNum(snap.utility_threshold_high),
          utilityThresholdLow: snapNum(snap.utility_threshold_low),
          minClientsPerRound: snapNum(snap.min_clients_per_round),
        },
      };
    },

    async startRound(req, ctx) {
      const config = await getActiveConfig();
      // 0 (proto default) means "use the configured default".
      const maxClients = req.maxClients || config.max_clients_per_round;
      const deadlineSeconds = req.deadlineSeconds || config.max_round_duration_seconds;
      if (maxClients < 0 || deadlineSeconds < 0) throw invalidArg('max_clients and deadline_seconds must be positive');
      if ((req.notes ?? '').length > 500) throw invalidArg('notes must be at most 500 characters');
      if (maxClients < config.min_clients_per_round) {
        throw invalidArg(`max_clients (${maxClients}) is below min_clients_per_round (${config.min_clients_per_round})`);
      }

      const active = await Round.findOne({ status: { $in: ['active', 'aggregating'] } });
      if (active) throw failedPrecondition(`A round is already running (round_id=${active.round_id})`);

      const [latestModel, lastRound] = await Promise.all([
        GlobalModel.findOne({ is_active: true }),
        Round.findOne().sort({ round_number: -1 }),
      ]);

      let round;
      try {
        round = await Round.create({
          round_id: newId(),
          round_number: (lastRound?.round_number || 0) + 1,
          running: true,
          status: 'active',
          max_clients: maxClients,
          min_clients: config.min_clients_per_round,
          deadline_seconds: deadlineSeconds,
          deadline_at: new Date(Date.now() + deadlineSeconds * 1000),
          notes: req.notes,
          config_snapshot: config.toObject(),
          model_version_before: latestModel?.model_version ?? null,
        });
      } catch (err) {
        if (err?.code === 11000) throw failedPrecondition('Another round was started at the same time; only one round can run');
        throw err;
      }

      await logEvent({ actor: authOf(ctx).sub, eventType: 'round.started', details: { round_id: round.round_id } });
      publish('round_started', {
        round_id: round.round_id,
        round_number: round.round_number,
        max_clients: maxClients,
        deadline: dateToIso(round.deadline_at),
      }, ADMIN_AND_CLIENTS);

      return { roundId: round.round_id, roundNumber: round.round_number, startedAt: dateToIso(round.started_at) };
    },

    async stopRound(req, ctx) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      if (!['active', 'aggregating'].includes(round.status)) throw failedPrecondition(`Round is already ${round.status}`);
      const reason = String(req.reason ?? '').trim().slice(0, 500) || null;

      const stopped = await Round.findOneAndUpdate(
        { round_id: round.round_id, status: { $in: ['active', 'aggregating'] } },
        { $set: { status: 'aborted', aborted_reason: reason, completed_at: new Date() }, $unset: { running: 1 } },
        { returnDocument: 'after' }
      );
      if (!stopped) throw failedPrecondition('The round finished while it was being stopped');
      Object.assign(round, { status: stopped.status });
      await Update.updateMany(
        { round_id: round.round_id, status: { $in: ['pending', 'prepared', 'accepted', 'compressed'] } },
        { status: 'rejected', reason: 'round aborted' }
      );

      publish('round_aborted', { round_id: round.round_id, reason }, ADMIN_AND_CLIENTS);
      await logEvent({ actor: authOf(ctx).sub, eventType: 'round.aborted', details: { round_id: round.round_id, reason } });

      return { success: true, roundStatus: ROUND_STATUS_TO_PROTO[round.status] };
    },

    async *listRoundUpdates(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const updates = await Update.find({ round_id: req.roundId }).sort({ prepared_at: 1 });
      const names = await clientNames(updates.map((u) => u.client_id));
      for (const u of updates) {
        yield {
          updateId: u.update_id,
          clientId: u.client_id,
          clientName: names.get(u.client_id) ?? '',
          utilityScore: num(u.utility_score),
          status: UPDATE_STATUS_TO_PROTO[u.status],
          stage: u.status === 'prepared' && u.uploaded_at ? 'uploaded' : u.status,
          compressionLevel: COMPRESSION_LEVEL_TO_PROTO[u.compression_level] ?? 0,
          compressionRatio: num(u.compression_ratio),
          submittedAt: dateToIso(u.submitted_at),
          preparedAt: dateToIso(u.prepared_at),
          reason: u.status === 'rejected' ? (u.reason ?? '') : '',
          bytes: BigInt(u.bytes_uploaded ?? 0),
          dataSize: u.data_size ?? 0,
          localLossBefore: num(u.local_loss_before),
          localLossAfter: num(u.local_loss_after),
          trainingTimeMs: u.training_time_ms ?? 0,
        };
      }
    },

    // ───────────── Metrics ─────────────
    async *getConvergenceMetrics(req) {
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(metricsRounds(req));
      const ordered = rounds.reverse();
      for (let i = 0; i < ordered.length; i += 1) {
        const r = ordered[i];
        const prev = ordered[i - 1];
        const point = { roundNumber: r.round_number, globalLoss: num(r.global_loss), globalAccuracy: num(r.global_accuracy) };
        if (prev && prev.global_loss != null && r.global_loss != null) {
          point.deltaLoss = Number((r.global_loss - prev.global_loss).toFixed(4));
        }
        yield point;
      }
    },

    async *getClientMetrics(req) {
      const n = metricsRounds(req);
      const filter = req.clientId ? { client_id: req.clientId } : {};
      const updates = await Update.find(filter).sort({ prepared_at: -1 }).limit(req.clientId ? n : n * appConfig.limits.clientMetricsScanFactor);

      const byClient = new Map();
      for (const u of updates) {
        if (!byClient.has(u.client_id)) byClient.set(u.client_id, []);
        byClient.get(u.client_id).push({ roundId: u.round_id, score: num(u.utility_score) });
      }
      for (const [clientId, scores] of byClient) {
        yield { clientId, roundScores: scores, avgUtility: Number(mean(scores.map((s) => s.score)).toFixed(4)) };
      }
    },

    async *getCommunicationMetrics(req) {
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(metricsRounds(req));
      for (const r of rounds.reverse()) {
        const updates = await Update.find({ round_id: r.round_id });
        const uploaded = updates.filter((u) => u.bytes_uploaded !== null && u.delta_weights_url !== null);
        const received = uploaded.reduce((s, u) => s + u.bytes_uploaded, 0);
        const base = r.model_version_before == null ? null : await GlobalModel.findOne({ model_version: r.model_version_before }).select('size_bytes').lean();
        const dense = base?.size_bytes ?? 0;
        const saved = dense > 0 ? uploaded.reduce((s, u) => s + Math.max(0, dense - u.bytes_uploaded), 0) : 0;
        yield {
          roundNumber: r.round_number,
          bytesReceived: BigInt(received),
          bytesMeasured: BigInt(received),
          bytesSaved: BigInt(saved),
          fullCount: uploaded.filter((u) => u.compression_level === 'none').length,
          compressedCount: uploaded.filter((u) => u.compression_level === 'partial' || u.compression_level === 'full').length,
          skippedCount: updates.filter((u) => u.status === 'rejected').length,
        };
      }
    },

    async *getFairnessMetrics(req) {
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(metricsRounds(req));
      for (const r of rounds.reverse()) {
        const scored = (await Update.find({ round_id: r.round_id, utility_score: { $ne: null } }).select('utility_score').lean()).map((u) => u.utility_score);
        const scores = scored.map(num);
        const { utility_threshold_low: lowCut } = await configForRound(r);
        yield {
          roundNumber: r.round_number,
          minorityParticipationRate: scores.length ? Number((scores.filter((s) => s < lowCut).length / scores.length).toFixed(4)) : 0,
          giniCoefficient: giniCoefficient(scores),
          utilityDistribution: scores,
        };
      }
    },

    // ───────────── Config ─────────────
    async getConfig() {
      return toConfigResponse(await getActiveConfig());
    },

    async updateConfig(req, ctx) {
      const fields = {
        mu: req.mu,
        minClientsPerRound: req.minClientsPerRound,
        maxClientsPerRound: req.maxClientsPerRound,
        maxRoundDurationSeconds: req.maxRoundDurationSeconds,
        utilityThresholdHigh: req.utilityThresholdHigh,
        utilityThresholdLow: req.utilityThresholdLow,
        compressionRatio: req.compressionRatio,
        localEpochs: req.localEpochs,
        batchSize: req.batchSize,
      };
      const column = {
        mu: 'mu',
        minClientsPerRound: 'min_clients_per_round',
        maxClientsPerRound: 'max_clients_per_round',
        maxRoundDurationSeconds: 'max_round_duration_seconds',
        utilityThresholdHigh: 'utility_threshold_high',
        utilityThresholdLow: 'utility_threshold_low',
        compressionRatio: 'ratio_medium',
        localEpochs: 'local_epochs',
        batchSize: 'batch_size',
      };
      const utilityColumn = {
        weightQuality: 'weight_quality',
        weightSize: 'weight_size',
        weightDiversity: 'weight_diversity',
        sizeSaturation: 'size_saturation',
        numClasses: 'num_classes',
        temperature: 'temperature',
        ratioHigh: 'ratio_high',
        ratioMedium: 'ratio_medium',
        ratioLow: 'ratio_low',
        rejectBelow: 'reject_below',
      };

      const diff = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        requireFinite(v, column[k]);
        diff[column[k]] = v;
      }
      for (const [k, col] of Object.entries(utilityColumn)) {
        const v = req.utility?.[k];
        if (v === undefined) continue;
        requireFinite(v, col);
        if (col === 'ratio_medium' && diff.ratio_medium !== undefined && diff.ratio_medium !== v) {
          throw invalidArg('compression_ratio and utility.ratio_medium are the same setting; send only one');
        }
        diff[col] = v;
      }
      if (diff.ratio_medium !== undefined) diff.compression_ratio = diff.ratio_medium;
      if (Object.keys(diff).length === 0) throw invalidArg('No config fields supplied');

      const current = (await getActiveConfig()).toObject();
      const merged = { ...current, ...diff };
      if (merged.mu < 0) throw invalidArg('mu must be >= 0');
      if (merged.min_clients_per_round < 1) throw invalidArg('min_clients_per_round must be >= 1');
      if (merged.max_clients_per_round < merged.min_clients_per_round) throw invalidArg('max_clients_per_round must be >= min_clients_per_round');
      if (merged.max_round_duration_seconds < 1) throw invalidArg('max_round_duration_seconds must be >= 1');
      if (merged.local_epochs < 1 || merged.batch_size < 1) throw invalidArg('local_epochs and batch_size must be >= 1');
      for (const key of ['utility_threshold_high', 'utility_threshold_low']) {
        if (merged[key] < 0 || merged[key] > 1) throw invalidArg(`${key} must be within [0, 1]`);
      }
      if (merged.utility_threshold_low > merged.utility_threshold_high) throw invalidArg('utility_threshold_low must be <= utility_threshold_high');
      for (const key of ['weight_quality', 'weight_size', 'weight_diversity']) {
        if (merged[key] < 0) throw invalidArg(`${key} must be >= 0`);
      }
      if (merged.weight_quality + merged.weight_size + merged.weight_diversity <= 0) {
        throw invalidArg('at least one of weight_quality, weight_size and weight_diversity must be > 0');
      }
      if (merged.size_saturation <= 0) throw invalidArg('size_saturation must be > 0');
      if (!Number.isInteger(merged.num_classes) || merged.num_classes < 2) throw invalidArg('num_classes must be an integer >= 2');
      if (merged.temperature <= 0) throw invalidArg('temperature must be > 0');
      for (const key of ['ratio_high', 'ratio_medium', 'ratio_low']) {
        if (merged[key] <= 0 || merged[key] > 1) throw invalidArg(`${key} must be within (0, 1]`);
      }
      if (!(merged.ratio_high >= merged.ratio_medium && merged.ratio_medium >= merged.ratio_low)) {
        throw invalidArg('ratios must satisfy ratio_high >= ratio_medium >= ratio_low');
      }
      if (merged.reject_below < 0 || merged.reject_below > merged.utility_threshold_low) {
        throw invalidArg('reject_below must be within [0, utility_threshold_low]');
      }

      const actor = authOf(ctx).sub;
      const updated = await SystemConfig.findOneAndUpdate(
        { singleton_key: 'active_config' },
        { $set: { ...diff, updated_by: actor } },
        { returnDocument: 'after', upsert: true }
      );

      // A running round keeps its config_snapshot, so changes apply from the next round.
      const lastRound = await Round.findOne().sort({ round_number: -1 });
      const effectiveFrom = (lastRound?.round_number || 0) + 1;
      await ConfigHistory.create({ changed_by: actor, diff, round_number_applied: effectiveFrom });
      await logEvent({ actor, eventType: 'config.updated', details: diff });
      publish('config_updated', diff, ADMIN_ROLES);

      return { updatedConfig: toConfigResponse(updated), effectiveFromRound: effectiveFrom };
    },

    async *getConfigHistory() {
      const history = await ConfigHistory.find().sort({ changed_at: -1 }).limit(appConfig.limits.configHistoryLimit);
      for (const h of history) {
        yield {
          changedAt: dateToIso(h.changed_at),
          changedBy: h.changed_by,
          diffJson: JSON.stringify(h.diff ?? {}),
          roundNumberApplied: h.round_number_applied ?? 0,
        };
      }
    },

    // ───────────── Models ─────────────
    async *listModels() {
      const models = await GlobalModel.find().sort({ model_version: -1 });
      for (const m of models) {
        yield {
          modelId: m.model_id,
          modelVersion: m.model_version,
          roundId: m.round_id ?? '',
          accuracy: num(m.metrics?.global_accuracy),
          sizeBytes: BigInt(m.size_bytes || 0),
          createdAt: dateToIso(m.created_at),
          format: m.format ?? '',
          sha256: m.sha256 ?? '',
        };
      }
    },

    async getModelDownload(req) {
      if (!req.modelId) throw invalidArg('model_id is required');
      const model = await GlobalModel.findOne({ model_id: req.modelId });
      if (!model) throw notFound('Model not found');

      const { url, expiresAt } = signedUrl.sign(`/models/${model.model_version}`);
      return { downloadUrl: url, expiresAt: dateToIso(expiresAt), modelVersion: model.model_version };
    },

    async deleteModel(req, ctx) {
      if (!req.modelId) throw invalidArg('model_id is required');
      const model = await GlobalModel.findOne({ model_id: req.modelId });
      if (!model) throw notFound('Model not found');
      if (model.is_active) throw failedPrecondition('Cannot delete the currently active model');

      await model.deleteOne();
      await storage.remove(`/models/${model.model_version}`);
      await logEvent({ actor: authOf(ctx).sub, eventType: 'model.deleted', details: { model_id: req.modelId } });
      return { deleted: true };
    },

    // ───────────── Logs & users ─────────────
    async *getLogs(req) {
      const filter = {};
      if (req.level) filter.level = req.level;
      if (req.actor) filter.actor = req.actor;
      if (req.eventType) filter.event_type = req.eventType;
      const from = parseDate(req.fromDate, 'from_date');
      const to = parseDate(req.toDate, 'to_date');
      if (from || to) filter.timestamp = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

      const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(clampN(req.limit, appConfig.limits.logsLimitDefault, appConfig.limits.logsLimitMax));
      for (const l of logs) {
        yield {
          timestamp: dateToIso(l.timestamp),
          level: l.level,
          actor: l.actor,
          eventType: l.event_type,
          detailsJson: JSON.stringify(l.details ?? {}),
        };
      }
    },

    async *listUsers() {
      const users = await AdminUser.find().sort({ created_at: 1 });
      for (const u of users) {
        yield {
          userId: u.user_id,
          name: u.name,
          email: u.email,
          role: ROLE_TO_PROTO[u.role],
          createdAt: dateToIso(u.created_at),
          lastLogin: dateToIso(u.last_login),
        };
      }
    },

    async updateUserRole(req, ctx) {
      const role = ROLE_FROM_PROTO[req.role];
      if (!ASSIGNABLE_ROLES.includes(role)) throw invalidArg(`role must be one of ${ASSIGNABLE_ROLES.join(', ')}`);
      const user = await AdminUser.findOne({ user_id: req.userId });
      if (!user) throw notFound('User not found');

      if (user.role === 'super_admin' && (await AdminUser.countDocuments({ role: 'super_admin' })) <= 1) {
        throw failedPrecondition('Cannot demote the last Super Admin');
      }

      user.role = role;
      await user.save();
      await logEvent({ actor: authOf(ctx).sub, eventType: 'admin.role_changed', details: { user_id: user.user_id, new_role: role } });

      return { userId: user.user_id, newRole: ROLE_TO_PROTO[user.role] };
    },

    async createEnrollmentToken(req, ctx) {
      const label = (req.label ?? '').trim();
      if (label.length > 100) throw invalidArg('label must be at most 100 characters');
      const maxUses = req.maxUses || 1;
      const ttlHours = req.ttlHours || appConfig.enrollment.defaultTtlHours;
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > appConfig.enrollment.maxUses) {
        throw invalidArg(`max_uses must be between 1 and ${appConfig.enrollment.maxUses}`);
      }
      if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > appConfig.enrollment.maxTtlHours) {
        throw invalidArg(`ttl_hours must be between 1 and ${appConfig.enrollment.maxTtlHours}`);
      }

      const actor = authOf(ctx).sub;
      const token = newEnrollmentToken();
      const doc = await EnrollmentToken.create({
        token_id: newId(),
        token_hash: hashToken(token),
        label,
        max_uses: maxUses,
        expires_at: new Date(Date.now() + ttlHours * 3600 * 1000),
        created_by: actor,
      });
      await logEvent({ actor, eventType: 'enrollment.token_created', details: { token_id: doc.token_id, label, max_uses: maxUses, ttl_hours: ttlHours } });
      return { tokenId: doc.token_id, token, label, maxUses, expiresAt: dateToIso(doc.expires_at) };
    },

    async *listEnrollmentTokens(req) {
      const now = new Date();
      const docs = await EnrollmentToken.find().sort({ created_at: -1 }).limit(appConfig.limits.pageSizeMax).lean();
      for (const t of docs) {
        const active = isActive(t, now);
        if (!active && !req.includeInactive) continue;
        yield {
          tokenId: t.token_id,
          label: t.label,
          maxUses: t.max_uses,
          uses: t.uses,
          expiresAt: dateToIso(t.expires_at),
          revoked: Boolean(t.revoked_at),
          active,
          createdBy: t.created_by,
          createdAt: dateToIso(t.created_at),
          lastUsedAt: dateToIso(t.last_used_at),
        };
      }
    },

    async revokeEnrollmentToken(req, ctx) {
      if (!req.tokenId) throw invalidArg('token_id is required');
      const revoked = await EnrollmentToken.findOneAndUpdate(
        { token_id: req.tokenId, revoked_at: null },
        { $set: { revoked_at: new Date() } },
        { returnDocument: 'after' }
      );
      if (revoked) {
        await logEvent({ actor: authOf(ctx).sub, eventType: 'enrollment.token_revoked', details: { token_id: req.tokenId } });
        return { revoked: true };
      }
      if (!(await EnrollmentToken.exists({ token_id: req.tokenId }))) throw notFound('Enrollment token not found');
      return { revoked: true };
    },

    async getFlServerStatus() {
      const status = await latestFlStatus();
      if (!status) return { online: false, state: 0, message: 'The FL server has not reported yet' };
      return {
        online: status.online,
        state: FL_SERVER_STATE_TO_PROTO[status.state],
        workerId: status.worker_id,
        currentRoundId: status.current_round_id ?? '',
        version: status.version,
        message: status.message,
        lastError: status.last_error,
        lastReportAt: dateToIso(status.last_report_at),
      };
    },

    async deleteUser(req, ctx) {
      const actor = authOf(ctx).sub;
      if (!req.userId) throw invalidArg('user_id is required');
      if (req.userId === actor) throw failedPrecondition('Cannot delete your own account');

      const target = await AdminUser.findOne({ user_id: req.userId });
      if (!target) throw notFound('User not found');
      if (target.role === 'super_admin' && (await AdminUser.countDocuments({ role: 'super_admin' })) <= 1) {
        throw failedPrecondition('Cannot delete the last Super Admin');
      }

      await target.deleteOne();
      await sessions.endAll(target.user_id);
      await logEvent({ actor, eventType: 'admin.user_deleted', details: { deleted_user_id: req.userId } });
      return { deleted: true };
    },
  };
}

function toConfigResponse(c) {
  return {
    mu: c.mu,
    minClientsPerRound: c.min_clients_per_round,
    maxRoundDurationSeconds: c.max_round_duration_seconds,
    utilityThresholdHigh: c.utility_threshold_high,
    utilityThresholdLow: c.utility_threshold_low,
    compressionRatio: c.ratio_medium,
    maxClientsPerRound: c.max_clients_per_round,
    localEpochs: c.local_epochs,
    batchSize: c.batch_size,
    utility: utilityConfigToProto(c),
  };
}
