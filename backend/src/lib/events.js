// In-process pub/sub that backs EventStreamService.Subscribe (replaces the old WebSocket manager).
// NOTE: single-instance only. To scale horizontally, back publish()/subscribe() with Redis pub/sub.

export const ADMIN_ROLES = ['super_admin', 'admin', 'fl_engineer', 'viewer'];
export const ADMIN_AND_CLIENTS = [...ADMIN_ROLES, 'sdk_client'];
export const ALL = 'all';

const PING_INTERVAL_MS = 30_000;
const MAX_QUEUE = 1000;

const subscribers = new Set();

export function subscriberCount() {
  return subscribers.size;
}

/** Publish an event to every subscriber whose role is in `audience` (array of roles, or ALL). */
export function publish(type, payload, audience = ADMIN_ROLES) {
  const event = { type, payloadJson: JSON.stringify(payload ?? {}), timestamp: new Date().toISOString() };
  for (const sub of subscribers) {
    if (audience === ALL || audience.includes(sub.user.role)) sub.push(event);
  }
}

/** Async generator used directly as the Subscribe RPC handler body. */
export async function* subscribe(user, signal) {
  const queue = [];
  let wake = null;
  const sub = {
    user,
    push(event) {
      if (queue.length >= MAX_QUEUE) queue.shift(); // drop oldest for slow consumers
      queue.push(event);
      wake?.();
    },
  };
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort);
  subscribers.add(sub);

  try {
    yield {
      type: 'connected',
      payloadJson: JSON.stringify({ role: user.role, client_id: user.client_id ?? null }),
      timestamp: new Date().toISOString(),
    };

    while (!signal.aborted) {
      if (queue.length === 0) {
        let timer;
        await new Promise((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, PING_INTERVAL_MS);
        });
        clearTimeout(timer);
        wake = null;
        if (signal.aborted) break;
        if (queue.length === 0) {
          // keep-alive so proxies / clients can detect dead connections
          yield { type: 'ping', payloadJson: '{}', timestamp: new Date().toISOString() };
          continue;
        }
      }
      yield queue.shift();
    }
  } finally {
    subscribers.delete(sub);
    signal.removeEventListener('abort', onAbort);
  }
}
