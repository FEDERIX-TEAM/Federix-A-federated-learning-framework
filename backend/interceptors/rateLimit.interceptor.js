import { ConnectError, Code } from '@connectrpc/connect';
import { kAuthContext, kIsInternal } from './context.js';
import { config } from '../config/index.js';

export const CLIENT_IP_HEADER = 'x-federix-client-ip';

export function createRateLimitInterceptor(redis, settings = config.rateLimit) {
  return (next) => async (req) => {
    if (!settings.enabled || req.contextValues.get(kIsInternal)) return next(req);

    const auth = req.contextValues.get(kAuthContext);
    const subject = auth ? `principal:${auth.sub}` : `ip:${req.header.get(CLIENT_IP_HEADER) ?? 'unknown'}`;
    const limit = auth ? settings.perPrincipal : settings.perIp;
    const windowMs = settings.windowSeconds * 1000;
    const windowIndex = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:${subject}:${windowIndex}`;

    const [[, count]] = await redis.multi().incr(key).expire(key, settings.windowSeconds + 1, 'NX').exec();
    if (count > limit) {
      const retryAfter = Math.max(1, Math.ceil(((windowIndex + 1) * windowMs - Date.now()) / 1000));
      throw new ConnectError(
        `Rate limit exceeded: at most ${limit} calls per ${settings.windowSeconds}s; try again in ${retryAfter}s`,
        Code.ResourceExhausted
      );
    }
    return next(req);
  };
}
