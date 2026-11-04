import { Client } from '../../models/Client.js';
import { Round } from '../../models/Round.js';
import { Update } from '../../models/Update.js';
import { GlobalModel } from '../../models/GlobalModel.js';
import { AdminUser } from '../../models/AdminUser.js';
import { AuditLog } from '../../models/AuditLog.js';
import { SystemConfig, ConfigHistory } from '../../models/SystemConfig.js';
import { newId } from '../../utils/ids.js';
import * as signedUrl from '../../utils/signedUrl.js';
import { labelEntropy } from '../../utils/utilityScore.js';
import { logEvent } from '../../utils/auditLog.js';
import {
  ROLE_TO_PROTO,
  ROLE_FROM_PROTO,
  ROUND_STATUS_TO_PROTO,
  UPDATE_STATUS_TO_PROTO,
  COMPRESSION_LEVEL_TO_PROTO,
  dateToIso,
} from '../../utils/protoMappers.js';
import { authOf, getActiveConfig, clampN, parseDate, num, joinedCount, giniCoefficient } from '../lib/helpers.js';
import { invalidArg, notFound, failedPrecondition } from '../lib/errors.js';
import { publish, ADMIN_ROLES, ADMIN_AND_CLIENTS } from '../lib/events.js';

const CLIENT_SORT_FIELDS = ['created_at', 'name', 'last_seen', 'rounds_participated', 'utility_avg', 'status'];
const ASSIGNABLE_ROLES = ['admin', 'fl_engineer', 'viewer'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pageArgs = (req, defLimit = 20) => {
  const limit = clampN(req.limit, defLimit, 200);
  const page = Math.max(1, req.page || 1);
  return { limit, skip: (page - 1) * limit };
};

export function createAdminService() {
  return {
    // ───────────── Clients ─────────────
    async getOverview() {
      const [totalClients, activeClients, activeRound, latestModel] = await Promise.all([
        Client.countDocuments({}),
        Client.countDocuments({ status: 'active' }),
        Round.findOne({ status: { $in: ['active', 'aggregating'] } }).sort({ round_number: -1 }),
        GlobalModel.findOne({ is_active: true }),
      ]);
      return {
        totalClients,
        activeClients,
        currentRoundId: activeRound?.round_id ?? '',
        currentRoundStatus: activeRound?.status ?? '',
        latestModelVersion: latestModel?.model_version ?? 0,
        health: 'ok',
      };
    },

    async *listClients(req) {
      const { limit, skip } = pageArgs(req);
      const sortBy = CLIENT_SORT_FIELDS.includes(req.sortBy) ? req.sortBy : 'created_at';
      const filter = {};
      if (req.status === 'banned') filter.banned_until = { $ne: null };
      else if (req.status) filter.status = req.status;

      const clients = await Client.find(filter).sort({ [sortBy]: -1 }).skip(skip).limit(limit);
      for (const c of clients) {
        yield {
          clientId: c.client_id,
          name: c.name,
          status: c.isBanned() ? 'banned' : c.status,
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

      const updates = await Update.find({ client_id: client.client_id }).sort({ submitted_at: -1 }).limit(50);
      return {
        clientId: client.client_id,
        name: client.name,
        history: updates.map((u) => ({ roundId: u.round_id, status: u.status, submittedAt: dateToIso(u.submitted_at) })),
        utilityScores: updates.map((u) => ({ roundId: u.round_id, score: num(u.utility_score) })),
        labelEntropyAvg: Number(mean(updates.map((u) => labelEntropy(u.label_distribution))).toFixed(4)),
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
      for (const r of rounds) {
        yield {
          roundId: r.round_id,
          roundNumber: r.round_number,
          status: ROUND_STATUS_TO_PROTO[r.status],
          participantCount: joinedCount(r),
          accuracy: num(r.global_accuracy),
          startedAt: dateToIso(r.started_at),
          completedAt: dateToIso(r.completed_at),
        };
      }
    },

    async getRoundDetail(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const round = await Round.findOne({ round_id: req.roundId });
      if (!round) throw notFound('Round not found');
      const updates = await Update.find({ round_id: round.round_id });

      return {
        roundId: round.round_id,
        updates: updates.map((u) => ({ updateId: u.update_id, clientId: u.client_id, status: UPDATE_STATUS_TO_PROTO[u.status] })),
        utilityScores: updates.map((u) => ({ clientId: u.client_id, score: num(u.utility_score) })),
        globalLoss: num(round.global_loss),
        globalAccuracy: num(round.global_accuracy),
        startedAt: dateToIso(round.started_at),
        completedAt: dateToIso(round.completed_at),
        status: ROUND_STATUS_TO_PROTO[round.status],
      };
    },

    async startRound(req, ctx) {
      const config = await getActiveConfig();
      // 0 (proto default) means "use the configured default".
      const maxClients = req.maxClients || config.max_clients_per_round;
      const deadlineSeconds = req.deadlineSeconds || config.max_round_duration_seconds;
      if (maxClients < 0 || deadlineSeconds < 0) throw invalidArg('max_clients and deadline_seconds must be positive');
      if (maxClients < config.min_clients_per_round) {
        throw invalidArg(`max_clients (${maxClients}) is below min_clients_per_round (${config.min_clients_per_round})`);
      }

      const active = await Round.findOne({ status: { $in: ['active', 'aggregating'] } });
      if (active) throw failedPrecondition(`A round is already running (round_id=${active.round_id})`);

      const [latestModel, lastRound] = await Promise.all([
        GlobalModel.findOne({ is_active: true }),
        Round.findOne().sort({ round_number: -1 }),
      ]);

      const round = await Round.create({
        round_id: newId(),
        round_number: (lastRound?.round_number || 0) + 1,
        status: 'active',
        max_clients: maxClients,
        min_clients: config.min_clients_per_round,
        deadline_seconds: deadlineSeconds,
        deadline_at: new Date(Date.now() + deadlineSeconds * 1000),
        notes: req.notes,
        config_snapshot: config.toObject(),
        model_version_before: latestModel?.model_version ?? null,
      });

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

      round.status = 'aborted';
      round.aborted_reason = req.reason || null;
      round.completed_at = new Date();
      await round.save();
      await Update.updateMany({ round_id: round.round_id, status: 'pending' }, { status: 'rejected', reason: 'round aborted' });

      publish('round_aborted', { round_id: round.round_id, reason: req.reason }, ADMIN_AND_CLIENTS);
      await logEvent({ actor: authOf(ctx).sub, eventType: 'round.aborted', details: { round_id: round.round_id, reason: req.reason } });

      return { success: true, roundStatus: ROUND_STATUS_TO_PROTO[round.status] };
    },

    async *listRoundUpdates(req) {
      if (!req.roundId) throw invalidArg('round_id is required');
      const updates = await Update.find({ round_id: req.roundId }).sort({ submitted_at: 1 });
      for (const u of updates) {
        yield {
          updateId: u.update_id,
          clientId: u.client_id,
          utilityScore: num(u.utility_score),
          status: UPDATE_STATUS_TO_PROTO[u.status],
          compressionLevel: COMPRESSION_LEVEL_TO_PROTO[u.compression_level] ?? 0,
          submittedAt: dateToIso(u.submitted_at),
        };
      }
    },

    // ───────────── Metrics ─────────────
    async *getConvergenceMetrics(req) {
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(clampN(req.lastNRounds));
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
      const n = clampN(req.lastNRounds);
      const filter = req.clientId ? { client_id: req.clientId } : {};
      const updates = await Update.find(filter).sort({ submitted_at: -1 }).limit(req.clientId ? n : n * 50);

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
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(clampN(req.lastNRounds));
      for (const r of rounds.reverse()) {
        const updates = await Update.find({ round_id: r.round_id });
        const compressed = updates.filter((u) => u.compression_level && u.compression_level !== 'none');
        // Bytes are approximated from reported data_size — real accounting belongs to the transport/storage layer.
        yield {
          roundNumber: r.round_number,
          bytesReceived: BigInt(updates.reduce((s, u) => s + (u.data_size || 0) * 4, 0)),
          bytesSaved: BigInt(compressed.reduce((s, u) => s + (u.data_size || 0) * 2, 0)),
          fullCount: updates.filter((u) => u.compression_level === 'none' && u.status !== 'rejected').length,
          compressedCount: compressed.length,
          skippedCount: updates.filter((u) => u.status === 'rejected').length,
        };
      }
    },

    async *getFairnessMetrics(req) {
      const rounds = await Round.find({ status: 'complete' }).sort({ round_number: -1 }).limit(clampN(req.lastNRounds));
      for (const r of rounds.reverse()) {
        const scores = (await Update.find({ round_id: r.round_id })).map((u) => num(u.utility_score));
        const joined = joinedCount(r);
        yield {
          roundNumber: r.round_number,
          minorityParticipationRate: joined > 0 ? Number((scores.filter((s) => s < 0.3).length / joined).toFixed(4)) : 0,
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
        compressionRatio: 'compression_ratio',
        localEpochs: 'local_epochs',
        batchSize: 'batch_size',
      };

      const diff = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) diff[column[k]] = v;
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
      if (merged.compression_ratio <= 0 || merged.compression_ratio > 1) throw invalidArg('compression_ratio must be within (0, 1]');

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
      const history = await ConfigHistory.find().sort({ changed_at: -1 }).limit(100);
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

      const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(clampN(req.limit, 100, 500));
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
    compressionRatio: c.compression_ratio,
    maxClientsPerRound: c.max_clients_per_round,
  };
}
