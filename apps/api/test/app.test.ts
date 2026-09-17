import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import type { DependencyChecks } from '../src/infrastructure';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://voice_app:test@127.0.0.1:5432/india_voice',
  REDIS_URL: 'redis://127.0.0.1:6379',
});

test('Fastify starts without providers, liveness remains up on infrastructure failure, no tenant routes exist', async () => {
  let closed = false;
  const dependencies: DependencyChecks = {
    databaseReady: async () => { throw new Error('postgresql://private-secret@example.com'); },
    redisReady: async () => false,
    onApplicationShutdown: async () => { closed = true; },
  };
  const app = await createApp(config, dependencies, true);
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok', service: 'india-voice-api', phase: 'foundation' });
    assert.equal(health.headers['cache-control'], 'no-store');
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { status: 'not_ready', checks: { database: 'down', redis: 'down' } });
    assert.equal(ready.body.includes('private-secret'), false);
    const tenant = await app.inject({
      method: 'GET', url: '/organizations', headers: { 'x-organization-id': 'untrusted' },
    });
    assert.equal(tenant.statusCode, 404);
  } finally {
    await app.close();
  }
  assert.equal(closed, true);
});

test('readiness succeeds only when both infrastructure checks succeed', async () => {
  let redisUp = true;
  const app = await createApp(config, {
    databaseReady: async () => true,
    redisReady: async () => redisUp,
    onApplicationShutdown: async () => undefined,
  }, true);
  try {
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', checks: { database: 'up', redis: 'up' } });
    redisUp = false;
    const partial = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(partial.statusCode, 503);
    assert.deepEqual(partial.json().checks, { database: 'up', redis: 'down' });
  } finally {
    await app.close();
  }
});

test('health uses the configured explicit browser origin with no credential sharing', async () => {
  const app = await createApp(config, {
    databaseReady: async () => true,
    redisReady: async () => true,
    onApplicationShutdown: async () => undefined,
  }, true);
  try {
    const health = await app.inject({ method: 'GET', url: '/health', headers: { origin: config.WEB_ORIGIN } });
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers['access-control-allow-origin'], config.WEB_ORIGIN);
    assert.equal(health.headers['access-control-allow-credentials'], undefined);
  } finally {
    await app.close();
  }
});
