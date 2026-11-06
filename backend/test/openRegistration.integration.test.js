import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Code, ConnectError } from '@connectrpc/connect';
import { Client } from '../models/Client.js';
import { startTestServer } from './support/testServer.js';

let srv;

before(async () => {
  srv = await startTestServer({ env: { ENROLLMENT_REQUIRED: 'false' } });
});

after(async () => {
  await srv?.stop();
});

test('with ENROLLMENT_REQUIRED=false clients can register without a token', async () => {
  const reg = await srv.api.auth.register({ name: 'open', sdkVersion: '1.0.0', platform: 'test' });
  assert.equal((await Client.findOne({ client_id: reg.clientId }).lean()).enrollment_token_id, null);
});

test('a token that is sent is still checked when enrollment is optional', async () => {
  await assert.rejects(
    srv.api.auth.register({ name: 'open', sdkVersion: '1.0.0', platform: 'test', enrollmentToken: 'not-a-token' }),
    (err) => err instanceof ConnectError && err.code === Code.Unauthenticated
  );
});

test('the sdk_version check still applies', async () => {
  await assert.rejects(
    srv.api.auth.register({ name: 'open', sdkVersion: '9.9.9', platform: 'test' }),
    (err) => err instanceof ConnectError && err.code === Code.FailedPrecondition
  );
});
