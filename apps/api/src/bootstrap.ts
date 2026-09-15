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
    AppModule.register(dependencies),
    new FastifyAdapter({ bodyLimit: 64 * 1024, trustProxy: false }),
    { logger: quiet ? false : ['log', 'warn', 'error'], abortOnError: false },
  );
  app.enableCors({ origin: config.WEB_ORIGIN, methods: ['GET', 'HEAD'], credentials: false });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
