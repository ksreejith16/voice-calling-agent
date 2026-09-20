import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  try {
    await app.listen(config.API_PORT, config.API_HOST);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('Invalid API configuration:')
    ? error.message
    : 'API startup failed. Check the configured host/port and local service setup.');
  process.exitCode = 1;
});
