import { EventEmitter } from 'node:events';
import { Round } from '../models/Round.js';
import { Update } from '../models/Update.js';
import { logEvent } from '../utils/auditLog.js';
import { publish, ADMIN_ROLES, ADMIN_AND_CLIENTS } from './lib/events.js';
import { config } from '../config/index.js';

const USABLE = ['accepted', 'compressed'];
const FINISHED = ['accepted', 'compressed', 'rejected'];
const OPEN = ['pending', 'prepared', 'accepted', 'compressed'];

export function readyEventOf(round, reason = round.ready_reason) {
  return {
    roundId: round.round_id,
    roundNumber: round.round_number,
    reason,
    updateCount: round.ready_update_count ?? 0,
    modelVersionBefore: round.model_version_before ?? 0,
    readyAt: (round.ready_at ?? new Date()).toISOString(),
  };
}

export async function usableUpdateIds(roundId) {
  const docs = await Update.find({ round_id: roundId, status: { $in: USABLE } }).select('update_id').lean();
  return docs.map((d) => d.update_id);
}

export function createRoundScheduler({ logger, settings = config.scheduler } = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let timer = null;
  let running = false;

  async function markReady(round, reason, usable) {
    const now = new Date();
    const updated = await Round.findOneAndUpdate(
      { round_id: round.round_id, status: 'active', ready_at: null },
      { $set: { ready_at: now, ready_reason: reason, ready_update_count: usable } },
      { returnDocument: 'after' }
    );
    if (!updated) return;
    publish('round_ready', { round_id: updated.round_id, reason, update_count: usable }, ADMIN_ROLES);
    await logEvent({ actor: 'scheduler', eventType: 'round.ready', details: { round_id: updated.round_id, reason, update_count: usable } });
    emitter.emit('ready', readyEventOf(updated));
  }

  async function abort(round, reason) {
    const updated = await Round.findOneAndUpdate(
      { round_id: round.round_id, status: 'active' },
      { $set: { status: 'aborted', aborted_reason: reason, completed_at: new Date() }, $unset: { running: 1 } },
      { returnDocument: 'after' }
    );
    if (!updated) return;
    await Update.updateMany({ round_id: round.round_id, status: { $in: OPEN } }, { status: 'rejected', reason: 'round aborted' });
    publish('round_aborted', { round_id: round.round_id, reason }, ADMIN_AND_CLIENTS);
    await logEvent({ level: 'warn', actor: 'scheduler', eventType: 'round.aborted', details: { round_id: round.round_id, reason } });
  }

  async function fail(round, fromStatus, reason) {
    const updated = await Round.findOneAndUpdate(
      { round_id: round.round_id, status: fromStatus },
      { $set: { status: 'failed', failed_reason: reason, completed_at: new Date() }, $unset: { running: 1 } },
      { returnDocument: 'after' }
    );
    if (!updated) return;
    publish('round_failed', { round_id: round.round_id, reason }, ADMIN_AND_CLIENTS);
    await logEvent({ level: 'error', actor: 'scheduler', eventType: 'round.failed', details: { round_id: round.round_id, reason } });
  }

  async function checkActive(round, now) {
    const timeoutMs = settings.aggregationTimeoutSeconds * 1000;
    if (round.ready_at) {
      if (now - round.ready_at.getTime() > timeoutMs) {
        await fail(round, 'active', `the FL server did not start aggregation within ${settings.aggregationTimeoutSeconds}s of the round becoming ready`);
      }
      return;
    }

    const [usable, finishedBy] = await Promise.all([
      Update.countDocuments({ round_id: round.round_id, status: { $in: USABLE } }),
      Update.distinct('client_id', { round_id: round.round_id, status: { $in: FINISHED } }),
    ]);
    const finished = new Set(finishedBy);
    const joined = round.participants.filter((p) => p.status === 'joined');

    if (now > round.deadline_at.getTime()) {
      if (usable >= round.min_clients) await markReady(round, 'deadline', usable);
      else await abort(round, `deadline passed with ${usable} usable update(s); min_clients is ${round.min_clients}`);
      return;
    }
    if (usable >= round.max_clients) {
      await markReady(round, 'max_updates', usable);
      return;
    }
    if (joined.length > 0 && usable >= round.min_clients && joined.every((p) => finished.has(p.client_id))) {
      await markReady(round, 'all_submitted', usable);
    }
  }

  async function checkAggregating(round, now) {
    const started = round.aggregating_started_at ?? round.updated_at ?? round.started_at;
    if (now - started.getTime() > settings.aggregationTimeoutSeconds * 1000) {
      await fail(round, 'aggregating', `aggregation did not complete within ${settings.aggregationTimeoutSeconds}s`);
    }
  }

  async function tick(now = Date.now()) {
    if (running) return;
    running = true;
    try {
      const rounds = await Round.find({ status: { $in: ['active', 'aggregating'] } });
      for (const round of rounds) {
        try {
          if (round.status === 'active') await checkActive(round, now);
          else await checkAggregating(round, now);
        } catch (err) {
          logger?.error({ err, round_id: round.round_id }, 'round scheduler failed on a round');
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    onReady(listener) {
      emitter.on('ready', listener);
      return () => emitter.off('ready', listener);
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch((err) => logger?.error({ err }, 'round scheduler tick failed'));
      }, settings.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
