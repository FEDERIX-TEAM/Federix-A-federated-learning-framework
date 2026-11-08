import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { startTestServer, collect } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer({ env: { WATCH_KEEPALIVE_MS: '60000' } });
});

after(async () => {
  await srv?.stop();
});

const isDeadline = (err) => err instanceof ConnectError && err.code === Code.DeadlineExceeded;

test('an event stream that reaches its deadline ends with DEADLINE_EXCEEDED', async () => {
  const started = Date.now();
  await assert.rejects(collect(srv.api.events.subscribe({}, { ...srv.superAdmin, timeoutMs: 800 })), isDeadline);
  assert.ok(Date.now() - started < 3000);
});

test('a WatchRounds stream that reaches its deadline ends with DEADLINE_EXCEEDED', async () => {
  await assert.rejects(collect(srv.api.fl.watchRounds({ workerId: 'w' }, { ...srv.internal, timeoutMs: 800 })), isDeadline);
});
