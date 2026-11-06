import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sign } from '../utils/signedUrl.js';
import { newId } from '../utils/ids.js';
import { startTestServer, collect } from './support/testServer.js';

const MB = 1024 * 1024;
let srv;

before(async () => {
  srv = await startTestServer({ env: { MAX_UPDATE_SIZE_MB: '1', MAX_MODEL_SIZE_MB: '2' } });
});

after(async () => {
  await srv?.stop();
});

const at = (signed) => `${srv.baseUrl}${signed.path}`;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const put = (url, body, headers = {}) => fetch(url, { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream', ...headers } });
const uploadUrl = (resourcePath, opts = {}) => at(sign(resourcePath, { method: 'PUT', maxBytes: 10 * MB, ...opts }));
const downloadUrl = (resourcePath) => at(sign(resourcePath));

async function filesIn(dir) {
  try {
    return await fsp.readdir(path.join(srv.storageDir, dir));
  } catch {
    return [];
  }
}

function streamOf(buf, chunk = 64 * 1024) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= buf.length) {
        controller.close();
        return;
      }
      controller.enqueue(buf.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

test('upload then download returns the same bytes, size and sha256', async () => {
  const id = newId();
  const body = crypto.randomBytes(300 * 1024);

  const res = await put(uploadUrl(`/updates/${id}`), body);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { path: `/updates/${id}`, bytes: body.length, sha256: sha(body), complete: true });

  const onDisk = await fsp.readFile(path.join(srv.storageDir, 'updates', id));
  assert.equal(sha(onDisk), sha(body));

  const got = await fetch(downloadUrl(`/updates/${id}`));
  assert.equal(got.status, 200);
  assert.equal(Number(got.headers.get('content-length')), body.length);
  assert.equal(sha(Buffer.from(await got.arrayBuffer())), sha(body));
});

test('an upload without a content-type header is accepted', async () => {
  const id = newId();
  const body = crypto.randomBytes(1000);
  const res = await fetch(uploadUrl(`/updates/${id}`), { method: 'PUT', body });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).sha256, sha(body));
});

test('a download URL cannot be used to upload, and an upload URL cannot download', async () => {
  const id = newId();
  const getSigned = sign(`/updates/${id}`);
  assert.equal((await put(at(getSigned), Buffer.from('x'))).status, 403);

  await put(uploadUrl(`/updates/${id}`), Buffer.from('payload'));
  assert.equal((await fetch(uploadUrl(`/updates/${id}`))).status, 403);
});

test('an expired or tampered upload URL is refused', async () => {
  const id = newId();
  assert.equal((await put(at(sign(`/updates/${id}`, { method: 'PUT', maxBytes: 100, ttlSeconds: -1 })), Buffer.from('x'))).status, 403);

  const raised = uploadUrl(`/updates/${id}`, { maxBytes: 10 }).replace('max=10', 'max=10000000');
  assert.equal((await put(raised, Buffer.alloc(100))).status, 403);
  assert.deepEqual(await filesIn('updates').then((f) => f.filter((n) => n === id)), []);
});

test('a body larger than the signed limit is refused and nothing is left behind', async () => {
  const id = newId();
  const before = await filesIn('updates');

  const declared = await put(uploadUrl(`/updates/${id}`, { maxBytes: 1000 }), Buffer.alloc(5000));
  assert.equal(declared.status, 413);

  const chunked = await fetch(uploadUrl(`/updates/${id}`, { maxBytes: 100 * 1024 }), {
    method: 'PUT',
    body: streamOf(crypto.randomBytes(400 * 1024)),
    duplex: 'half',
  });
  assert.equal(chunked.status, 413);
  assert.deepEqual((await filesIn('updates')).sort(), before.sort());
});

test('MAX_UPDATE_SIZE_MB caps updates even when the URL allows more', async () => {
  const res = await put(uploadUrl(`/updates/${newId()}`, { maxBytes: 50 * MB }), Buffer.alloc(1.5 * MB));
  assert.equal(res.status, 413);
});

test('MAX_MODEL_SIZE_MB applies to models separately', async () => {
  const version = String(1 + Math.floor(Math.random() * 1e9));
  const ok = await put(uploadUrl(`/models/${version}`, { maxBytes: 50 * MB }), Buffer.alloc(1.5 * MB));
  assert.equal(ok.status, 201);
  const big = await put(uploadUrl(`/models/${version}x`, { maxBytes: 50 * MB }), Buffer.alloc(2.5 * MB));
  assert.equal(big.status, 413);
});

test('without overwrite permission an existing object is never replaced', async () => {
  const id = newId();
  const first = Buffer.from('first version');
  assert.equal((await put(uploadUrl(`/updates/${id}`), first)).status, 201);

  const second = await put(uploadUrl(`/updates/${id}`), Buffer.from('second version'));
  assert.equal(second.status, 409);
  assert.equal(sha(await fsp.readFile(path.join(srv.storageDir, 'updates', id))), sha(first));
});

test('with overwrite permission the object is replaced', async () => {
  const id = newId();
  await put(uploadUrl(`/updates/${id}`), Buffer.from('old'));
  const res = await put(uploadUrl(`/updates/${id}`, { overwrite: true }), Buffer.from('new content'));
  assert.equal(res.status, 201);
  assert.equal((await fsp.readFile(path.join(srv.storageDir, 'updates', id))).toString(), 'new content');
});

test('5 concurrent uploads to one path without overwrite: exactly one wins', async () => {
  const id = newId();
  const bodies = Array.from({ length: 5 }, () => crypto.randomBytes(200 * 1024));
  const results = await Promise.all(bodies.map((b) => put(uploadUrl(`/updates/${id}`), b)));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409]);

  const winner = bodies[results.findIndex((r) => r.status === 201)];
  assert.equal(sha(await fsp.readFile(path.join(srv.storageDir, 'updates', id))), sha(winner));
  assert.deepEqual((await filesIn('updates')).filter((n) => n.startsWith('.upload-')), []);
});

test('invalid resource paths are refused even with a valid signature', async () => {
  for (const bad of ['/updates/.hidden', '/other/file', '/updates/a b', '/models/']) {
    const res = await put(uploadUrl(bad), Buffer.from('x'));
    assert.ok([400, 403, 404].includes(res.status), `${bad} -> ${res.status}`);
    assert.notEqual(res.status, 201);
  }
  const traversal = await fetch(`${srv.baseUrl}/storage/updates/..%2F..%2Fescape?${new URL(uploadUrl('/updates/x')).searchParams}`, { method: 'PUT', body: 'x' });
  assert.notEqual(traversal.status, 201);
  await assert.rejects(fsp.access(path.join(path.dirname(srv.storageDir), 'escape')));
});

test('a model URL from GetModelDownload is absolute and downloads the stored file', async () => {
  const version = await srv.nextModelVersion();
  const body = crypto.randomBytes(4096);
  assert.equal((await put(uploadUrl(`/models/${version}`), body)).status, 201);
  await srv.api.fl.pushModel({ modelVersion: version, weightsUrl: `/models/${version}` }, srv.internal);

  const c = await srv.newSdkClient('model-downloader');
  const dl = await srv.api.client.getModelDownload({ modelVersion: version }, c);
  assert.ok(dl.downloadUrl.startsWith(`${srv.baseUrl}/storage/models/${version}?`), dl.downloadUrl);

  const got = await fetch(dl.downloadUrl);
  assert.equal(got.status, 200);
  assert.equal(sha(Buffer.from(await got.arrayBuffer())), sha(body));
});

test('deleting a model also deletes its stored file', async () => {
  const oldVersion = await srv.nextModelVersion();
  await put(uploadUrl(`/models/${oldVersion}`), Buffer.from('old model'));
  await srv.api.fl.pushModel({ modelVersion: oldVersion, weightsUrl: `/models/${oldVersion}` }, srv.internal);
  await put(uploadUrl(`/models/${oldVersion + 1}`), Buffer.from('newer model'));
  await srv.api.fl.pushModel({ modelVersion: oldVersion + 1, weightsUrl: `/models/${oldVersion + 1}` }, srv.internal);

  const models = await collect(srv.api.admin.listModels({}, srv.superAdmin));
  const old = models.find((m) => m.modelVersion === oldVersion);
  await fsp.access(path.join(srv.storageDir, 'models', String(oldVersion)));

  await srv.api.admin.deleteModel({ modelId: old.modelId }, srv.superAdmin);
  await assert.rejects(fsp.access(path.join(srv.storageDir, 'models', String(oldVersion))));
});

test('RPCs keep working next to the storage routes', async () => {
  const h = await srv.api.system.healthCheck({});
  assert.equal(h.status, 'ok');
});
