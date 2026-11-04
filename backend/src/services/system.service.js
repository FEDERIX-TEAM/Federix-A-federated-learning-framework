import mongoose from 'mongoose';
import { config } from '../../config/index.js';
import { logEvent } from '../../utils/auditLog.js';
import { authOf } from '../lib/helpers.js';
import { invalidArg } from '../lib/errors.js';
import { publish, subscriberCount, ALL } from '../lib/events.js';
import { requestsLastMinute } from '../lib/metrics.js';

const START_TIME = Date.now();

export function createSystemService({ redis }) {
  return {
    async healthCheck() {
      const dbOk = mongoose.connection.readyState === 1;
      let redisState = redis.isMemoryFallback ? 'memory-fallback' : 'connected';
      try {
        await redis.set('health:ping', '1', 'EX', 5);
      } catch {
        redisState = 'unavailable';
      }

      return {
        status: dbOk && redisState !== 'unavailable' ? 'ok' : 'degraded',
        db: dbOk ? 'connected' : 'disconnected',
        redis: redisState,
        flServer: 'unknown', // the FL server is a client of this service; it is not probed from here
        queueDepth: 0,
        uptimeMs: BigInt(Date.now() - START_TIME),
      };
    },

    async getVersion() {
      return {
        apiVersion: config.buildInfo.apiVersion,
        build: config.buildInfo.build,
        nodeVersion: process.version,
        environment: config.env,
      };
    },

    async getPublicConfig() {
      return {
        supportedSdkVersions: config.supportedSdkVersions,
        serverTimezone: config.serverTimezone,
        maxUpdateSizeMb: config.maxUpdateSizeMb,
      };
    },

    async getStats() {
      return {
        activeConnections: subscriberCount(),
        memoryMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
        reqPerMin: requestsLastMinute(),
        queueDepth: 0,
        cacheHitRate: 0, // not tracked
      };
    },

    async setMaintenance(req, ctx) {
      const { enabled, message } = req;
      if (typeof enabled !== 'boolean') throw invalidArg('enabled is required');

      if (enabled) {
        const details = { message, estimated_duration_minutes: req.estimatedDurationMinutes ?? null };
        // Auto-expires after 24h as a safety net so a forgotten flag can't lock clients out forever.
        await redis.set('system:maintenance', JSON.stringify(details), 'EX', 86400);
      } else {
        await redis.del('system:maintenance');
      }

      publish('system_maintenance', { enabled, message }, ALL);
      await logEvent({ actor: authOf(ctx).sub, eventType: 'system.maintenance_toggled', details: { enabled, message } });

      return { maintenanceMode: enabled, message };
    },

    async flushCache(_req, ctx) {
      let flushed;
      if (redis.isMemoryFallback) {
        flushed = await redis.flushall(); // stub returns the key count
      } else {
        flushed = await redis.dbsize();
        await redis.flushall();
      }
      await logEvent({ actor: authOf(ctx).sub, eventType: 'system.cache_flushed', details: { flushed } });

      return {
        flushedKeys: flushed,
        warning:
          'Redis was flushed: the logout blacklist and maintenance flag were cleared. ' +
          'Previously logged-out access tokens become valid again until they expire.',
      };
    },
  };
}
