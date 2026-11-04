import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../utils/signedUrl.js';

/**
 * Serves files behind the HMAC-signed URLs produced by utils/signedUrl.js
 * (/storage/models/<version>, /storage/updates/<update_id>).
 * Files are read from STORAGE_DIR (default ./storage). This is a local stand-in for S3/GCS:
 * swap utils/signedUrl.js for real presigned URLs in production and delete this route.
 */
export function registerStorageRoute(app, rootDir = process.env.STORAGE_DIR || './storage') {
  const root = path.resolve(rootDir);

  app.get('/storage/*', async (request, reply) => {
    const resourcePath = `/${request.params['*']}`;
    const { expires, sig } = request.query;

    if (!verify(resourcePath, expires, sig)) {
      return reply.code(403).send({ error: 'Invalid or expired signature' });
    }

    const file = path.resolve(root, `.${resourcePath}`);
    if (!file.startsWith(root + path.sep)) return reply.code(400).send({ error: 'Bad path' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(404).send({ error: 'File not found' });

    return reply.type('application/octet-stream').send(fs.createReadStream(file));
  });
}
