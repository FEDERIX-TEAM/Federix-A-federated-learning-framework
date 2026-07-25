const fp = require('fastify-plugin');
const websocketPlugin = require('@fastify/websocket');
const { verifyAccessToken } = require('../utils/jwt');
const wsManager = require('../ws/manager');

async function wsSetup(fastify) {
  await fastify.register(websocketPlugin);

  fastify.get('/api/v1/ws', { websocket: true }, async (socket, request) => {
    const token = request.query?.token;

    if (!token) {
      socket.close(4001, 'missing token');
      return;
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      socket.close(4001, 'invalid token');
      return;
    }

    const blacklisted = await fastify.redis.exists(`blacklist:${decoded.jti}`);
    if (blacklisted) {
      socket.close(4001, 'invalidated token');
      return;
    }

    wsManager.register(socket, decoded);

    socket.send(
      JSON.stringify({
        event: 'connected',
        payload: { role: decoded.role, client_id: decoded.client_id || null },
      })
    );
  });

  fastify.decorate('wsBroadcast', wsManager.broadcast);
  fastify.decorate('wsSendToClient', wsManager.sendToClient);
  fastify.decorate('wsAdminRoles', wsManager.ADMIN_ROOM_ROLES);
  fastify.decorate('wsAllRoles', 'all');
}

module.exports = fp(wsSetup, { name: 'websocket-plugin', dependencies: ['redis-plugin'] });
