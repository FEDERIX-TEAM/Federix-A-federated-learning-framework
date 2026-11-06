import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { Code, ConnectError } from '@connectrpc/connect';
import { config } from '../config/index.js';
import { Round } from '../models/Round.js';
import { Update } from '../models/Update.js';
import { startTestServer, runServerUntilExit, collect } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer();
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5, utility: { rejectBelow: 0.05 } }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

const isCode = (code) => (err) => err instanceof ConnectError && err.code === code;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clients(n) {
  return Promise.all(Array.from({ length: n }, (_, i) => srv.newSdkClient(`integrity-${i}`)));
}

async function startRound(opts = {}) {
  return srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600, ...opts }, srv.superAdmin);
}

async function stopRound(roundId) {
  await srv.api.admin.stopRound({ roundId, reason: 'test cleanup' }, srv.superAdmin).catch(() => {});
}

const join = (roundId, c) => srv.api.client.joinRound({ roundId, localDataSize: 100000 }, c);

async function submit(roundId, c, before, after, dataSize, counts) {
  const { submitted } = await srv.submitUpdate(c, {
    roundId, localLossBefore: before, localLossAfter: after, labelDistribution: counts, dataSize, trainingTimeMs: 1000,
  });
  return submitted;
}

const submitGood = (roundId, c) => submit(roundId, c, 1.0, 0.2, 5000, { a: 100, b: 100, c: 100 });
const submitPoor = (roundId, c) => submit(roundId, c, 1.0, 1.0, 1, { a: 1 });

async function joinedIn(roundId) {
  const doc = await Round.findOne({ round_id: roundId }).lean();
  return doc.participants.filter((p) => p.status === 'joined');
}

test('the one-running-round and unique round_number indexes exist', async () => {
  const names = (await Round.collection.indexes()).map((i) => i.name);
  assert.ok(names.includes('one_running_round'));
  assert.ok(names.includes('unique_round_number'));
});

test('20 concurrent joins into a max_clients=5 round admit exactly 5', async () => {
  const round = await startRound({ maxClients: 5 });
  try {
    const pool = await clients(20);
    const results = await Promise.all(pool.map((c) => join(round.roundId, c)));

    assert.equal(results.filter((r) => r.accepted).length, 5);
    for (const r of results.filter((x) => !x.accepted)) assert.match(r.instructions, /capacity/);
    assert.equal((await joinedIn(round.roundId)).length, 5);
  } finally {
    await stopRound(round.roundId);
  }
});

test('one client joining 5 times at once gets a single participant entry', async () => {
  const round = await startRound();
  try {
    const [c] = await clients(1);
    const results = await Promise.all(Array.from({ length: 5 }, () => join(round.roundId, c)));

    assert.ok(results.every((r) => r.accepted));
    const doc = await Round.findOne({ round_id: round.roundId }).lean();
    assert.equal(doc.participants.filter((p) => p.client_id === c.id).length, 1);
  } finally {
    await stopRound(round.roundId);
  }
});

test('leave then rejoin reuses the participant entry', async () => {
  const round = await startRound();
  try {
    const [c] = await clients(1);
    await join(round.roundId, c);
    await srv.api.client.leaveRound({ roundId: round.roundId, reason: 'test' }, c);
    const again = await join(round.roundId, c);

    assert.equal(again.accepted, true);
    const doc = await Round.findOne({ round_id: round.roundId }).lean();
    const mine = doc.participants.filter((p) => p.client_id === c.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'joined');
    assert.equal(mine[0].left_at, null);
  } finally {
    await stopRound(round.roundId);
  }
});

test('a rejoin cannot exceed capacity either', async () => {
  const round = await startRound({ maxClients: 2 });
  try {
    const [a, b, c] = await clients(3);
    await join(round.roundId, a);
    await srv.api.client.leaveRound({ roundId: round.roundId }, a);
    await join(round.roundId, b);
    await join(round.roundId, c);

    const back = await join(round.roundId, a);
    assert.equal(back.accepted, false);
    assert.match(back.instructions, /capacity/);
    assert.equal((await joinedIn(round.roundId)).length, 2);
  } finally {
    await stopRound(round.roundId);
  }
});

test('5 concurrent StartRound calls start exactly one round', async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => startRound()));
  const started = results.filter((r) => r.status === 'fulfilled');
  try {
    assert.equal(started.length, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.ok(isCode(Code.FailedPrecondition)(r.reason));
    assert.equal(await Round.countDocuments({ status: { $in: ['active', 'aggregating'] } }), 1);
  } finally {
    for (const r of started) await stopRound(r.value.roundId);
  }
});

test('updates and joins are refused after the round deadline', async () => {
  const round = await startRound({ deadlineSeconds: 1 });
  try {
    const [early, late] = await clients(2);
    assert.equal((await join(round.roundId, early)).accepted, true);
    await sleep(1300);

    await assert.rejects(
      submitGood(round.roundId, early),
      (err) => isCode(Code.FailedPrecondition)(err) && /deadline has passed/.test(err.message)
    );
    const lateJoin = await join(round.roundId, late);
    assert.equal(lateJoin.accepted, false);
    assert.match(lateJoin.instructions, /deadline has passed/);
    assert.equal(await Update.countDocuments({ round_id: round.roundId }), 0);
  } finally {
    await stopRound(round.roundId);
  }
});

test('StopRound rejects every usable update so the FL server gets none', async () => {
  const round = await startRound();
  const [a, b] = await clients(2);
  await join(round.roundId, a);
  await join(round.roundId, b);
  assert.equal((await submitGood(round.roundId, a)).accepted, true);
  assert.equal((await submit(round.roundId, b, 1.0, 0.9, 200, { a: 100 })).compressionRequired, true);
  assert.equal((await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal))).length, 2);

  await srv.api.admin.stopRound({ roundId: round.roundId, reason: 'abort test' }, srv.superAdmin);

  assert.equal((await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal))).length, 0);
  const docs = await Update.find({ round_id: round.roundId }).lean();
  assert.equal(docs.length, 2);
  for (const u of docs) {
    assert.equal(u.status, 'rejected');
    assert.equal(u.reason, 'round aborted');
  }
  const stored = await Round.findOne({ round_id: round.roundId }).lean();
  assert.equal(stored.status, 'aborted');
  assert.equal('running' in stored, false);
});

test('rounds_participated counts once per completed round, only for usable updates', async () => {
  const round = await startRound();
  const [contributor, rejoiner, rejected, idle] = await clients(4);
  for (const c of [contributor, rejoiner, rejected, idle]) await join(round.roundId, c);
  await srv.api.client.leaveRound({ roundId: round.roundId }, rejoiner);
  await join(round.roundId, rejoiner);

  await submitGood(round.roundId, contributor);
  await submitGood(round.roundId, rejoiner);
  assert.equal((await submitPoor(round.roundId, rejected)).accepted, false);

  for (const c of [contributor, rejoiner, rejected, idle]) {
    assert.equal((await srv.api.client.getStatus({}, c)).roundCount, 0);
  }

  await srv.completeRound(round.roundId);

  const counts = {};
  for (const [name, c] of Object.entries({ contributor, rejoiner, rejected, idle })) {
    counts[name] = (await srv.api.client.getStatus({}, c)).roundCount;
  }
  assert.deepEqual(counts, { contributor: 1, rejoiner: 1, rejected: 0, idle: 0 });

  const stored = await Round.findOne({ round_id: round.roundId }).lean();
  assert.equal(stored.status, 'complete');
  assert.equal('running' in stored, false);
});

test('a new round can start once the previous one finished', async () => {
  const first = await startRound();
  await stopRound(first.roundId);
  const second = await startRound();
  assert.equal(second.roundNumber, first.roundNumber + 1);
  await stopRound(second.roundId);
});

test('the server refuses to start when the database already has two running rounds', async () => {
  const dbName = `federix_test_dup_${randomBytes(4).toString('hex')}`;
  const uri = new URL(config.mongoUri);
  uri.pathname = `/${dbName}`;
  const conn = await mongoose.createConnection(uri.toString(), { serverSelectionTimeoutMS: 3000 }).asPromise();
  try {
    const base = { max_clients: 5, min_clients: 1, deadline_seconds: 60, deadline_at: new Date(Date.now() + 60_000), participants: [] };
    await conn.collection('rounds').insertMany([
      { ...base, round_id: 'dup-a', round_number: 1, status: 'active' },
      { ...base, round_id: 'dup-b', round_number: 2, status: 'aggregating' },
    ]);
    const redis = new URL(config.redisUrl);
    redis.pathname = '/15';
    const { code, output } = await runServerUntilExit({ NODE_ENV: 'test', MONGO_URI: uri.toString(), REDIS_URL: redis.toString() });
    assert.equal(code, 1);
    assert.match(output, /More than one round is running: dup-a \(active\), dup-b \(aggregating\)/);
  } finally {
    await conn.dropDatabase();
    await conn.close();
  }
});
