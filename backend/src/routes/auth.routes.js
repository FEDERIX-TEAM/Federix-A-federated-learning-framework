const Client = require('../models/Client');
const AdminUser = require('../models/AdminUser');
const { hashPassword, verifyPassword } = require('../utils/password');
const { newId, newApiKey } = require('../utils/ids');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  expiresInSeconds,
} = require('../utils/jwt');
const { logEvent } = require('../utils/auditLog');

const ADMIN_ROLES = ['super_admin', 'admin', 'fl_engineer', 'viewer'];

async function authRoutes(fastify) {
  // POST /api/v1/auth/register — Public
  fastify.post('/register', async (request, reply) => {
    const { name, description = '', sdk_version, platform } = request.body || {};
    if (!name || !sdk_version || !platform) {
      return reply.code(400).send({ error: 'name, sdk_version, and platform are required' });
    }

    const client_id = newId();
    const apiKey = newApiKey();
    const api_key_hash = await hashPassword(apiKey);

    const client = await Client.create({
      client_id,
      api_key_hash,
      name,
      description,
      sdk_version,
      platform,
      status: 'idle',
    });

    await logEvent({ actor: client_id, eventType: 'client.registered', details: { name, sdk_version } });

    return reply.code(201).send({
      client_id,
      api_key: apiKey, // shown only once
      created_at: client.created_at,
    });
  });

  // POST /api/v1/auth/client/login — SDK Client (auth via api_key, not JWT)
  fastify.post('/client/login', async (request, reply) => {
    const { client_id, api_key } = request.body || {};
    if (!client_id || !api_key) {
      return reply.code(400).send({ error: 'client_id and api_key are required' });
    }

    const client = await Client.findOne({ client_id });
    if (!client) return reply.code(401).send({ error: 'Invalid client_id or api_key' });

    const valid = await verifyPassword(api_key, client.api_key_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid client_id or api_key' });

    if (client.isBanned()) {
      return reply.code(403).send({ error: 'Client is banned', banned_until: client.banned_until });
    }

    const jti = newId();
    const refreshJti = newId();
    const access_token = signAccessToken({ sub: client_id, role: 'sdk_client', client_id, jti });
    const refresh_token = signRefreshToken({ sub: client_id, role: 'sdk_client', client_id, jti: refreshJti });

    client.status = 'active';
    client.last_seen = new Date();
    await client.save();

    return reply.send({ access_token, refresh_token, expires_in: expiresInSeconds() });
  });

  // POST /api/v1/auth/admin/login — Admin / Super Admin / FL Engineer / Viewer
  fastify.post('/admin/login', async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' });
    }

    const user = await AdminUser.findOne({ email: email.toLowerCase() });
    if (!user) return reply.code(401).send({ error: 'Invalid email or password' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid email or password' });

    const jti = newId();
    const refreshJti = newId();
    const access_token = signAccessToken({ sub: user.user_id, role: user.role, jti });
    const refresh_token = signRefreshToken({ sub: user.user_id, role: user.role, jti: refreshJti });

    user.last_login = new Date();
    await user.save();

    await logEvent({ actor: user.user_id, eventType: 'admin.login', details: { role: user.role } });

    return reply.send({
      access_token,
      refresh_token,
      role: user.role,
      user_id: user.user_id,
    });
  });

  // POST /api/v1/auth/refresh — any authenticated role, via refresh_token in body
  fastify.post('/refresh', async (request, reply) => {
    const { refresh_token } = request.body || {};
    if (!refresh_token) return reply.code(400).send({ error: 'refresh_token is required' });

    let decoded;
    try {
      decoded = verifyRefreshToken(refresh_token);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    const blacklisted = await fastify.redis.exists(`blacklist:${decoded.jti}`);
    if (blacklisted) return reply.code(401).send({ error: 'Refresh token has been invalidated' });

    const jti = require('../utils/ids').newId();
    const access_token = signAccessToken({
      sub: decoded.sub,
      role: decoded.role,
      client_id: decoded.client_id,
      jti,
    });

    return reply.send({ access_token, expires_in: expiresInSeconds() });
  });

  // POST /api/v1/auth/logout — any authenticated role
  fastify.post('/logout', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ttl = Math.max(1, request.user.exp - Math.floor(Date.now() / 1000));
    await fastify.redis.set(`blacklist:${request.user.jti}`, '1', 'EX', ttl);

    await logEvent({ actor: request.user.sub, eventType: 'session.logout', details: { role: request.user.role } });

    return reply.send({ success: true });
  });

  // POST /api/v1/auth/client/rotate-key — Super Admin, Admin
  fastify.post(
    '/client/rotate-key',
    { preHandler: [fastify.authenticate, fastify.authorize(['super_admin', 'admin'])] },
    async (request, reply) => {
      const { client_id } = request.body || {};
      if (!client_id) return reply.code(400).send({ error: 'client_id is required' });

      const client = await Client.findOne({ client_id });
      if (!client) return reply.code(404).send({ error: 'Client not found' });

      const newKey = newApiKey();
      client.api_key_hash = await hashPassword(newKey);
      await client.save();

      await logEvent({
        actor: request.user.sub,
        eventType: 'client.key_rotated',
        details: { client_id },
      });

      return reply.send({ new_api_key: newKey });
    }
  );

  // POST /api/v1/auth/admin/create — Super Admin only
  fastify.post(
    '/admin/create',
    { preHandler: [fastify.authenticate, fastify.authorize(['super_admin'])] },
    async (request, reply) => {
      const { email, password, role, name } = request.body || {};
      if (!email || !password || !role || !name) {
        return reply.code(400).send({ error: 'email, password, role, and name are required' });
      }
      if (!['admin', 'fl_engineer', 'viewer'].includes(role)) {
        return reply.code(400).send({ error: 'role must be one of admin, fl_engineer, viewer' });
      }

      const existing = await AdminUser.findOne({ email: email.toLowerCase() });
      if (existing) return reply.code(409).send({ error: 'Email already in use' });

      const user_id = newId();
      const password_hash = await hashPassword(password);
      const user = await AdminUser.create({ user_id, email: email.toLowerCase(), password_hash, role, name });

      await logEvent({
        actor: request.user.sub,
        eventType: 'admin.user_created',
        details: { created_user_id: user_id, role },
      });

      return reply.code(201).send({ user_id, role, created_at: user.created_at });
    }
  );

  // GET /api/v1/auth/me — any authenticated role
  fastify.get('/me', { preHandler: fastify.authenticate }, async (request, reply) => {
    if (request.user.role === 'sdk_client') {
      const client = await Client.findOne({ client_id: request.user.client_id });
      if (!client) return reply.code(404).send({ error: 'Client not found' });
      return reply.send({
        id: client.client_id,
        name: client.name,
        role: 'sdk_client',
        created_at: client.created_at,
        last_login: client.last_seen,
      });
    }

    const user = await AdminUser.findOne({ user_id: request.user.sub });
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return reply.send({
      id: user.user_id,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      last_login: user.last_login,
    });
  });
}

module.exports = authRoutes;
