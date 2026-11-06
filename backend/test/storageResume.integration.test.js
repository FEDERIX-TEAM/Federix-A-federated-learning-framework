import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { sign } from '../utils/signedUrl.js';
import { newId } from '../utils/ids.js';
import { startTestServer } from './support/testServer.js';

const MB = 1024 * 1024;
let srv;

before(async () => {
  srv = await startTestServer({ env: { MAX_UPDATE_SIZE_MB: '1', UPLOAD_PARTIAL_TTL_SECONDS: '2', STORAGE_SWEEP_INTERVAL_MS: '200' } });
});

after(async () => {
  await srv?.stop();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const at = (signed) => `${srv.baseUrl}${signed.path}`;
const uploadUrl = (p, opts = {}) => at(sign(p, { method: 'PUT', maxBytes: 10 * MB, ...opts }));
const downloadUrl = (p, opts = {}) => at(sign(p, opts));
const onDisk = (p) => path.join(srv.storageDir, p);

function putChunk(url, body, start, total, extra = {}) {
  const end = start + body.length - 1;
  return fetch(url, { method: 'PUT', body, headers: { 'content-range': `bytes ${start}-${end}/${total}`, ...extra } });
}

async function headUpload(url) {
  const r = await fetch(url, { method: 'HEAD' });
  return {
    status: r.status,
    offset: r.headers.get('upload-offset') === null ? null : Number(r.headers.get('upload-offset')),
    length: r.headers.get('upload-length') === null ? null : Number(r.headers.get('upload-length')),
    complete: r.headers.get('upload-complete'),
  };
}

function refreshUrl(url) {
  const u = new URL(url);
  return `${srv.baseUrl}/storage/refresh${u.pathname.slice('/storage'.length)}${u.search}`;
}

test('a chunked upload reports progress and assembles the exact file', async () => {
  const p = `/updates/${newId()}`;
  const body = crypto.randomBytes(250_000);
  const url = uploadUrl(p);

  assert.deepEqual(await headUpload(url), { status: 200, offset: 0, length: null, complete: 'false' });

  const r1 = await putChunk(url, body.subarray(0, 100_000), 0, body.length);
  assert.equal(r1.status, 202);
  assert.deepEqual(await r1.json(), { path: p, offset: 100_000, total: 250_000, complete: false });
  assert.deepEqual(await headUpload(url), { status: 200, offset: 100_000, length: 250_000, complete: 'false' });

  assert.equal((await putChunk(url, body.subarray(100_000, 200_000), 100_000, body.length)).status, 202);
  const last = await putChunk(url, body.subarray(200_000), 200_000, body.length);
  assert.equal(last.status, 201);
  assert.deepEqual(await last.json(), { path: p, bytes: 250_000, sha256: sha(body), complete: true });

  assert.equal(sha(await fsp.readFile(onDisk(p))), sha(body));
  assert.deepEqual(await headUpload(url), { status: 200, offset: 250_000, length: 250_000, complete: 'true' });
  const leftovers = (await fsp.readdir(path.dirname(onDisk(p)))).filter((n) => n.includes(path.basename(p)) && n.startsWith('.'));
  assert.deepEqual(leftovers, []);
});

test('a chunk at the wrong offset is refused with the offset to continue from', async () => {
  const p = `/updates/${newId()}`;
  const body = crypto.randomBytes(30_000);
  const url = uploadUrl(p);
  await putChunk(url, body.subarray(0, 10_000), 0, body.length);

  const skip = await putChunk(url, body.subarray(20_000), 20_000, body.length);
  assert.equal(skip.status, 409);
  assert.equal(skip.headers.get('upload-offset'), '10000');

  const repeat = await putChunk(url, body.subarray(0, 10_000), 0, body.length);
  assert.equal(repeat.status, 409);
  assert.equal(repeat.headers.get('upload-offset'), '10000');

  assert.equal((await putChunk(url, body.subarray(10_000), 10_000, body.length)).status, 201);
  assert.equal(sha(await fsp.readFile(onDisk(p))), sha(body));
});

test('an interrupted chunk keeps the bytes that arrived, and the upload continues from there', async () => {
  const p = `/updates/${newId()}`;
  const body = crypto.randomBytes(200_000);
  const url = uploadUrl(p);

  const ac = new AbortController();
  const partial = new ReadableStream({
    start(controller) {
      controller.enqueue(body.subarray(0, 120_000));
    },
  });
  const interrupted = fetch(url, {
    method: 'PUT',
    body: partial,
    duplex: 'half',
    headers: { 'content-range': `bytes 0-199999/200000` },
    signal: ac.signal,
  }).catch((err) => err);
  await sleep(300);
  ac.abort();
  await interrupted;

  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await headUpload(url);
    if (status.offset === 120_000) break;
    await sleep(50);
  }
  assert.equal(status.offset, 120_000);
  assert.equal(status.length, 200_000);

  const rest = await putChunk(url, body.subarray(status.offset), status.offset, body.length);
  assert.equal(rest.status, 201);
  assert.equal((await rest.json()).sha256, sha(body));
});

test('an expired upload URL can be refreshed and the upload continues without restarting', async () => {
  const p = `/updates/${newId()}`;
  const body = crypto.randomBytes(60_000);
  const url = uploadUrl(p, { ttlSeconds: 1 });

  assert.equal((await putChunk(url, body.subarray(0, 30_000), 0, body.length)).status, 202);
  await sleep(1200);
  assert.equal((await putChunk(url, body.subarray(30_000), 30_000, body.length)).status, 403);

  const refreshed = await fetch(refreshUrl(url), { method: 'POST' });
  assert.equal(refreshed.status, 200);
  const { url: fresh, method, expiresAt, refreshUntil } = await refreshed.json();
  assert.equal(method, 'PUT');
  assert.ok(new Date(expiresAt) > new Date());
  assert.ok(new Date(refreshUntil) >= new Date(expiresAt));

  const freshUrl = `${srv.baseUrl}${new URL(fresh).pathname}${new URL(fresh).search}`;
  assert.equal((await headUpload(freshUrl)).offset, 30_000);
  const done = await putChunk(freshUrl, body.subarray(30_000), 30_000, body.length);
  assert.equal(done.status, 201);
  assert.equal((await done.json()).sha256, sha(body));
});

test('a refreshed URL keeps its size limit', async () => {
  const p = `/updates/${newId()}`;
  const url = uploadUrl(p, { maxBytes: 1000, ttlSeconds: 1 });
  await sleep(1100);
  const { url: fresh } = await (await fetch(refreshUrl(url), { method: 'POST' })).json();
  assert.equal(new URL(fresh).searchParams.get('max'), '1000');
  const freshUrl = `${srv.baseUrl}${new URL(fresh).pathname}${new URL(fresh).search}`;
  assert.equal((await putChunk(freshUrl, Buffer.alloc(10), 0, 5000)).status, 413);
});

test('refresh refuses tampered URLs and URLs past their maximum lifetime', async () => {
  const p = `/updates/${newId()}`;
  const tampered = uploadUrl(p, { maxBytes: 10 }).replace('max=10', 'max=999999');
  assert.equal((await fetch(refreshUrl(tampered), { method: 'POST' })).status, 403);

  const ancient = uploadUrl(p, { issuedAt: Date.now() - (config.signedUrl.maxLifetimeSeconds + 60) * 1000 });
  assert.equal((await fetch(refreshUrl(ancient), { method: 'POST' })).status, 410);
});

test('chunked uploads enforce the declared total, the size limit and the chunk length', async () => {
  const p = `/updates/${newId()}`;
  const url = uploadUrl(p);
  await putChunk(url, Buffer.alloc(1000), 0, 5000);

  const otherTotal = await putChunk(url, Buffer.alloc(1000), 1000, 9000);
  assert.equal(otherTotal.status, 409);
  assert.equal(otherTotal.headers.get('upload-length'), '5000');

  assert.equal((await putChunk(uploadUrl(`/updates/${newId()}`), Buffer.alloc(10), 0, 2 * MB)).status, 413);

  const tooLong = await fetch(url, { method: 'PUT', body: Buffer.alloc(3000), headers: { 'content-range': 'bytes 1000-1999/5000' } });
  assert.equal(tooLong.status, 400);
  assert.equal((await headUpload(url)).offset, 1000);

  const bad = await fetch(url, { method: 'PUT', body: Buffer.alloc(10), headers: { 'content-range': 'bytes nonsense' } });
  assert.equal(bad.status, 400);
});

test('a chunked upload cannot replace an existing object without overwrite permission', async () => {
  const p = `/updates/${newId()}`;
  await fetch(uploadUrl(p), { method: 'PUT', body: Buffer.from('existing') });
  const res = await putChunk(uploadUrl(p), Buffer.alloc(10), 0, 10);
  assert.equal(res.status, 409);
  assert.equal((await fsp.readFile(onDisk(p))).toString(), 'existing');
});

test('two chunks sent at once for the same offset: one is accepted, the other is told where to continue', async () => {
  const p = `/updates/${newId()}`;
  const url = uploadUrl(p);
  const body = crypto.randomBytes(40_000);
  const [a, b] = await Promise.all([
    putChunk(url, body.subarray(0, 20_000), 0, body.length),
    putChunk(url, body.subarray(0, 20_000), 0, body.length),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409]);
  assert.equal((await headUpload(url)).offset, 20_000);
});

test('downloads support byte ranges', async () => {
  const p = `/models/${1 + Math.floor(Math.random() * 1e9)}`;
  const body = crypto.randomBytes(10_000);
  await fetch(uploadUrl(p), { method: 'PUT', body });
  const url = downloadUrl(p);

  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10000');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');

  const first = await fetch(url, { headers: { range: 'bytes=0-999' } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-range'), 'bytes 0-999/10000');
  assert.equal(sha(Buffer.from(await first.arrayBuffer())), sha(body.subarray(0, 1000)));

  const tail = await fetch(url, { headers: { range: 'bytes=9000-' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 9000-9999/10000');
  assert.equal(sha(Buffer.from(await tail.arrayBuffer())), sha(body.subarray(9000)));

  const suffix = await fetch(url, { headers: { range: 'bytes=-100' } });
  assert.equal(sha(Buffer.from(await suffix.arrayBuffer())), sha(body.subarray(9900)));

  const outside = await fetch(url, { headers: { range: 'bytes=20000-' } });
  assert.equal(outside.status, 416);
  assert.equal(outside.headers.get('content-range'), 'bytes */10000');
});

test('an interrupted download resumes from where it stopped, even after its URL expired', async () => {
  const p = `/models/${1 + Math.floor(Math.random() * 1e9)}`;
  const body = crypto.randomBytes(50_000);
  await fetch(uploadUrl(p), { method: 'PUT', body });
  const url = downloadUrl(p, { ttlSeconds: 1 });

  const part = Buffer.from(await (await fetch(url, { headers: { range: 'bytes=0-19999' } })).arrayBuffer());
  await sleep(1200);
  assert.equal((await fetch(url, { headers: { range: `bytes=${part.length}-` } })).status, 403);

  const refreshed = await fetch(refreshUrl(url), { method: 'POST' });
  assert.equal(refreshed.status, 200);
  const { url: fresh, method } = await refreshed.json();
  assert.equal(method, 'GET');
  const freshUrl = `${srv.baseUrl}${new URL(fresh).pathname}${new URL(fresh).search}`;

  const restRes = await fetch(freshUrl, { headers: { range: `bytes=${part.length}-` } });
  assert.equal(restRes.status, 206);
  const rest = Buffer.from(await restRes.arrayBuffer());
  assert.equal(sha(Buffer.concat([part, rest])), sha(body));
});

test('abandoned uploads are removed after UPLOAD_PARTIAL_TTL_SECONDS', async () => {
  const p = `/updates/${newId()}`;
  const url = uploadUrl(p);
  await putChunk(url, Buffer.alloc(500), 0, 1000);
  const name = path.basename(p);
  const partials = async () => (await fsp.readdir(path.dirname(onDisk(p)))).filter((n) => n.includes(name));
  assert.equal((await partials()).length, 2);

  await sleep(2800);
  assert.deepEqual(await partials(), []);
  assert.deepEqual(await headUpload(url), { status: 200, offset: 0, length: null, complete: 'false' });
});
