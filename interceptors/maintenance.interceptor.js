import { ConnectError, Code } from '@connectrpc/connect';
import { isMaintenanceGated } from './rbacRules.js';

export function createMaintenanceInterceptor(redis) {
  return (next) => async (req) => {
    if (isMaintenanceGated(req.service.typeName.split('.').pop())) {
      const raw = await redis.get('system:maintenance');
      if (raw) {
        let details = {};
        try {
          details = JSON.parse(raw);
        } catch {
          // ignore malformed stored value
        }
        throw new ConnectError(
          details.message || 'Service is in maintenance mode',
          Code.Unavailable
        );
      }
    }
    return next(req);
  };
}
