import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runServerUntilExit } from './support/testServer.js';

const DEFAULT_SECRETS = {
  JWT_ACCESS_SECRET: 'change_me_access_secret',
  JWT_REFRESH_SECRET: 'change_me_refresh_secret',
  INTERNAL_SERVICE_TOKEN: 'change_me_shared_internal_token',
  SIGNED_URL_SECRET: 'change_me_signed_url_secret',
};

const STRONG_SECRETS = {
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  INTERNAL_SERVICE_TOKEN: 'c'.repeat(40),
  SIGNED_URL_SECRET: 'd'.repeat(40),
};

test('production refuses to start with default secrets', async () => {
  const { code, output } = await runServerUntilExit({ NODE_ENV: 'production', ...DEFAULT_SECRETS });
  assert.equal(code, 1);
  assert.match(output, /Refusing to start in production with insecure secrets/);
  for (const name of Object.keys(DEFAULT_SECRETS)) assert.match(output, new RegExp(`${name} is still a default value`));
});

test('production refuses short or identical JWT secrets', async () => {
  const { code, output } = await runServerUntilExit({
    NODE_ENV: 'production',
    ...STRONG_SECRETS,
    JWT_REFRESH_SECRET: STRONG_SECRETS.JWT_ACCESS_SECRET,
    SIGNED_URL_SECRET: 'too-short',
  });
  assert.equal(code, 1);
  assert.match(output, /JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different/);
  assert.match(output, /SIGNED_URL_SECRET is shorter than 32 characters/);
});

test('the server refuses to start when Redis is unreachable', async () => {
  const { code, output } = await runServerUntilExit({ NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:1' });
  assert.equal(code, 1);
  assert.match(output, /Redis is not reachable at redis:\/\/127\.0\.0\.1:1/);
});

test('the server refuses to start when MongoDB is unreachable', async () => {
  const { code, output } = await runServerUntilExit({ NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:1/federix_unreachable' });
  assert.equal(code, 1);
  assert.match(output, /MongoDB is not reachable at mongodb:\/\/127\.0\.0\.1:1/);
});
