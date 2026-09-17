import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config';

const environment = {
  DATABASE_URL: 'postgresql://voice_app:test@127.0.0.1:5432/india_voice',
  REDIS_URL: 'redis://127.0.0.1:6379',
  NODE_ENV: 'test',
};

test('loads only server scaffold settings and leaves migration/provider credentials unused', () => {
  const config = loadConfig({ ...environment, MIGRATION_DATABASE_URL: 'secret', SARVAM_API_KEY: 'secret' });
  assert.equal(config.API_PORT, 3001);
  assert.equal(config.API_HOST, '127.0.0.1');
  assert.equal(config.AUTH_MODE, 'disabled');
  assert.equal('MIGRATION_DATABASE_URL' in config, false);
  assert.equal('SARVAM_API_KEY' in config, false);
  assert.equal(Object.isFrozen(config), true);
});

test('rejects privileged database roles and redacts connection credentials from errors', () => {
  assert.throws(
    () => loadConfig({ ...environment, DATABASE_URL: 'postgresql://postgres:private-secret@localhost/db' }),
    (error: unknown) => error instanceof Error
      && error.message.includes('restricted voice_app')
      && !error.message.includes('private-secret'),
  );
});

test('rejects malformed configuration and missing database/Redis settings', () => {
  for (const override of [
    { API_PORT: '70000' }, { API_PORT: '3.5' }, { DATABASE_URL: '' },
    { REDIS_URL: 'https://localhost' }, { WEB_ORIGIN: '*' },
    { WEB_ORIGIN: 'https://example.com/some/path' }, { AUTH_MODE: 'oidc' },
  ]) {
    assert.throws(() => loadConfig({ ...environment, ...override }), /Invalid API configuration/);
  }
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
});

test('fails closed on production startup until authentication is implemented', () => {
  assert.throws(() => loadConfig({ ...environment, NODE_ENV: 'production' }), /authentication adapter/);
});
