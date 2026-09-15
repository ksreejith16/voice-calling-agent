import {
  Controller, Get, Header, Inject, Module, ServiceUnavailableException,
  type DynamicModule,
} from '@nestjs/common';
import { INFRASTRUCTURE, type DependencyChecks } from './infrastructure';

@Controller()
class HealthController {
  constructor(@Inject(INFRASTRUCTURE) private readonly dependencies: DependencyChecks) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  health() {
    return { status: 'ok', service: 'india-voice-api', phase: 'foundation' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    const [database, redis] = await Promise.allSettled([
      this.dependencies.databaseReady(),
      this.dependencies.redisReady(),
    ]);
    const checks = {
      database: database.status === 'fulfilled' && database.value ? 'up' : 'down',
      redis: redis.status === 'fulfilled' && redis.value ? 'up' : 'down',
    };
    if (checks.database !== 'up' || checks.redis !== 'up') {
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }
    return { status: 'ready', checks };
  }
}

@Module({})
export class AppModule {
  static register(dependencies: DependencyChecks): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: INFRASTRUCTURE, useValue: dependencies }],
    };
  }
}
