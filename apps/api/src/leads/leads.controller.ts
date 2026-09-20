import {
  Body, Controller, Get, Inject, Param, ParseUUIDPipe,
  Post, Query, UseGuards,
} from '@nestjs/common';
import { eq, and, desc, ilike } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { leads } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

@Controller('leads')
@UseGuards(ClerkAuthGuard)
export class LeadsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('campaignId') campaignId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return withTenantTransaction(this.db, user.organizationId, (tx) => {
      const query = tx.select({
        id: leads.id,
        campaignId: leads.campaignId,
        phoneE164: leads.phoneE164,
        name: leads.name,
        status: leads.status,
        qualification: leads.qualification,
        qualificationScore: leads.qualificationScore,
        attemptCount: leads.attemptCount,
        lastAttemptAt: leads.lastAttemptAt,
        createdAt: leads.createdAt,
      })
        .from(leads)
        .where(and(
          eq(leads.organizationId, user.organizationId),
          ...(campaignId ? [eq(leads.campaignId, campaignId)] : []),
          ...(status ? [eq(leads.status, status as typeof leads.$inferSelect['status'])] : []),
        ))
        .orderBy(desc(leads.createdAt))
        .limit(100);
      return query;
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(leads)
        .where(and(eq(leads.organizationId, user.organizationId), eq(leads.id, id)))
        .limit(1),
    );
    return row ?? null;
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: {
    campaignId: string;
    phoneE164: string;
    name?: string;
    source?: string;
    externalReference?: string;
    idempotencyKey?: string;
  }) {
    const idem = body.idempotencyKey ?? `${user.organizationId}:${body.campaignId}:${body.phoneE164}:${Date.now()}`;
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.insert(leads).values({
        organizationId: user.organizationId,
        campaignId: body.campaignId,
        phoneE164: body.phoneE164,
        name: body.name?.trim() || null,
        source: body.source?.trim() ?? 'manual',
        externalReference: body.externalReference?.trim() || null,
        idempotencyKey: idem,
      }).onConflictDoNothing().returning(),
    );
    return row ?? null;
  }
}
