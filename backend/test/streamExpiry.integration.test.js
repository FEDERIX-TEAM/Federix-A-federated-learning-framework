import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { startTestServer } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer({ env: { JWT_ACCESS_EXPIRES_IN: '2s', STREAM_AUTH_RECHECK_MS: '200' } });
});

after(async () => {
  await srv?.stop();
});

test('an event stream closes when its access token expires', async () => {
  const c = await srv.newSdkClient('expiring-token');
  const token = c.headers.authorization.slice('Bearer '.length);
  const expiresAtMs = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
  let result;
  try {
    for await (const e of srv.api.events.subscribe({}, { headers: c.headers, signal: AbortSignal.timeout(6000) })) void e;
    result = { ended: 'cleanly' };
  } catch (err) {
    result = { ended: 'error', err };
  }
  const closedAt = Date.now();

  assert.equal(result.ended, 'error');
  assert.ok(result.err instanceof ConnectError && result.err.code === Code.Unauthenticated, String(result.err));
  assert.match(result.err.message, /expired/);
  assert.ok(closedAt >= expiresAtMs, `closed ${expiresAtMs - closedAt}ms before the token expired`);
  assert.ok(closedAt < expiresAtMs + 1000, `closed ${closedAt - expiresAtMs}ms after the token expired`);
});
