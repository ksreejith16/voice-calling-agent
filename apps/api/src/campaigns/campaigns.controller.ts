import {
  Body, Controller, Get, Inject, Param, ParseUUIDPipe,
  Patch, Post, UseGuards,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { campaigns } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
