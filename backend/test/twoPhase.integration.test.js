import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { CompressionLevel, UpdateStatus } from '../src/gen/common_pb.js';
import { Update } from '../models/Update.js';
import { GlobalModel } from '../models/GlobalModel.js';
import { startTestServer, collect } from './support/testServer.js';

const MB = 1024 * 1024;
let srv;

before(async () => {
  srv = await startTestServer({ env: { MAX_UPDATE_SIZE_MB: '1' } });
  await srv.api.admin.updateConfig({ minClientsPerRound: 1, utilityThresholdLow: 0.05, utilityThresholdHigh: 0.5 }, srv.superAdmin);
});

after(async () => {
  await srv?.stop();
});

const isCode = (code, pattern) => (err) => err instanceof ConnectError && err.code === code && (!pattern || pattern.test(err.message));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GOOD = { localLossBefore: 1, localLossAfter: 0.2, dataSize: 5000, labelDistribution: { a: 100, b: 100, c: 100 } };
const LOW = { localLossBefore: 1, localLossAfter: 0.99, dataSize: 50, labelDistribution: { a: 1 } };

async function withRound(fn, opts = {}) {
  const round = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600, ...opts }, srv.superAdmin);
  try {
    return await fn(round);
  } finally {
    await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin).catch(() => {});
  }
}

async function joined(round, name = 'two-phase', localDataSize = 10000) {
  const c = await srv.newSdkClient(name);
  await srv.api.client.joinRound({ roundId: round.roundId, localDataSize }, c);
  return c;
}

const prepare = (round, c, m = GOOD) => srv.api.client.prepareUpdate({
  roundId: round.roundId,
  localLossBefore: m.localLossBefore,
  localLossAfter: m.localLossAfter,
  labelDistribution: { counts: m.labelDistribution },
  dataSize: m.dataSize,
  trainingTimeMs: 10,
}, c);

const putFile = (url, body) => fetch(url, { method: 'PUT', body });

test('prepare, upload and submit: the FL server downloads exactly the bytes the client sent', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    assert.equal(prepared.accepted, true);
    assert.ok(prepared.utilityScore > 0.5);
    assert.equal(prepared.compressionLevel, CompressionLevel.NONE);
    assert.equal(prepared.compressionRatio, 1);
    assert.ok(prepared.upload.url.startsWith(`${srv.baseUrl}/storage/updates/${prepared.updateId}?`));
    assert.equal(prepared.upload.maxBytes, BigInt(MB));

    let stored = await Update.findOne({ update_id: prepared.updateId }).lean();
    assert.equal(stored.status, 'prepared');
    assert.equal(stored.upload_path, `/updates/${prepared.updateId}`);
    assert.equal((await srv.api.client.getUpdateStatus({ roundId: round.roundId }, c)).status, UpdateStatus.PENDING);

    const body = crypto.randomBytes(300_000);
    assert.equal((await putFile(prepared.upload.url, body)).status, 201);
    stored = await Update.findOne({ update_id: prepared.updateId }).lean();
    assert.equal(stored.bytes_uploaded, body.length);
    assert.equal(stored.sha256, sha(body));

    const submitted = await srv.api.client.submitUpdate({ roundId: round.roundId, updateId: prepared.updateId, sha256: sha(body) }, c);
    assert.deepEqual([submitted.updateId, submitted.accepted, submitted.compressionRequired], [prepared.updateId, true, false]);
    stored = await Update.findOne({ update_id: prepared.updateId }).lean();
    assert.equal(stored.status, 'accepted');
    assert.equal(stored.delta_weights_url, stored.upload_path);

    const [entry] = await collect(srv.api.fl.getRoundUpdates({ roundId: round.roundId }, srv.internal));
    assert.equal(entry.updateId, prepared.updateId);
    assert.equal(entry.sha256, sha(body));
    assert.equal(entry.bytes, BigInt(body.length));
    assert.equal(entry.dataSize, GOOD.dataSize);
    assert.equal(entry.compressionRatio, 1);
    assert.equal(entry.compressionLevel, CompressionLevel.NONE);
    const downloaded = Buffer.from(await (await fetch(entry.downloadUrl)).arrayBuffer());
    assert.equal(sha(downloaded), sha(body));
  });
});

test('a low-utility update is told its compression ratio before uploading', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c, LOW);
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.compressionLevel, CompressionLevel.FULL);
    assert.equal(prepared.compressionRatio, 0.1);
    const body = crypto.randomBytes(1000);
    await putFile(prepared.upload.url, body);
    const submitted = await srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(body) }, c);
    assert.equal(submitted.compressionRequired, true);
    assert.equal((await Update.findOne({ update_id: prepared.updateId }).lean()).status, 'compressed');
  });
});

test('JoinRound requires local_data_size, and data_size cannot exceed it', async () => {
  await withRound(async (round) => {
    const c = await srv.newSdkClient('size');
    await assert.rejects(srv.api.client.joinRound({ roundId: round.roundId }, c), isCode(Code.InvalidArgument, /local_data_size/));
    await srv.api.client.joinRound({ roundId: round.roundId, localDataSize: 1000 }, c);
    await assert.rejects(prepare(round, c, { ...GOOD, dataSize: 1001 }), isCode(Code.InvalidArgument, /larger than the local_data_size declared/));
    assert.equal(await Update.countDocuments({ round_id: round.roundId }), 0);
    assert.equal((await prepare(round, c, { ...GOOD, dataSize: 1000 })).accepted, true);
  });
});

test('SubmitUpdate without update_id is refused with guidance', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    await assert.rejects(srv.api.client.submitUpdate({ roundId: round.roundId }, c), isCode(Code.InvalidArgument, /call PrepareUpdate/));
  });
});

test('SubmitUpdate before the upload finishes is refused', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: 'a'.repeat(64) }, c),
      isCode(Code.FailedPrecondition, /not been fully uploaded/)
    );
    const half = await fetch(prepared.upload.url, { method: 'PUT', body: Buffer.alloc(1000), headers: { 'content-range': 'bytes 0-999/2000' } });
    assert.equal(half.status, 202);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: 'a'.repeat(64) }, c),
      isCode(Code.FailedPrecondition, /not been fully uploaded/)
    );
  });
});

test('a wrong sha256 is refused and the update stays open for the right one', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    const body = crypto.randomBytes(5000);
    await putFile(prepared.upload.url, body);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(Buffer.from('other')) }, c),
      isCode(Code.FailedPrecondition, /does not match/)
    );
    await assert.rejects(srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: 'not-hex' }, c), isCode(Code.InvalidArgument, /sha256/));
    assert.equal((await Update.findOne({ update_id: prepared.updateId }).lean()).status, 'prepared');
    assert.equal((await srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(body) }, c)).accepted, true);
  });
});

test('SubmitUpdate is safe to retry, but not with a different file', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const { prepared, sha256 } = await srv.submitUpdate(c, { roundId: round.roundId, ...GOOD });
    const again = await srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256 }, c);
    assert.equal(again.updateId, prepared.updateId);
    assert.equal(again.accepted, true);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: 'b'.repeat(64) }, c),
      isCode(Code.FailedPrecondition, /different file/)
    );
  });
});

test('an upload that goes through PrepareUpdate can resume and use a refreshed URL', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    const body = crypto.randomBytes(60_000);
    const first = await fetch(prepared.upload.url, { method: 'PUT', body: body.subarray(0, 25_000), headers: { 'content-range': 'bytes 0-24999/60000' } });
    assert.equal(first.status, 202);

    const u = new URL(prepared.upload.url);
    const refreshed = await (await fetch(`${srv.baseUrl}/storage/refresh${u.pathname.slice('/storage'.length)}${u.search}`, { method: 'POST' })).json();
    const head = await fetch(refreshed.url, { method: 'HEAD' });
    assert.equal(head.headers.get('upload-offset'), '25000');
    const rest = await fetch(refreshed.url, { method: 'PUT', body: body.subarray(25_000), headers: { 'content-range': 'bytes 25000-59999/60000' } });
    assert.equal(rest.status, 201);

    assert.equal((await srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(body) }, c)).accepted, true);
  });
});

test('preparing again resets the upload, so the old file cannot be submitted', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const first = await prepare(round, c);
    const oldBody = crypto.randomBytes(2000);
    await putFile(first.upload.url, oldBody);

    const second = await prepare(round, c);
    assert.equal(second.updateId, first.updateId);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: second.updateId, sha256: sha(oldBody) }, c),
      isCode(Code.FailedPrecondition, /not been fully uploaded/)
    );
    const newBody = crypto.randomBytes(3000);
    assert.equal((await putFile(second.upload.url, newBody)).status, 201);
    assert.equal((await srv.api.client.submitUpdate({ updateId: second.updateId, sha256: sha(newBody) }, c)).accepted, true);
  });
});

test('an update rejected at prepare gets no upload URL and cannot be submitted', async () => {
  await srv.api.admin.updateConfig({ utility: { rejectBelow: 0.05 } }, srv.superAdmin);
  try {
    await withRound(async (round) => {
      const c = await joined(round);
      const prepared = await prepare(round, c, { localLossBefore: 1, localLossAfter: 1, dataSize: 1, labelDistribution: { a: 1 } });
      assert.equal(prepared.accepted, false);
      assert.equal(prepared.upload, undefined);
      assert.match(prepared.reason, /rejection threshold/);
      await assert.rejects(
        srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: 'c'.repeat(64) }, c),
        isCode(Code.FailedPrecondition, /rejected/)
      );
    });
  } finally {
    await srv.api.admin.updateConfig({ utility: { rejectBelow: 0 } }, srv.superAdmin);
  }
});

test('SubmitUpdate after the deadline is refused even if the upload finished in time', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    const body = crypto.randomBytes(1000);
    await putFile(prepared.upload.url, body);
    await sleep(1300);
    await assert.rejects(
      srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(body) }, c),
      isCode(Code.FailedPrecondition, /deadline has passed/)
    );
  }, { deadlineSeconds: 1 });
});

test('a client cannot submit another client\'s update', async () => {
  await withRound(async (round) => {
    const owner = await joined(round, 'owner');
    const thief = await joined(round, 'thief');
    const prepared = await prepare(round, owner);
    const body = crypto.randomBytes(1000);
    await putFile(prepared.upload.url, body);
    await assert.rejects(srv.api.client.submitUpdate({ updateId: prepared.updateId, sha256: sha(body) }, thief), isCode(Code.NotFound));
  });
});

test('the upload URL from PrepareUpdate enforces MAX_UPDATE_SIZE_MB', async () => {
  await withRound(async (round) => {
    const c = await joined(round);
    const prepared = await prepare(round, c);
    assert.equal((await putFile(prepared.upload.url, Buffer.alloc(1.5 * MB))).status, 413);
  });
});

test('StopRound also rejects prepared updates', async () => {
  const round = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, srv.superAdmin);
  const c = await joined(round);
  const prepared = await prepare(round, c);
  await srv.api.admin.stopRound({ roundId: round.roundId }, srv.superAdmin);
  const stored = await Update.findOne({ update_id: prepared.updateId }).lean();
  assert.equal(stored.status, 'rejected');
  assert.equal(stored.reason, 'round aborted');
});

test('GetModelUploadUrl hands out a one-time, size-limited model upload', async () => {
  const version = 1 + Math.floor(Math.random() * 1e9);
  const { upload, resourcePath } = await srv.api.fl.getModelUploadUrl({ modelVersion: version }, srv.internal);
  assert.equal(resourcePath, `/models/${version}`);
  assert.ok(upload.url.includes(`/storage/models/${version}?`));
  assert.ok(upload.maxBytes > 0n);
  assert.equal((await putFile(upload.url, Buffer.from('model v1'))).status, 201);
  assert.equal((await putFile(upload.url, Buffer.from('replacement'))).status, 409);

  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: 0 }, srv.internal), isCode(Code.InvalidArgument));
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: resourcePath }, srv.internal);
  await assert.rejects(srv.api.fl.getModelUploadUrl({ modelVersion: version }, srv.internal), isCode(Code.AlreadyExists));
});

test('models can only be registered from an uploaded file, and its size and sha256 are recorded', async () => {
  const version = 1 + Math.floor(Math.random() * 1e9);
  await assert.rejects(srv.api.fl.pushModel({ modelVersion: version, weightsUrl: 's3://elsewhere/model.bin' }, srv.internal), isCode(Code.InvalidArgument, /must be \/models\//));
  await assert.rejects(srv.api.fl.pushModel({ modelVersion: version, weightsUrl: `/models/${version}` }, srv.internal), isCode(Code.FailedPrecondition, /has not been uploaded/));

  const model = await srv.uploadModel(version, crypto.randomBytes(7777));
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: model.resourcePath }, srv.internal);
  const stored = await GlobalModel.findOne({ model_version: version }).lean();
  assert.equal(stored.size_bytes, 7777);
  assert.equal(stored.sha256, model.sha256);

  const listed = (await collect(srv.api.admin.listModels({}, srv.superAdmin))).find((m) => m.modelVersion === version);
  assert.equal(listed.sizeBytes, 7777n);
  assert.equal(listed.sha256, model.sha256);

  const c = await srv.newSdkClient('model-reader');
  const dl = await srv.api.client.getModelDownload({ modelVersion: version }, c);
  assert.equal(sha(Buffer.from(await (await fetch(dl.downloadUrl)).arrayBuffer())), model.sha256);
});

test('PushModel is refused while a round is running', async () => {
  await withRound(async () => {
    const version = 1 + Math.floor(Math.random() * 1e9);
    const model = await srv.uploadModel(version);
    await assert.rejects(srv.api.fl.pushModel({ modelVersion: version, weightsUrl: model.resourcePath }, srv.internal), isCode(Code.FailedPrecondition, /round is running/));
  });
});

test('CompleteRound needs the uploaded model and records which updates were used', async () => {
  const round = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, srv.superAdmin);
  const used = await joined(round, 'used');
  const unused = await joined(round, 'unused');
  const a = await srv.submitUpdate(used, { roundId: round.roundId, ...GOOD });
  const b = await srv.submitUpdate(unused, { roundId: round.roundId, ...GOOD });
  await srv.api.fl.triggerRound({ roundId: round.roundId, updateIds: [] }, srv.internal);

  const version = 1 + Math.floor(Math.random() * 1e9);
  await assert.rejects(
    srv.api.fl.completeRound({ roundId: round.roundId, newModelVersion: version, modelUrl: `/models/${version}`, globalLoss: 0.3, globalAccuracy: 0.9 }, srv.internal),
    isCode(Code.FailedPrecondition, /has not been uploaded/)
  );
  const model = await srv.uploadModel(version);
  await assert.rejects(
    srv.api.fl.completeRound({ roundId: round.roundId, newModelVersion: version, modelUrl: model.resourcePath, usedUpdateIds: ['nope'] }, srv.internal),
    isCode(Code.InvalidArgument, /not usable/)
  );

  const done = await srv.api.fl.completeRound({
    roundId: round.roundId, newModelVersion: version, modelUrl: model.resourcePath, globalLoss: 0.3, globalAccuracy: 0.9,
    usedUpdateIds: [a.submitted.updateId],
  }, srv.internal);
  assert.equal(done.success, true);

  const unusedDoc = await Update.findOne({ update_id: b.submitted.updateId }).lean();
  assert.equal(unusedDoc.status, 'rejected');
  assert.equal(unusedDoc.reason, 'not used in aggregation');
  assert.equal((await srv.api.client.getStatus({}, used)).roundCount, 1);
  assert.equal((await srv.api.client.getStatus({}, unused)).roundCount, 0);
  assert.equal((await GlobalModel.findOne({ model_version: version }).lean()).sha256, model.sha256);
});

test('communication metrics report measured upload bytes and the savings against the dense model size', async () => {
  const base = 1 + Math.floor(Math.random() * 1e9);
  const baseModel = await srv.uploadModel(base, crypto.randomBytes(10_000));
  await srv.api.fl.pushModel({ modelVersion: base, weightsUrl: baseModel.resourcePath }, srv.internal);

  const round = await srv.api.admin.startRound({ maxClients: 10, deadlineSeconds: 600 }, srv.superAdmin);
  const dense = await joined(round, 'dense');
  const sparse = await joined(round, 'sparse');
  await srv.submitUpdate(dense, { roundId: round.roundId, ...GOOD, body: crypto.randomBytes(10_000) });
  await srv.submitUpdate(sparse, { roundId: round.roundId, ...LOW, body: crypto.randomBytes(1_000) });
  await srv.completeRound(round.roundId);

  const points = await collect(srv.api.admin.getCommunicationMetrics({ lastNRounds: 1 }, srv.superAdmin));
  const p = points[points.length - 1];
  assert.equal(p.roundNumber, round.roundNumber);
  assert.equal(p.bytesReceived, 11_000n);
  assert.equal(p.bytesMeasured, 11_000n);
  assert.equal(p.bytesSaved, 9_000n);
  assert.equal(p.fullCount, 1);
  assert.equal(p.compressedCount, 1);
});
