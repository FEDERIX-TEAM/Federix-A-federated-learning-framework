const mongoose = require('mongoose');
const config = require('../config');
const { logEvent } = require('../utils/auditLog');

const START_TIME = Date.now();
const pkg = require('../../package.json');

async function systemRoutes(fastify) {
  // GET /api/v1/system/health — Public
  fastify.get('/health', async (request, reply) => {
    const dbState = mongoose.connection.readyState; // 1 = connected
    let redisOk = true;
    try {
      await fastify.redis.set('health:ping', '1', 'EX', 5);
    } catch {
      redisOk = false;
    }

    const status = dbState === 1 && redisOk ? 'ok' : 'degraded';

    return reply.send({
      status,
      db: dbState === 1 ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'unavailable',
      fl_server: 'unknown', // real check happens via /api/v1/fl/status polling
      queue_depth: 0,
      uptime_ms: Date.now() - START_TIME,
    });
  });

  // GET /api/v1/system/version — Public
  fastify.get('/version', async (request, reply) => {
    return reply.send({
      api_version: config.buildInfo.apiVersion,
      build: config.buildInfo.build,
      node_version: process.version,
      environment: config.env,
    });
  });

  // GET /api/v1/system/config/public — Public
  fastify.get('/config/public', async (request, reply) => {
    return reply.send({
      supported_sdk_versions: config.supportedSdkVersions,
      server_timezone: config.serverTimezone,
      max_update_size_mb: config.maxUpdateSizeMb,
    });
  });

  // GET /api/v1/system/stats — Super Admin, Admin
  fastify.get(
    '/stats',
    { preHandler: [fastify.authenticate, fastify.authorize(['super_admin', 'admin'])] },
    async (request, reply) => {
      const mem = process.memoryUsage();
      return reply.send({
        active_connections: fastify.server.connections || 0,
        memory_mb: Number((mem.rss / 1024 / 1024).toFixed(1)),
        req_per_min: fastify.requestsLastMinute ? fastify.requestsLastMinute() : 0,
        queue_depth: 0,
        cache_hit_rate: fastify.redis.isMemoryFallback ? 0 : null,
      });
    }
  );

  // POST /api/v1/system/maintenance — Super Admin
  fastify.post(
    '/maintenance',
    { preHandler: [fastify.authenticate, fastify.authorize(['super_admin'])] },
    async (request, reply) => {
      const { enabled, message = '', estimated_duration_minutes = null } = request.body || {};
      if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'enabled (boolean) is required' });

      if (enabled) {
        await fastify.redis.set('system:maintenance', JSON.stringify({ message, estimated_duration_minutes }), 'EX', 86400);
      } else {
        await fastify.redis.del('system:maintenance');
      }

      fastify.wsBroadcast('system:maintenance', { enabled, message }, 'all');
      await logEvent({ actor: request.user.sub, eventType: 'system.maintenance_toggled', details: { enabled, message } });

      return reply.send({ maintenance_mode: enabled, message });
    }
  );

  // DELETE /api/v1/system/cache/flush — Super Admin
  fastify.delete(
    '/cache/flush',
    { preHandler: [fastify.authenticate, fastify.authorize(['super_admin'])] },
    async (request, reply) => {
      const flushed_keys = await fastify.redis.flushall();
      await logEvent({ actor: request.user.sub, eventType: 'system.cache_flushed', details: {} });

      return reply.send({
        flushed_keys,
        warning: 'All active JWT sessions were invalidated. All clients must re-login.',
      });
    }
  );
}

module.exports = systemRoutes;
