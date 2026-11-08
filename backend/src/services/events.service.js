import { authOf } from '../lib/helpers.js';
import { subscribe } from '../lib/events.js';
import { streamAuthProblem } from '../lib/streamAuth.js';
import { config } from '../../config/index.js';
import { throwIfDeadlineExceeded } from '../lib/errors.js';

export function createEventService({ redis, logger }) {
  return {
    async *subscribe(_req, ctx) {
      const auth = authOf(ctx);
      const stop = new AbortController();
      const onClientGone = () => stop.abort();
      ctx.signal.addEventListener('abort', onClientGone);

      let failure = null;
      let checking = false;
      const timer = setInterval(async () => {
        if (checking || stop.signal.aborted) return;
        checking = true;
        try {
          const problem = await streamAuthProblem(auth, redis);
          if (problem) {
            failure = problem;
            stop.abort();
          }
        } catch (err) {
          logger?.warn({ err: err.message }, 'event stream auth re-check failed; keeping the stream open');
        } finally {
          checking = false;
        }
      }, config.events.authRecheckMs);

      try {
        yield* subscribe(auth, stop.signal);
        if (failure) throw failure;
        throwIfDeadlineExceeded(ctx.signal);
      } finally {
        clearInterval(timer);
        ctx.signal.removeEventListener('abort', onClientGone);
      }
    },
  };
}
