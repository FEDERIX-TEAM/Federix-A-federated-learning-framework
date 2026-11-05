import mongoose from 'mongoose';
import Redis from 'ioredis';
import { config } from './config/index.js';

export async function connectMongo(logger) {
  mongoose.set('strictQuery', true);
  mongoose.set('bufferCommands', false);

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: config.db.connectTimeoutMs });
  } catch (err) {
    throw new Error(`MongoDB is not reachable at ${config.mongoUri}: ${err.message}`);
  }
  logger.info(`MongoDB connected: ${config.mongoUri}`);

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected; the driver will keep retrying'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
}

export const redisBackoff = (attempt) => Math.min(attempt * config.db.redisBackoffStepMs, config.db.redisMaxBackoffMs);

export async function createRedisClient(logger) {
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    connectTimeout: config.db.connectTimeoutMs,
    maxRetriesPerRequest: config.db.redisMaxRetriesPerRequest,
    retryStrategy: redisBackoff,
  });

  let lastError = null;
  client.on('error', (err) => {
    if (err.message !== lastError) logger.warn({ err: err.message }, 'Redis error');
    lastError = err.message;
  });
  client.on('reconnecting', (ms) => logger.warn(`Redis reconnecting in ${ms}ms`));
  client.on('ready', () => {
    if (lastError) logger.info('Redis connection restored');
    lastError = null;
  });

  try {
    await client.connect();
    await client.ping();
  } catch (err) {
    client.disconnect();
    throw new Error(`Redis is not reachable at ${config.redisUrl}: ${err.message}`);
  }
  logger.info(`Redis connected: ${config.redisUrl}`);
  return client;
}
