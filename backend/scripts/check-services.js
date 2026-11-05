import mongoose from 'mongoose';
import Redis from 'ioredis';
import { config, configProblems } from '../config/index.js';

const TIMEOUT_MS = config.db.connectTimeoutMs;

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

const invalid = configProblems();
if (invalid.length) {
  console.error('\nInvalid configuration:\n');
  for (const p of invalid) console.error(`  - ${p}`);
  console.error('\nFix these in .env or the environment, then try again.\n');
  process.exit(1);
}

const failures = (await Promise.all([checkMongo(), checkRedis()])).filter(Boolean);

if (failures.length) {
  console.error('\nRequired services are not running:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nStart them first, from the backend folder:\n\n  docker compose up -d mongo redis\n');
  process.exit(1);
}

console.log('MongoDB and Redis are reachable.');
