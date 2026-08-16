import mongoose from 'mongoose';
import Redis from 'ioredis';
import { config } from './config/index.js';

export async function connectMongo(logger) {
  mongoose.set('strictQuery', true);
  mongoose.set('bufferCommands', false); // fail fast instead of buffering ops while disconnected

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    logger.info(`MongoDB connected: ${config.mongoUri}`);
  } catch (err) {
    logger.warn({ err: err.message }, 'MongoDB connection failed — server continues, DB calls will fail until it recovers.');
  }

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
}

function createMemoryRedis(logger) {
  logger.warn('Falling back to in-memory Redis stub — sessions/blacklist will NOT persist across restarts and will NOT work across multiple server instances.');

  const store = new Map();
  const isExpired = (entry) => entry.expiresAt !== null && entry.expiresAt <= Date.now();

  return {
    isMemoryFallback: true,
    async set(key, value, mode, ttlSeconds) {
      const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async exists(key) {
      const entry = store.get(key);
      if (!entry) return 0;
      if (isExpired(entry)) {
        store.delete(key);
        return 0;
      }
      return 1;
    },
    async flushall() {
      const count = store.size;
      store.clear();
      return count;
    },
    async quit() {
      store.clear();
    },
  };
}

export async function createRedisClient(logger) {
  try {
    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    await client.connect();
    logger.info(`Redis connected: ${config.redisUrl}`);
    return client;
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis connection failed');
    return createMemoryRedis(logger);
  }
}
