import { Update } from '../../models/Update.js';

export async function recordStoredObject({ path, bytes, sha256 }) {
  if (!path.startsWith('/updates/')) return;
  await Update.updateOne(
    { upload_path: path, status: 'prepared' },
    { $set: { bytes_uploaded: bytes, sha256, uploaded_at: new Date() } }
  );
}
