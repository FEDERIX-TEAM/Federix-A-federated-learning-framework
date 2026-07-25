const fp = require('fastify-plugin');

async function maintenancePlugin(fastify) {
  fastify.decorate('checkMaintenance', async function checkMaintenance(request, reply) {
    const raw = await fastify.redis.get('system:maintenance');
    if (!raw) return;

    let details = {};
    try {
      details = JSON.parse(raw);
    } catch {
      // ignore malformed stored value
    }

    return reply.code(503).send({
      error: 'Service is in maintenance mode',
      message: details.message || 'Please try again later',
      estimated_duration_minutes: details.estimated_duration_minutes ?? null,
    });
  });
}

module.exports = fp(maintenancePlugin, { name: 'maintenance-plugin', dependencies: ['redis-plugin'] });
