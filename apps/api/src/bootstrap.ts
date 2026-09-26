import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { AppConfig } from './config';
import { Infrastructure, type DependencyChecks } from './infrastructure';

export async function createApp(
  config: AppConfig,
  dependencies: DependencyChecks = new Infrastructure(config),
  quiet = false,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(dependencies, config),
    new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024, trustProxy: false }),
    { logger: quiet ? false : ['log', 'warn', 'error'], abortOnError: false },
  );
  app.enableCors({
    origin: config.WEB_ORIGIN,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });
  // Capture raw body before JSON parsing so Razorpay webhook HMAC can be verified.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.getHttpAdapter().getInstance() as any).addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req: Record<string, unknown>, body: string, done: (err: Error | null, body?: unknown) => void) => {
      req['rawBody'] = body;
      try { done(null, JSON.parse(body || '{}')); } catch (e) { done(e as Error); }
    },
  );
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
