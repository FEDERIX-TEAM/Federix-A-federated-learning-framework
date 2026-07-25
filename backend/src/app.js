const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');

const mongoosePlugin = require('./plugins/mongoose');
const redisPlugin = require('./plugins/redis');
const authPlugin = require('./plugins/auth');
const maintenancePlugin = require('./plugins/maintenance');
const websocketPlugin = require('./plugins/websocket');

const authRoutes = require('./routes/auth.routes');
const clientRoutes = require('./routes/client.routes');
const flRoutes = require('./routes/fl.routes');
const adminRoutes = require('./routes/admin.routes');
const systemRoutes = require('./routes/system.routes');

function buildApp(opts = {}) {
  const app = fastify({ logger: opts.logger ?? true });

  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.register(mongoosePlugin);
  app.register(redisPlugin);
  app.register(authPlugin);
  app.register(maintenancePlugin);
  app.register(websocketPlugin);

  app.register(authRoutes, { prefix: '/api/v1/auth' });

  app.register(
    async (instance) => {
      instance.addHook('preHandler', instance.checkMaintenance);
      instance.register(clientRoutes);
    },
    { prefix: '/api/v1/client' }
  );

  app.register(
    async (instance) => {
      instance.addHook('preHandler', instance.checkMaintenance);
      instance.register(flRoutes);
    },
    { prefix: '/api/v1/fl' }
  );

  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(systemRoutes, { prefix: '/api/v1/system' });

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    const statusCode = err.statusCode || 500;
    reply.code(statusCode).send({ error: statusCode === 500 ? 'Internal server error' : err.message });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}

module.exports = buildApp;
