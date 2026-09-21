import {
  Controller, Get, Header, Inject, Module, ServiceUnavailableException,
  type DynamicModule,
} from '@nestjs/common';
import { INFRASTRUCTURE, type DependencyChecks, type Infrastructure } from './infrastructure';
import { DATABASE } from './database.token';
import { APP_CONFIG } from './config.token';
import type { AppConfig } from './config';
import { ClerkAuthGuard } from './auth/clerk.guard';
import { ProvisionController } from './auth/provision.controller';
import { VoiceController, VoiceEventsController } from './voice/voice.controller';
import { AgentsController } from './agents/agents.controller';
import { CampaignsController } from './campaigns/campaigns.controller';
import { LeadsController } from './leads/leads.controller';
import { CallLogsController } from './call-logs/call-logs.controller';
import { WalletController } from './wallet/wallet.controller';
import { DashboardController } from './dashboard/dashboard.controller';

@Controller()
class HealthController {
  constructor(@Inject(INFRASTRUCTURE) private readonly dependencies: DependencyChecks) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  health() {
    return { status: 'ok', service: 'india-voice-api', phase: 'auth+dashboard' };
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
  static register(dependencies: DependencyChecks, config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        ProvisionController,
        AgentsController,
        VoiceController,
        VoiceEventsController,
        CampaignsController,
        LeadsController,
        CallLogsController,
        WalletController,
        DashboardController,
      ],
      providers: [
        { provide: INFRASTRUCTURE, useValue: dependencies },
        {
          provide: DATABASE,
          useFactory: () => (dependencies as Infrastructure).getDb(),
        },
        { provide: APP_CONFIG, useValue: config },
        ClerkAuthGuard,
      ],
    };
  }
}
