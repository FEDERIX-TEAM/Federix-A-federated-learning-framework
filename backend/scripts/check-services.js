import mongoose from 'mongoose';
import Redis from 'ioredis';
import { config } from '../config/index.js';

const TIMEOUT_MS = 3000;

async function checkMongo() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: TIMEOUT_MS });
    await mongoose.connection.db.admin().ping();
    return null;
  } catch (err) {
    return `MongoDB is not reachable at ${config.mongoUri} (${err.message})`;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function checkRedis() {
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
    connectTimeout: TIMEOUT_MS,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return null;
  } catch (err) {
    return `Redis is not reachable at ${config.redisUrl} (${err.message})`;
  } finally {
    client.disconnect();
  }
}

const failures = (await Promise.all([checkMongo(), checkRedis()])).filter(Boolean);

if (failures.length) {
  console.error('\nRequired services are not running:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nStart them first, from the backend folder:\n\n  docker compose up -d mongo redis\n');
  process.exit(1);
}

console.log('MongoDB and Redis are reachable.');
