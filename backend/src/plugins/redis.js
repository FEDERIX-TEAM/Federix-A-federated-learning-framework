const fp = require('fastify-plugin');
const Redis = require('ioredis');
const config = require('../config');

/**
 * Minimal in-memory stand-in for the Redis client interface we use
 * (get/set/del/exists/flushall + TTL semantics). Used only when a real
 * Redis instance isn't reachable, so the server stays runnable in dev.
 */
function createMemoryRedis(logger) {
  logger.warn('Falling back to in-memory Redis stub — sessions/blacklist will NOT persist across restarts and will NOT work across multiple server instances.');

  const store = new Map(); // key -> { value, expiresAt }

  function isExpired(entry) {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  return {
    isMemoryFallback: true,
    async set(key, value, mode, ttlSeconds) {
      let expiresAt = null;
      if (mode === 'EX' && ttlSeconds) expiresAt = Date.now() + ttlSeconds * 1000;
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

async function redisPlugin(fastify) {
  let client;

  try {
    client = new Redis(config.redisUrl, {
      lazyConnect: true,
      retryStrategy: () => null, // don't keep retrying forever in dev
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    await client.connect();
    fastify.log.info(`Redis connected: ${config.redisUrl}`);
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Redis connection failed');
    client = createMemoryRedis(fastify.log);
  }

  fastify.decorate('redis', client);

  fastify.addHook('onClose', async () => {
    try {
      await client.quit();
    } catch {
      // already closed / never connected
    }
  });
}

module.exports = fp(redisPlugin, { name: 'redis-plugin' });
