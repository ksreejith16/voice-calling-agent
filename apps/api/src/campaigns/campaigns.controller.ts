import {
  BadRequestException, ForbiddenException, Body, Controller, Get, Inject, Param, ParseUUIDPipe,
  Patch, Post, UseGuards,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { campaigns, wallets } from '@india-voice/database';
import { withTenantTransaction, calculateReservationAmount } from '@india-voice/database';
import { Queue } from 'bullmq';
import type { DispatchJobData } from '../queue/campaign.queue';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';
import type { AppConfig } from '../config';
import { APP_CONFIG } from '../config.token';

interface CreateCampaignBody {
  name: string;
  goal?: string;
  persona?: string;
  language?: string;
  voice?: string;
  ratePaisePerMinute: number;
  maxConnectedDurationSeconds?: number;
  billingQuantumSeconds?: 30 | 60;
}

@Controller('campaigns')
@UseGuards(ClerkAuthGuard)
export class CampaignsController {
  private readonly dispatchQueue: Queue<DispatchJobData>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.dispatchQueue = new Queue<DispatchJobData>('campaign-dispatch', { connection: { url: config.REDIS_URL } });
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        language: campaigns.language,
        concurrencyLimit: campaigns.concurrencyLimit,
        ratePaisePerMinute: campaigns.ratePaisePerMinute,
        scheduledAt: campaigns.scheduledAt,
        createdAt: campaigns.createdAt,
      })
        .from(campaigns)
        .where(eq(campaigns.organizationId, user.organizationId))
        .orderBy(desc(campaigns.createdAt)),
    );
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(campaigns)
        .where(and(eq(campaigns.organizationId, user.organizationId), eq(campaigns.id, id)))
        .limit(1),
    );
    return row ?? null;
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCampaignBody) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.insert(campaigns).values({
        organizationId: user.organizationId,
        name: body.name.trim(),
        goal: body.goal?.trim() ?? '',
        persona: body.persona?.trim() ?? '',
        language: (body.language as typeof campaigns.$inferInsert['language']) ?? 'en-IN',
        voice: body.voice?.trim() || null,
        ratePaisePerMinute: BigInt(body.ratePaisePerMinute),
        maxConnectedDurationSeconds: body.maxConnectedDurationSeconds ?? 300,
        billingQuantumSeconds: body.billingQuantumSeconds ?? 60,
      }).returning(),
    );
    return row;
  }

  @Post(':id/launch')
  async launch(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    if (user.role === 'viewer') throw new ForbiddenException('Viewers cannot launch campaigns');

    const [campaign] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(campaigns)
        .where(and(eq(campaigns.organizationId, user.organizationId), eq(campaigns.id, id)))
        .limit(1),
    );
    if (!campaign) throw new BadRequestException('Campaign not found');
    if (!['draft', 'paused'].includes(campaign.status)) {
      throw new BadRequestException(`Campaign is ${campaign.status} — only draft or paused campaigns can be launched`);
    }

    // Check wallet has minimum funds for at least one call
    const [wallet] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select({ balancePaise: wallets.balancePaise, reservedPaise: wallets.reservedPaise })
        .from(wallets).where(eq(wallets.organizationId, user.organizationId)).limit(1),
    );
    if (!wallet) throw new BadRequestException('No wallet found');
    const available = (wallet.balancePaise ?? 0n) - (wallet.reservedPaise ?? 0n);
    const minReserve = calculateReservationAmount(
      BigInt(campaign.maxConnectedDurationSeconds),
      BigInt(campaign.terminationMarginSeconds),
      campaign.ratePaisePerMinute,
      campaign.billingQuantumSeconds as 30 | 60,
    );
    if (available < minReserve) {
      throw new BadRequestException(
        `Insufficient funds. Need at least ₹${(Number(minReserve) / 100).toFixed(2)} available. ` +
        `Current available: ₹${(Number(available) / 100).toFixed(2)}.`,
      );
    }

    // Set campaign to running
    const [updated] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(campaigns)
        .set({ status: 'running', pauseReason: null, updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning({ id: campaigns.id, status: campaigns.status }),
    );

    // Enqueue initial dispatch job
    await this.dispatchQueue.add('dispatch', { organizationId: user.organizationId, campaignId: id }, {
      attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 200,
    });

    return updated;
  }

  @Post(':id/pause')
  async pause(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    if (user.role === 'viewer') throw new ForbiddenException('Viewers cannot pause campaigns');
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(campaigns)
        .set({ status: 'paused', pauseReason: 'Manually paused', updatedAt: new Date() })
        .where(and(eq(campaigns.organizationId, user.organizationId), eq(campaigns.id, id), eq(campaigns.status, 'running')))
        .returning({ id: campaigns.id, status: campaigns.status }),
    );
    if (!row) throw new BadRequestException('Campaign is not running');
    return row;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateCampaignBody & { status: string; pauseReason: string }>,
  ) {
    const allowed = ['draft', 'paused', 'archived'];
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(campaigns)
        .set({
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.goal !== undefined && { goal: body.goal.trim() }),
          ...(body.persona !== undefined && { persona: body.persona.trim() }),
          ...(body.status !== undefined && allowed.includes(body.status) && { status: body.status as typeof campaigns.$inferInsert['status'] }),
          updatedAt: new Date(),
        })
        .where(and(eq(campaigns.organizationId, user.organizationId), eq(campaigns.id, id)))
        .returning(),
    );
    return row ?? null;
  }
}
