import { Client } from '../../models/Client.js';
import { config } from '../../config/index.js';
import { AdminUser } from '../../models/AdminUser.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { newId, newApiKey } from '../../utils/ids.js';
import { verifyRefreshToken, expiresInSeconds } from '../../utils/jwt.js';
import { logEvent } from '../../utils/auditLog.js';
import { ROLE_TO_PROTO, ROLE_FROM_PROTO, dateToIso } from '../../utils/protoMappers.js';
import { authOf } from '../lib/helpers.js';
import { createSessionStore, ROTATED, REUSE_DETECTED } from '../lib/sessions.js';
import { invalidArg, notFound, alreadyExists, permissionDenied, unauthenticated } from '../lib/errors.js';

const CREATABLE_ROLES = ['admin', 'fl_engineer', 'viewer'];

export function createAuthService({ redis }) {
  const sessions = createSessionStore(redis);
  return {
    // Public
    async register(req) {
      const { name, description, sdkVersion, platform } = req;
      if (!name || !sdkVersion || !platform) throw invalidArg('name, sdk_version and platform are required');

      const client_id = newId();
      const apiKey = newApiKey();
      const client = await Client.create({
        client_id,
        api_key_hash: await hashPassword(apiKey),
        name,
        description,
        sdk_version: sdkVersion,
        platform,
        status: 'idle',
      });
      await logEvent({ actor: client_id, eventType: 'client.registered', details: { name, sdk_version: sdkVersion } });

      return { clientId: client_id, apiKey, createdAt: dateToIso(client.created_at) };
    },

    // Public — authenticates with api_key
    async clientLogin(req) {
      const { clientId, apiKey } = req;
      if (!clientId || !apiKey) throw invalidArg('client_id and api_key are required');

      const client = await Client.findOne({ client_id: clientId });
      if (!client || !(await verifyPassword(apiKey, client.api_key_hash))) {
        throw unauthenticated('Invalid client_id or api_key');
      }
      if (client.isBanned()) {
        const until = client.banned_until.getTime() === 0 ? 'permanently' : `until ${dateToIso(client.banned_until)}`;
        throw permissionDenied(`Client is banned ${until}`);
      }

      const session = await sessions.start({ sub: clientId, role: 'sdk_client', client_id: clientId });

      client.status = 'active';
      client.last_seen = new Date();
      await client.save();

      return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: expiresInSeconds() };
    },

    // Public
    async adminLogin(req) {
      const { email, password } = req;
      if (!email || !password) throw invalidArg('email and password are required');

      const user = await AdminUser.findOne({ email: email.toLowerCase().trim() });
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        throw unauthenticated('Invalid email or password');
      }

      const session = await sessions.start({ sub: user.user_id, role: user.role });

      user.last_login = new Date();
      await user.save();
      await logEvent({ actor: user.user_id, eventType: 'admin.login', details: { role: user.role } });

      return { accessToken: session.accessToken, refreshToken: session.refreshToken, role: ROLE_TO_PROTO[user.role], userId: user.user_id };
    },

    // Public — authenticates via the refresh_token field
    async refreshToken(req) {
      if (!req.refreshToken) throw invalidArg('refresh_token is required');

      let decoded;
      try {
        decoded = verifyRefreshToken(req.refreshToken);
      } catch {
        throw unauthenticated('Invalid or expired refresh token');
      }
      if (!decoded.fam || !decoded.jti) throw unauthenticated('Session has expired, please log in again');

      let claims;
      if (decoded.role === 'sdk_client') {
        const client = await Client.findOne({ client_id: decoded.client_id });
        if (!client) {
          await sessions.end(decoded.fam);
          throw unauthenticated('Client no longer exists');
        }
        if (client.isBanned()) {
          await sessions.end(decoded.fam);
          throw permissionDenied('Client is banned');
        }
        claims = { sub: client.client_id, role: 'sdk_client', client_id: client.client_id };
      } else {
        const user = await AdminUser.findOne({ user_id: decoded.sub });
        if (!user) {
          await sessions.end(decoded.fam);
          throw unauthenticated('User no longer exists');
        }
        claims = { sub: user.user_id, role: user.role };
      }

      const rotated = await sessions.rotate(decoded, claims);
      if (rotated.result === REUSE_DETECTED) {
        await logEvent({
          level: 'warn',
          actor: decoded.sub,
          eventType: 'session.refresh_reuse',
          details: { role: claims.role, family: decoded.fam },
        });
        throw unauthenticated('Refresh token was already used; this session has been revoked, please log in again');
      }
      if (rotated.result !== ROTATED) throw unauthenticated('Session has ended, please log in again');

      return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken, expiresIn: expiresInSeconds() };
    },

    async logout(_req, ctx) {
      const auth = authOf(ctx);
      const ttl = Math.max(1, auth.exp - Math.floor(Date.now() / 1000));
      await redis.set(`blacklist:${auth.jti}`, '1', 'EX', ttl);
      await sessions.end(auth.fam);
      await logEvent({ actor: auth.sub, eventType: 'session.logout', details: { role: auth.role } });
      return { success: true };
    },

    async rotateClientKey(req, ctx) {
      if (!req.clientId) throw invalidArg('client_id is required');
      const client = await Client.findOne({ client_id: req.clientId });
      if (!client) throw notFound('Client not found');

      const newKey = newApiKey();
      client.api_key_hash = await hashPassword(newKey);
      await client.save();
      await logEvent({ actor: authOf(ctx).sub, eventType: 'client.key_rotated', details: { client_id: req.clientId } });

      return { newApiKey: newKey };
    },

    async createAdminUser(req, ctx) {
      const { email, password, name } = req;
      const role = ROLE_FROM_PROTO[req.role];
      if (!email || !password || !name) throw invalidArg('email, password, role and name are required');
      if (!CREATABLE_ROLES.includes(role)) throw invalidArg(`role must be one of ${CREATABLE_ROLES.join(', ')}`);
      const minLength = config.security.minPasswordLength;
      if (password.length < minLength) throw invalidArg(`password must be at least ${minLength} characters`);

      const normalized = email.toLowerCase().trim();
      if (await AdminUser.exists({ email: normalized })) throw alreadyExists('Email already in use');

      const user = await AdminUser.create({
        user_id: newId(),
        email: normalized,
        password_hash: await hashPassword(password),
        role,
        name,
      });
      await logEvent({
        actor: authOf(ctx).sub,
        eventType: 'admin.user_created',
        details: { created_user_id: user.user_id, role },
      });

      return { userId: user.user_id, role: ROLE_TO_PROTO[role], createdAt: dateToIso(user.created_at) };
    },

    async getMe(_req, ctx) {
      const auth = authOf(ctx);

      if (auth.role === 'sdk_client') {
        const client = await Client.findOne({ client_id: auth.client_id });
        if (!client) throw notFound('Client not found');
        return {
          id: client.client_id,
          name: client.name,
          role: ROLE_TO_PROTO.sdk_client,
          createdAt: dateToIso(client.created_at),
          lastLogin: dateToIso(client.last_seen),
        };
      }

      const user = await AdminUser.findOne({ user_id: auth.sub });
      if (!user) throw notFound('User not found');
      return {
        id: user.user_id,
        name: user.name,
        role: ROLE_TO_PROTO[user.role],
        createdAt: dateToIso(user.created_at),
        lastLogin: dateToIso(user.last_login),
      };
    },
  };
}
