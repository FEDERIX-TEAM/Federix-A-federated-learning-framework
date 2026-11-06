import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verify, refresh, methodOf, STORAGE_PREFIX } from '../utils/signedUrl.js';
import { config } from '../config/index.js';

const RESOURCE_PATH = /^\/(models|updates)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const RANGE = /^bytes=(\d*)-(\d*)$/;
const PARTIAL = '.partial-';
const TEMP = '.upload-';
const MB = 1024 * 1024;

export const isValidResourcePath = (p) => typeof p === 'string' && RESOURCE_PATH.test(p) && !p.includes('..');

export function maxBytesFor(resourcePath) {
  const mb = resourcePath.startsWith('/models/') ? config.limits.maxModelSizeMb : config.limits.maxUpdateSizeMb;
  return mb * MB;
}

class StorageError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function sizeOf(file) {
  try {
    const s = await fsp.stat(file);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

function meter(limit, onBytes) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _enc, done) {
      bytes += chunk.length;
      if (bytes > limit) {
        done(new StorageError(413, `Upload exceeds the ${limit} byte limit`));
        return;
      }
      onBytes?.(chunk);
      done(null, chunk);
    },
  });
}

export function createStorage(rootDir = config.storage.dir) {
  const root = path.resolve(rootDir);
  const locks = new Map();

  async function withLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const chained = previous.then(() => mine);
    locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chained) locks.delete(key);
    }
  }

  function fileFor(resourcePath) {
    if (!isValidResourcePath(resourcePath)) return null;
    const file = path.resolve(root, `.${resourcePath}`);
    return file.startsWith(root + path.sep) ? file : null;
  }

  function partsFor(file) {
    const dir = path.dirname(file);
    const name = path.basename(file);
    return { data: path.join(dir, `${PARTIAL}${name}`), meta: path.join(dir, `${PARTIAL}${name}.json`) };
  }

  async function readMeta(metaFile) {
    try {
      return JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async function place(source, file, overwrite) {
    try {
      if (overwrite) {
        await fsp.rename(source, file);
      } else {
        await fsp.link(source, file);
        await fsp.rm(source, { force: true });
      }
    } catch (err) {
      await fsp.rm(source, { force: true });
      if (err.code === 'EEXIST') throw new StorageError(409, 'Object already exists and may not be overwritten');
      throw err;
    }
  }

  async function stat(resourcePath) {
    const file = fileFor(resourcePath);
    if (!file) return null;
    const bytes = await sizeOf(file);
    return bytes === null ? null : { file, bytes };
  }

  async function remove(resourcePath) {
    const file = fileFor(resourcePath);
    if (!file) return false;
    const { data, meta } = partsFor(file);
    await Promise.all([fsp.rm(data, { force: true }), fsp.rm(meta, { force: true })]);
    try {
      await fsp.unlink(file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  async function write(resourcePath, source, { maxBytes, overwrite }) {
    const file = fileFor(resourcePath);
    if (!file) throw new StorageError(400, 'Bad path');
    const limit = Math.min(maxBytes, maxBytesFor(resourcePath));
    await fsp.mkdir(path.dirname(file), { recursive: true });

    const temp = path.join(path.dirname(file), `${TEMP}${crypto.randomUUID()}`);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(source, meter(limit, (c) => { bytes += c.length; hash.update(c); }), fs.createWriteStream(temp, { flags: 'wx' }));
    } catch (err) {
      await fsp.rm(temp, { force: true });
      throw err;
    }
    await place(temp, file, overwrite);
    return { path: resourcePath, bytes, sha256: hash.digest('hex'), complete: true };
  }

  async function uploadStatus(resourcePath) {
    const file = fileFor(resourcePath);
    if (!file) throw new StorageError(400, 'Bad path');
    const { data, meta } = partsFor(file);
    const pending = await readMeta(meta);
    if (pending) return { offset: (await sizeOf(data)) ?? 0, total: pending.total, complete: false };
    const done = await sizeOf(file);
    if (done !== null) return { offset: done, total: done, complete: true };
    return { offset: 0, total: null, complete: false };
  }

  async function writeChunk(resourcePath, source, { maxBytes, overwrite }, range) {
    const file = fileFor(resourcePath);
    if (!file) throw new StorageError(400, 'Bad path');
    const { start, end, total } = range;
    const limit = Math.min(maxBytes, maxBytesFor(resourcePath));
    if (total > limit) throw new StorageError(413, `Upload exceeds the ${limit} byte limit`);
    if (end < start || end >= total) throw new StorageError(400, 'Content-Range is not valid');

    return withLock(file, async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const { data, meta } = partsFor(file);
      let pending = await readMeta(meta);

      if (!pending) {
        if (!overwrite && (await sizeOf(file)) !== null) throw new StorageError(409, 'Object already exists and may not be overwritten');
        if (start !== 0) throw new StorageError(409, 'No upload in progress; start at byte 0', { 'upload-offset': '0' });
        pending = { total, overwrite, startedAt: Date.now() };
        await fsp.writeFile(data, '');
        await fsp.writeFile(meta, JSON.stringify(pending));
      }
      if (pending.total !== total) {
        throw new StorageError(409, `An upload of ${pending.total} bytes is already in progress`, { 'upload-length': String(pending.total) });
      }

      const offset = (await sizeOf(data)) ?? 0;
      if (start !== offset) {
        throw new StorageError(409, `Upload must continue at byte ${offset}`, { 'upload-offset': String(offset) });
      }

      const chunkLength = end - start + 1;
      try {
        await pipeline(source, meter(chunkLength), fs.createWriteStream(data, { flags: 'a' }));
      } catch (err) {
        if (err instanceof StorageError) {
          await fsp.truncate(data, offset);
          throw new StorageError(400, `Chunk is longer than its Content-Range (${chunkLength} bytes)`);
        }
        throw err;
      }

      const received = (await sizeOf(data)) ?? 0;
      if (received < total) return { path: resourcePath, offset: received, total, complete: false };

      const sha256 = await sha256Of(data);
      await place(data, file, pending.overwrite);
      await fsp.rm(meta, { force: true });
      return { path: resourcePath, bytes: total, sha256, complete: true };
    });
  }

  async function sweep(maxAgeMs = config.storage.partialTtlSeconds * 1000, now = Date.now()) {
    let removed = 0;
    for (const dir of ['models', 'updates']) {
      let names = [];
      try {
        names = await fsp.readdir(path.join(root, dir));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.startsWith(PARTIAL) && !name.startsWith(TEMP)) continue;
        if (name.endsWith('.json')) continue;
        const full = path.join(root, dir, name);
        let mtime;
        try {
          mtime = (await fsp.stat(full)).mtimeMs;
        } catch {
          continue;
        }
        if (now - mtime < maxAgeMs) continue;
        await fsp.rm(full, { force: true });
        if (name.startsWith(PARTIAL)) await fsp.rm(`${full}.json`, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  async function digest(resourcePath) {
    const found = await stat(resourcePath);
    if (!found) return null;
    return { bytes: found.bytes, sha256: await sha256Of(found.file) };
  }

  return { root, fileFor, stat, digest, remove, write, writeChunk, uploadStatus, sweep };
}

export const storage = createStorage();

function parseContentRange(header) {
  if (header === undefined) return null;
  const m = CONTENT_RANGE.exec(String(header).trim());
  if (!m) throw new StorageError(400, 'Content-Range must look like "bytes start-end/total"');
  return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
}

function parseRange(header, size) {
  const m = RANGE.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

function rejectEarly(request, reply, status, body, headers = {}) {
  request.raw.resume();
  return reply.code(status).headers({ connection: 'close', ...headers }).send(body);
}

export function registerStorageRoute(app, store = storage, { onStored } = {}) {
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    scope.route({
      method: 'GET',
      url: `${STORAGE_PREFIX}/*`,
      exposeHeadRoute: false,
      handler: async (request, reply) => {
        const resourcePath = `/${request.params['*']}`;
        if (!verify(resourcePath, request.query, 'GET')) return reply.code(403).send({ error: 'Invalid or expired signature' });
        const found = await store.stat(resourcePath);
        if (!found) return reply.code(404).send({ error: 'File not found' });

        reply.header('accept-ranges', 'bytes');
        if (request.headers.range === undefined) {
          return reply.type('application/octet-stream').header('content-length', found.bytes).send(fs.createReadStream(found.file));
        }
        const range = parseRange(request.headers.range, found.bytes);
        if (range === 'invalid') {
          return reply.code(416).header('content-range', `bytes */${found.bytes}`).send({ error: 'Range not satisfiable' });
        }
        return reply
          .code(206)
          .type('application/octet-stream')
          .header('content-range', `bytes ${range.start}-${range.end}/${found.bytes}`)
          .header('content-length', range.end - range.start + 1)
          .send(fs.createReadStream(found.file, { start: range.start, end: range.end }));
      },
    });

    scope.head(`${STORAGE_PREFIX}/*`, async (request, reply) => {
      const resourcePath = `/${request.params['*']}`;
      const method = methodOf(request.query);
      if (!verify(resourcePath, request.query, method)) return reply.code(403).send();

      if (method === 'GET') {
        const found = await store.stat(resourcePath);
        if (!found) return reply.code(404).send();
        return reply.headers({ 'content-length': found.bytes, 'accept-ranges': 'bytes' }).send();
      }

      const status = await store.uploadStatus(resourcePath);
      const headers = { 'upload-offset': String(status.offset), 'upload-complete': String(status.complete), 'cache-control': 'no-store' };
      if (status.total !== null) headers['upload-length'] = String(status.total);
      return reply.headers(headers).send();
    });

    scope.put(`${STORAGE_PREFIX}/*`, async (request, reply) => {
      const resourcePath = `/${request.params['*']}`;
      const grant = verify(resourcePath, request.query, 'PUT');
      if (!grant) return rejectEarly(request, reply, 403, { error: 'Invalid or expired signature' });

      try {
        const range = parseContentRange(request.headers['content-range']);
        const source = request.body ?? request.raw;
        let result;
        if (range) {
          result = await store.writeChunk(resourcePath, source, grant, range);
        } else {
          const declared = Number(request.headers['content-length']);
          const limit = Math.min(grant.maxBytes, maxBytesFor(resourcePath));
          if (Number.isFinite(declared) && declared > limit) {
            return rejectEarly(request, reply, 413, { error: `Upload exceeds the ${limit} byte limit` });
          }
          result = await store.write(resourcePath, source, grant);
        }

        if (!result.complete) {
          return reply.code(202).header('upload-offset', String(result.offset)).send(result);
        }
        const stored = { path: result.path, bytes: result.bytes, sha256: result.sha256, complete: true };
        if (onStored) await onStored(stored);
        return reply.code(201).send(stored);
      } catch (err) {
        if (err instanceof StorageError) return rejectEarly(request, reply, err.status, { error: err.message }, err.headers);
        throw err;
      }
    });

    scope.post(`${STORAGE_PREFIX}/refresh/*`, async (request, reply) => {
      request.raw.resume();
      const resourcePath = `/${request.params['*']}`;
      const result = refresh(resourcePath, request.query);
      if (result.error === 'invalid') return reply.code(403).send({ error: 'Invalid signature' });
      if (result.error === 'too_old') return reply.code(410).send({ error: 'This URL can no longer be refreshed; request a new one' });
      const { signed } = result;
      return reply.send({
        url: signed.url,
        method: signed.method,
        expiresAt: signed.expiresAt.toISOString(),
        refreshUntil: signed.refreshUntil.toISOString(),
      });
    });
  });
}

export function startStorageSweeper(logger, store = storage, intervalMs = config.storage.sweepIntervalMs) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const removed = await store.sweep();
      if (removed) logger.info({ removed }, 'removed abandoned uploads');
    } catch (err) {
      logger.error({ err }, 'storage sweep failed');
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
