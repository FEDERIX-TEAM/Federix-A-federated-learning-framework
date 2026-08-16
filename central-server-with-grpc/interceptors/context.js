import { createContextKey } from '@connectrpc/connect';

// Populated by auth.interceptor.js, read by service implementations via
// `context.values.get(kAuthContext)`. `null` until the auth interceptor runs.
export const kAuthContext = createContextKey(null);

// Populated by internal.interceptor.js for FlBridgeService calls.
export const kIsInternal = createContextKey(false);
