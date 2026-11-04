import { authOf } from '../lib/helpers.js';
import { subscribe } from '../lib/events.js';

export function createEventService() {
  return {
    // Long-lived server stream; which events arrive depends on the caller's role (see lib/events.js publishers).
    async *subscribe(_req, ctx) {
      yield* subscribe(authOf(ctx), ctx.signal);
    },
  };
}
