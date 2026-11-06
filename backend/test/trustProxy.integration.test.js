import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './support/testServer.js';

const WINDOW_MS = 2000;
let srv;

before(async () => {
  srv = await startTestServer({
    env: { TRUST_PROXY: 'true', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_WINDOW_SECONDS: '2', RATE_LIMIT_PER_IP: '3' },
  });
});

after(async () => {
  await srv?.stop();
});

const freshWindow = () => new Promise((r) => setTimeout(r, WINDOW_MS - (Date.now() % WINDOW_MS) + 30));
const health = (forwardedFor) => fetch(`${srv.baseUrl}/federix.v1.SystemService/HealthCheck`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
  body: '{}',
});

test('behind a trusted proxy, each forwarded client IP gets its own limit', async () => {
  await freshWindow();
  for (let i = 0; i < 3; i += 1) assert.equal((await health('203.0.113.10')).status, 200);
  assert.equal((await health('203.0.113.10')).status, 429);
  assert.equal((await health('203.0.113.11')).status, 200);
});
