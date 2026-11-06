import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { RoundReadyReason, FlServerState } from '../src/gen/common_pb.js';
import { Round } from '../models/Round.js';
import { Update } from '../models/Update.js';
import { startTestServer, collect } from './support/testServer.js';

let srv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCode = (code, pattern) => (err) => err instanceof ConnectError && err.code === code && (!pattern || pattern.test(err.message));
const GOOD = { localLossBefore: 1, localLossAfter: 0.2, dataSize: 5000, labelDistribution: { a: 100, b: 100, c: 100 } };

before(async () => {
  srv = await startTestServer({
    env: {
      SCHEDULER_INTERVAL_MS: '100',
      AGGREGATION_TIMEOUT_SECONDS: '3',
      WATCH_KEEPALIVE_MS: '300',
      FL_STATUS_STALE_AFTER_MS: '600',
    },
  });
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5 }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

function watch() {
  const ac = new AbortController();
  const events = [];
  const waiters = [];
  const done = (async () => {
    try {
      for await (const e of srv.api.fl.watchRounds({ workerId: 'test-worker' }, { ...srv.internal, signal: ac.signal })) {
        events.push(e);
        for (const w of [...waiters]) {
          if (w.pred(e)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(e);
          }
        }
      }
    } catch {
      return;
    }
  })();
  return {
    events,
    next(pred, timeoutMs = 4000) {
      const found = events.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error(`no matching WatchRounds event within ${timeoutMs}ms; got ${JSON.stringify(events.map((x) => [x.roundId, x.reason]))}`)), timeoutMs);
      });
    },
    async close() {
      ac.abort();
      await done;
    },
  };
}

async function startRound(opts = {}) {
  return srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600, ...opts }, srv.superAdmin);
}

async function endRound(roundId) {
  await srv.api.admin.stopRound({ roundId, reason: 'test cleanup' }, srv.superAdmin).catch(() => {});
}

async function joinedClients(round, n) {
  const clients = await Promise.all(Array.from({ length: n }, (_, i) => srv.newSdkClient(`sched-${i}`)));
  for (const c of clients) await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 10000 }, c);
  return clients;
}

async function waitForRound(roundId, pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await Round.findOne({ round_id: roundId }).lean();
    if (pred(r)) return r;
    await sleep(50);
  }
  throw new Error('round never reached the expected state');
}

test('a round becomes ready when every joined participant has submitted', async () => {
  const w = watch();
  const round = await startRound();
  try {
    const clients = await joinedClients(round, 2);
    await srv.submitUpdate(clients[0], { roundId: round.roundId, ...GOOD });
    await sleep(300);
    assert.equal((await Round.findOne({ round_id: round.roundId }).lean()).ready_at, null);

    await srv.submitUpdate(clients[1], { roundId: round.roundId, ...GOOD });
    const e = await w.next((x) => x.roundId === round.roundId);
    assert.equal(e.reason, RoundReadyReason.ALL_SUBMITTED);
    assert.equal(e.updateCount, 2);
    assert.equal(e.roundNumber, round.roundNumber);
    const stored = await Round.findOne({ round_id: round.roundId }).lean();
    assert.equal(stored.ready_reason, 'all_submitted');
    assert.equal(stored.status, 'active');
  } finally {
    await w.close();
    await endRound(round.roundId);
  }
});

test('a round becomes ready when usable updates reach max_clients', async () => {
  const w = watch();
  const round = await startRound({ maxClients: 2 });
  try {
    const clients = await joinedClients(round, 2);
    for (const c of clients) await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
    const e = await w.next((x) => x.roundId === round.roundId);
    assert.equal(e.reason, RoundReadyReason.MAX_UPDATES);
  } finally {
    await w.close();
    await endRound(round.roundId);
  }
});

test('at the deadline a round with enough updates becomes ready', async () => {
  const w = watch();
  const round = await startRound({ deadlineSeconds: 1 });
  try {
    const clients = await joinedClients(round, 2);
    await srv.submitUpdate(clients[0], { roundId: round.roundId, ...GOOD });
    const e = await w.next((x) => x.roundId === round.roundId);
    assert.equal(e.reason, RoundReadyReason.DEADLINE);
    assert.equal(e.updateCount, 1);
  } finally {
    await w.close();
    await endRound(round.roundId);
  }
});

test('at the deadline a round below min_clients is aborted and its updates rejected', async () => {
  await srv.api.admin.updateConfig({ minClientsPerRound: 2 }, srv.superAdmin);
  try {
    const round = await startRound({ deadlineSeconds: 1 });
    const clients = await joinedClients(round, 2);
    const { submitted } = await srv.submitUpdate(clients[0], { roundId: round.roundId, ...GOOD });

    const stored = await waitForRound(round.roundId, (r) => r.status === 'aborted');
    assert.match(stored.aborted_reason, /1 usable update\(s\); min_clients is 2/);
    assert.equal('running' in stored, false);
    const upd = await Update.findOne({ update_id: submitted.updateId }).lean();
    assert.equal(upd.status, 'rejected');
    assert.equal(upd.reason, 'round aborted');

    const next = await startRound();
    await endRound(next.roundId);
  } finally {
    await srv.api.admin.updateConfig({ minClientsPerRound: 1 }, srv.superAdmin);
  }
});

test('becoming ready does not freeze the round; TriggerRound does', async () => {
  const w = watch();
  const round = await startRound();
  try {
    const [first] = await joinedClients(round, 1);
    await srv.submitUpdate(first, { roundId: round.roundId, ...GOOD });
    await w.next((x) => x.roundId === round.roundId);

    const [late] = await joinedClients(round, 1);
    const { submitted } = await srv.submitUpdate(late, { roundId: round.roundId, ...GOOD });
    assert.equal(submitted.accepted, true);

    await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);
    const stored = await Round.findOne({ round_id: round.roundId }).lean();
    assert.equal(stored.status, 'aggregating');
    assert.equal(stored.aggregation_update_ids.length, 2);

    const tooLate = await srv.newSdkClient('too-late');
    const res = await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 100 }, tooLate);
    assert.equal(res.accepted, false);
    assert.match(res.instructions, /aggregating/);
  } finally {
    await w.close();
    await endRound(round.roundId);
  }
});

test('a watcher that connects later receives pending and in-progress rounds', async () => {
  const round = await startRound();
  try {
    const [c] = await joinedClients(round, 1);
    await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
    await waitForRound(round.roundId, (r) => r.ready_at !== null);

    const w1 = watch();
    const pending = await w1.next((x) => x.roundId === round.roundId);
    assert.equal(pending.reason, RoundReadyReason.ALL_SUBMITTED);
    await w1.close();

    await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);
    const w2 = watch();
    const resumed = await w2.next((x) => x.roundId === round.roundId);
    assert.equal(resumed.reason, RoundReadyReason.RESUMED);
    await w2.close();
  } finally {
    await endRound(round.roundId);
  }
});

test('the watch stream sends keep-alives', async () => {
  const w = watch();
  await sleep(1000);
  await w.close();
  const keepalives = w.events.filter((e) => e.reason === RoundReadyReason.KEEPALIVE);
  assert.ok(keepalives.length >= 2 && keepalives.length <= 4, `got ${keepalives.length}`);
  assert.equal(keepalives[0].roundId, '');
});

test('TriggerRound is atomic and only accepts usable update ids', async () => {
  const round = await startRound();
  try {
    const [c] = await joinedClients(round, 1);
    const { submitted } = await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
    await assert.rejects(
      srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: ['not-an-update'] }, srv.internal),
      isCode(Code.InvalidArgument, /not usable/)
    );

    const results = await Promise.allSettled([1, 2, 3].map(() => srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [submitted.updateId] }, srv.internal)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.ok(isCode(Code.FailedPrecondition)(r.reason));
  } finally {
    await endRound(round.roundId);
  }
});

test('CompleteRound needs an aggregating round, a newer model version, and can only happen once', async () => {
  const round = await startRound();
  const [c] = await joinedClients(round, 1);
  const { submitted } = await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });

  const version = await srv.nextModelVersion();
  const model = await srv.uploadModel(version);
  const req = { roundId: round.roundId, newModelVersion: version, modelUrl: model.resourcePath, globalLoss: 0.3, globalAccuracy: 0.9, usedUpdateIds: [submitted.updateId] };
  await assert.rejects(srv.api.fl.completeRound(req, srv.internal), isCode(Code.FailedPrecondition, /call TriggerRound/));

  await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);
  const old = await srv.api.admin.listModels({}, srv.superAdmin);
  void old;
  assert.equal((await srv.api.fl.completeRound(req, srv.internal)).success, true);
  await assert.rejects(srv.api.fl.completeRound(req, srv.internal), isCode(Code.FailedPrecondition));

  const stored = await Round.findOne({ round_id: round.roundId }).lean();
  assert.equal(stored.status, 'complete');
  assert.equal(stored.model_version_after, version);
  assert.equal('running' in stored, false);
});

test('model versions must increase', async () => {
  const latest = (await srv.nextModelVersion()) - 1;
  assert.ok(latest >= 1);
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: latest }, srv.internal), isCode(Code.AlreadyExists));
  if (latest > 1) {
    await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: latest - 1 }, srv.internal), (err) => err instanceof ConnectError);
  }
  const lower = await srv.uploadModel(latest + 5);
  void lower;
  await srv.api.fl.pushModel({ modelVersion: latest + 5, weightsUrl: `/models/${latest + 5}` }, srv.internal);
  await assert.rejects(
    srv.api.fl.getModelUploadUrl({ modelVersion: latest + 2 }, srv.internal),
    isCode(Code.FailedPrecondition, /greater than the latest version/)
  );
});

test('a ready round that the FL server never picks up fails after AGGREGATION_TIMEOUT_SECONDS', async () => {
  const round = await startRound();
  const [c] = await joinedClients(round, 1);
  await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
  await waitForRound(round.roundId, (r) => r.ready_at !== null);

  const stored = await waitForRound(round.roundId, (r) => r.status === 'failed', 6000);
  assert.match(stored.failed_reason, /did not start aggregation within 3s/);
  assert.equal('running' in stored, false);
  const next = await startRound();
  await endRound(next.roundId);
});

test('an aggregation that never completes fails after AGGREGATION_TIMEOUT_SECONDS', async () => {
  const round = await startRound();
  const [c] = await joinedClients(round, 1);
  const { submitted } = await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
  await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);

  const stored = await waitForRound(round.roundId, (r) => r.status === 'failed', 6000);
  assert.match(stored.failed_reason, /aggregation did not complete within 3s/);

  const version = await srv.nextModelVersion();
  const model = await srv.uploadModel(version);
  await assert.rejects(
    srv.api.fl.completeRound({ roundId: round.roundId, newModelVersion: version, modelUrl: model.resourcePath, usedUpdateIds: [submitted.updateId] }, srv.internal),
    isCode(Code.FailedPrecondition, /Round is failed/)
  );
  const failedLogs = await collect(srv.api.admin.getLogs({ eventType: 'round.failed' }, srv.superAdmin));
  assert.ok(failedLogs.some((l) => JSON.parse(l.detailsJson).round_id === round.roundId));
});

test('maintenance blocks starting aggregation but lets an aggregation in progress finish', async () => {
  const round = await startRound();
  const [c] = await joinedClients(round, 1);
  const { submitted } = await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
  await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);
  const version = await srv.nextModelVersion();
  const model = await srv.uploadModel(version);

  await srv.api.system.setMaintenance({ enabled: true, message: 'test window' }, srv.superAdmin);
  try {
    const other = await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal).catch((e) => e);
    assert.ok(isCode(Code.Unavailable)(other));
    assert.equal((await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal))).length, 1);
    const done = await srv.api.fl.completeRound({
      roundId: round.roundId, newModelVersion: version, modelUrl: model.resourcePath, globalLoss: 0.2, globalAccuracy: 0.95, usedUpdateIds: [submitted.updateId],
    }, srv.internal);
    assert.equal(done.success, true);
  } finally {
    await srv.api.system.setMaintenance({ enabled: false }, srv.superAdmin);
  }
});

test('the FL server reports its status to the backend, and the dashboard reads it from there', async () => {
  const empty = await srv.api.admin.getFlServerStatus({}, srv.superAdmin);
  void empty;
  await srv.api.fl.reportFlStatus({ workerId: 'brain-1', state: FlServerState.AGGREGATING, currentRoundId: 'r-123', version: '0.1.0', message: 'aggregating 3 updates' }, srv.internal);

  const status = await srv.api.admin.getFlServerStatus({}, srv.superAdmin);
  assert.equal(status.online, true);
  assert.equal(status.workerId, 'brain-1');
  assert.equal(status.state, FlServerState.AGGREGATING);
  assert.equal(status.currentRoundId, 'r-123');
  assert.equal(status.version, '0.1.0');
  assert.equal((await srv.api.system.healthCheck({})).flServer, 'online');

  await sleep(800);
  assert.equal((await srv.api.admin.getFlServerStatus({}, srv.superAdmin)).online, false);
  assert.equal((await srv.api.system.healthCheck({})).flServer, 'offline');

  await srv.api.fl.reportFlStatus({ workerId: 'brain-1', state: FlServerState.ERROR, lastError: 'out of memory' }, srv.internal);
  const errored = await srv.api.admin.getFlServerStatus({}, srv.superAdmin);
  assert.equal(errored.online, true);
  assert.equal(errored.lastError, 'out of memory');
  const logs = await collect(srv.api.admin.getLogs({ eventType: 'fl.status_changed' }, srv.superAdmin));
  assert.ok(logs.some((l) => l.level === 'error' && JSON.parse(l.detailsJson).state === 'error'));
});

test('ReportFlStatus validates its input', async () => {
  await assert.rejects(srv.api.fl.reportFlStatus({ workerId: '', state: FlServerState.IDLE }, srv.internal), isCode(Code.InvalidArgument, /worker_id/));
  await assert.rejects(srv.api.fl.reportFlStatus({ workerId: 'bad id!', state: FlServerState.IDLE }, srv.internal), isCode(Code.InvalidArgument, /worker_id/));
  await assert.rejects(srv.api.fl.reportFlStatus({ workerId: 'ok', state: FlServerState.UNSPECIFIED }, srv.internal), isCode(Code.InvalidArgument, /state/));
});

test('a model file left by a failed round is replaced when the same version is requested again', async () => {
  const version = await srv.nextModelVersion();
  await srv.uploadModel(version, Buffer.from('orphan from a failed round'));
  const fresh = await srv.uploadModel(version, Buffer.from('the real model'));
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: fresh.resourcePath }, srv.internal);
  const logs = await collect(srv.api.admin.getLogs({ eventType: 'model.orphan_removed' }, srv.superAdmin));
  assert.ok(logs.some((l) => JSON.parse(l.detailsJson).model_version === version));
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: version }, srv.internal), isCode(Code.AlreadyExists));
});
