import { ConnectError, Code } from '@connectrpc/connect';
import { verifyAccessToken } from '../utils/jwt.js';
import { ruleFor } from './rbacRules.js';
import { kAuthContext, kIsInternal } from './context.js';
import { config } from '../config/index.js';

function serviceShortName(req) {
  return req.service.typeName.split('.').pop();
}

async function checkJwt(req, redis) {
  const header = req.header.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new ConnectError('Missing or malformed authorization metadata', Code.Unauthenticated);
  }
  const token = header.slice('Bearer '.length);

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw new ConnectError('Invalid or expired token', Code.Unauthenticated);
  }

  const blacklisted = await redis.exists(`blacklist:${decoded.jti}`);
  if (blacklisted) {
    throw new ConnectError('Token has been invalidated', Code.Unauthenticated);
  }

  return decoded; // { sub, role, client_id?, jti, iat, exp }
}

function checkInternalToken(req) {
  const token = req.header.get('x-internal-service-token');
  if (!token || token !== config.internalServiceToken) {
    return false;
  }
  // Best-effort IP check — Connect/Fastify don't give interceptors the raw socket
  // address directly, so this is enforced again at the Fastify layer in app.js
  // via a preHandler-style hook reading req.raw.socket.remoteAddress for FlBridgeService paths.
  return true;
}

export function createAccessControlInterceptor(redis) {
  return (next) => async (req) => {
    const serviceName = serviceShortName(req);
    const rule = ruleFor(serviceName, req.method.name);

    if (rule === undefined) {
      // Fail closed: an RPC with no explicit rule is a bug, not an accidental public route.
      throw new ConnectError(`No access rule defined for ${serviceName}.${req.method.name}`, Code.Internal);
    }

    if (rule === 'public') {
      return next(req);
    }

    if (rule === 'internal') {
      if (!checkInternalToken(req)) {
        throw new ConnectError('Invalid or missing internal service token', Code.Unauthenticated);
      }
      req.contextValues.set(kIsInternal, true);
      return next(req);
    }

    if (rule === 'internal-or-super-admin') {
      if (checkInternalToken(req)) {
        req.contextValues.set(kIsInternal, true);
        return next(req);
      }
      const decoded = await checkJwt(req, redis);
      if (decoded.role !== 'super_admin') {
        throw new ConnectError('Insufficient role for this resource', Code.PermissionDenied);
      }
      req.contextValues.set(kAuthContext, decoded);
      return next(req);
    }

    // 'any' or an explicit role list — both require a valid JWT first.
    const decoded = await checkJwt(req, redis);
    if (Array.isArray(rule) && !rule.includes(decoded.role)) {
      throw new ConnectError('Insufficient role for this resource', Code.PermissionDenied);
    }
    req.contextValues.set(kAuthContext, decoded);
    return next(req);
  };
}
