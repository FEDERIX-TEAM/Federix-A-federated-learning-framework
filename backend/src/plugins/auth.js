const fp = require('fastify-plugin');
const config = require('../config');
const { verifyAccessToken } = require('../utils/jwt');

async function authPlugin(fastify) {
  // Verifies the Bearer JWT, rejects blacklisted (logged-out) tokens,
  // and attaches `request.user = { id, role, client_id?, jti }`.
  fastify.decorate('authenticate', async function authenticate(request, reply) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing or malformed Authorization header' });
    }

    const token = header.slice('Bearer '.length);

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const blacklisted = await fastify.redis.exists(`blacklist:${decoded.jti}`);
    if (blacklisted) {
      return reply.code(401).send({ error: 'Token has been invalidated' });
    }

    request.user = decoded; // { sub, role, client_id?, jti, iat, exp }
    request.rawToken = token;
  });

  // preHandler factory: fastify.authorize(['admin', 'super_admin'])
  fastify.decorate('authorize', function authorize(allowedRoles) {
    return async function roleGuard(request, reply) {
      if (!request.user) {
        return reply.code(401).send({ error: 'Not authenticated' });
      }
      if (!allowedRoles.includes(request.user.role)) {
        return reply.code(403).send({ error: 'Insufficient role for this resource' });
      }
    };
  });

  // Ensures an authenticated SDK client can only touch its own client_id.
  fastify.decorate('requireOwnClient', function requireOwnClient(getClientId) {
    return async function ownershipGuard(request, reply) {
      if (request.user.role !== 'sdk_client') return; // not applicable to non-client roles
      const targetClientId = getClientId(request);
      if (targetClientId && targetClientId !== request.user.client_id) {
        return reply.code(403).send({ error: 'Cannot access another client\'s resources' });
      }
    };
  });

  // Internal service-to-service auth: shared token header + optional IP allowlist.
  fastify.decorate('verifyInternalToken', async function verifyInternalToken(request, reply) {
    const token = request.headers['x-internal-service-token'];
    if (!token || token !== config.internalServiceToken) {
      return reply.code(401).send({ error: 'Invalid or missing internal service token' });
    }

    const remoteIp = (request.ip || '').replace('::ffff:', '');
    if (config.flServerIps.length > 0 && !config.flServerIps.includes(remoteIp) && !config.flServerIps.includes(request.ip)) {
      request.log.warn({ remoteIp }, 'Internal route called from non-allowlisted IP');
      return reply.code(403).send({ error: 'Request origin not permitted for internal routes' });
    }

    request.isInternal = true;
  });

  // For routes like /fl/status that accept EITHER a valid service token OR a JWT.
  fastify.decorate('verifyInternalOrJwt', async function verifyInternalOrJwt(request, reply) {
    const serviceToken = request.headers['x-internal-service-token'];
    if (serviceToken && serviceToken === config.internalServiceToken) {
      request.isInternal = true;
      return;
    }
    return fastify.authenticate(request, reply);
  });
}

module.exports = fp(authPlugin, { name: 'auth-plugin', dependencies: ['redis-plugin'] });
