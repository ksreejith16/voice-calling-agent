import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../.env'), quiet: true });
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (migrationUrl && new URL(migrationUrl).username !== 'voice_migrator') {
  throw new Error('MIGRATION_DATABASE_URL must use the voice_migrator role.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  ...(migrationUrl ? { dbCredentials: { url: migrationUrl } } : {}),
  strict: true,
  verbose: true,
});
