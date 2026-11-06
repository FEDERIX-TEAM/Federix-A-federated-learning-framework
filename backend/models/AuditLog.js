import mongoose from 'mongoose';

const RETENTION_INDEX = 'audit_retention';
const DAY_SECONDS = 86400;

const auditLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  level: { type: String, enum: ['info', 'warn', 'error'], default: 'info', index: true },
  actor: { type: String, required: true, index: true },
  event_type: { type: String, required: true, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
});

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

async function currentIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (err) {
    if (err.codeName === 'NamespaceNotFound' || err.code === 26) return [];
    throw err;
  }
}

export async function ensureAuditRetention(days) {
  const collection = AuditLog.collection;
  const indexes = await currentIndexes(collection);
  if (indexes.some((i) => i.name === 'timestamp_1')) await collection.dropIndex('timestamp_1');

  const current = indexes.find((i) => i.name === RETENTION_INDEX);
  const wantTtl = days > 0;
  const seconds = days * DAY_SECONDS;
  const hasTtl = current?.expireAfterSeconds !== undefined;

  if (current && hasTtl !== wantTtl) {
    await collection.dropIndex(RETENTION_INDEX);
  } else if (current && wantTtl && current.expireAfterSeconds !== seconds) {
    await mongoose.connection.db.command({ collMod: collection.collectionName, index: { name: RETENTION_INDEX, expireAfterSeconds: seconds } });
    return;
  } else if (current) {
    return;
  }
  await collection.createIndex({ timestamp: 1 }, wantTtl ? { name: RETENTION_INDEX, expireAfterSeconds: seconds } : { name: RETENTION_INDEX });
}
