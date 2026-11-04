import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import mongoose from 'mongoose';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { cors as connectCors } from '@connectrpc/connect';

import { config } from '../config/index.js';
import { connectMongo, createRedisClient } from '../db.js';
import { buildInterceptors } from './interceptors.js';
import { registerStorageRoute } from './storage.js';
import { startHeartbeatWatcher } from './heartbeatWatcher.js';
import { getActiveConfig } from './lib/helpers.js';

import { AuthService } from './gen/auth_pb.js';
import { ClientService } from './gen/client_pb.js';
import { AdminService } from './gen/admin_pb.js';
import { SystemService } from './gen/system_pb.js';
import { FlBridgeService } from './gen/fl_bridge_pb.js';
import { EventStreamService } from './gen/events_pb.js';

import { createAuthService } from './services/auth.service.js';
import { createClientService } from './services/client.service.js';
import { createAdminService } from './services/admin.service.js';
import { createSystemService } from './services/system.service.js';
import { createFlBridgeService } from './services/flBridge.service.js';
import { createEventService } from './services/events.service.js';

// Transport:
//   default            HTTP/1.1  -> Connect protocol (curl, browsers, connect-web/node). Native gRPC needs HTTP/2.
//   HTTP2=true         HTTP/2 cleartext (h2c) -> native gRPC clients (grpcio, grpc-java, grpcurl -plaintext) work.
//   TLS_KEY + TLS_CERT HTTP/2 over TLS with HTTP/1.1 fallback (recommended for production).
function buildServerOptions() {
  const base = { logger: { level: process.env.LOG_LEVEL || 'info' } };
  if (process.env.TLS_KEY && process.env.TLS_CERT) {
    return {
      ...base,
      http2: true,
      https: { allowHTTP1: true, key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) },
    };
  }
  if (process.env.HTTP2 === 'true') return { ...base, http2: true };
  return base;
}

async function main() {
  const app = Fastify(buildServerOptions());
  const logger = app.log;

  await connectMongo(logger);
  const redis = await createRedisClient(logger);

  try {
    await getActiveConfig(); // make sure the singleton config exists
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not verify default SystemConfig (DB unreachable?) — it is created lazily on first use.');
  }

  await app.register(cors, {
    origin: true,
    methods: [...connectCors.allowedMethods],
    allowedHeaders: [...connectCors.allowedHeaders, 'authorization', 'x-internal-service-token'],
    exposedHeaders: [...connectCors.exposedHeaders],
    maxAge: 7200,
  });

  // Defence-in-depth for the FL bridge: when the shared internal token is presented, the caller's IP must
  // also be allow-listed (FL_SERVER_ALLOWED_IPS). The token itself is checked by the access-control interceptor.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/federix.v1.FlBridgeService/')) return;
    if (!request.headers['x-internal-service-token']) return; // no token -> interceptor decides (JWT or reject)
    const ip = (request.ip || '').replace('::ffff:', '');
    if (config.flServerIps.length && !config.flServerIps.includes(ip) && !config.flServerIps.includes(request.ip)) {
      request.log.warn({ ip }, 'FlBridgeService call from non-allow-listed IP');
      return reply.code(403).send({ code: 'permission_denied', message: 'Request origin not permitted for internal routes' });
    }
  });

  await app.register(fastifyConnectPlugin, {
    interceptors: buildInterceptors({ redis, logger }),
    routes: (router) => {
      router.service(AuthService, createAuthService({ redis }));
      router.service(ClientService, createClientService());
      router.service(AdminService, createAdminService());
      router.service(SystemService, createSystemService({ redis }));
      router.service(FlBridgeService, createFlBridgeService());
      router.service(EventStreamService, createEventService());
    },
  });

  registerStorageRoute(app);
  const stopHeartbeatWatcher = startHeartbeatWatcher(logger);

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    stopHeartbeatWatcher();
    // Long-lived Subscribe streams never end on their own; don't wait on them.
    setTimeout(() => process.exit(0), 5000).unref();
    try {
      await app.close();
      await mongoose.disconnect();
      await redis.quit();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
