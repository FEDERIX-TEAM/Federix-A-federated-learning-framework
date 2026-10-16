import { ConnectError, Code } from '@connectrpc/connect';
import { createAccessControlInterceptor } from '../interceptors/accessControl.interceptor.js';
import { createMaintenanceInterceptor } from '../interceptors/maintenance.interceptor.js';
import { recordRequest } from './lib/metrics.js';

/** Outermost: logs every call and hides internal error details (Mongo/Mongoose errors etc.) from clients. */
function createErrorInterceptor(logger) {
  return (next) => async (req) => {
    const rpc = `${req.service.typeName.split('.').pop()}.${req.method.name}`;
    const started = Date.now();
    recordRequest();

    const finish = (code) => logger.info({ rpc, code, ms: Date.now() - started }, 'rpc');

    const sanitize = (err) => {
      if (err instanceof ConnectError) {
        finish(Code[err.code]);
        return err;
      }
      logger.error({ err, rpc }, 'unhandled error in rpc');
      finish('Internal');
      return new ConnectError('Internal server error', Code.Internal);
    };

    try {
      const res = await next(req);
      if (!res.stream) {
        finish('Ok');
        return res;
      }
      // Server-streaming: errors surface while the stream is consumed, so wrap the iterator.
      const original = res.message;
      return {
        ...res,
        message: (async function* guarded() {
          try {
            yield* original;
            finish('Ok');
          } catch (err) {
            throw sanitize(err);
          }
        })(),
      };
    } catch (err) {
      throw sanitize(err);
    }
  };
}

export function buildInterceptors({ redis, logger }) {
  return [
    createErrorInterceptor(logger),
    createAccessControlInterceptor(redis),
    createMaintenanceInterceptor(redis),
  ];
}
