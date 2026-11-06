import { Client } from '../../models/Client.js';
import { AdminUser } from '../../models/AdminUser.js';
import { createSessionStore } from './sessions.js';
import { unauthenticated, permissionDenied } from './errors.js';

export async function streamAuthProblem(auth, redis) {
  if (!auth.exp || auth.exp * 1000 <= Date.now()) return unauthenticated('Access token expired, please reconnect');
  if (await redis.exists(`blacklist:${auth.jti}`)) return unauthenticated('Token has been invalidated');
  if (!(await createSessionStore(redis).isActive(auth.fam))) return unauthenticated('Session has ended, please log in again');

  if (auth.role === 'sdk_client') {
    const client = await Client.findOne({ client_id: auth.client_id }).select('banned_until');
    if (!client) return unauthenticated('Client no longer exists');
    if (client.isBanned()) return permissionDenied('Client is banned');
    return null;
  }

  const user = await AdminUser.findOne({ user_id: auth.sub }).select('role');
  if (!user) return unauthenticated('User no longer exists');
  if (user.role !== auth.role) return permissionDenied('Your role changed, please reconnect');
  return null;
}
