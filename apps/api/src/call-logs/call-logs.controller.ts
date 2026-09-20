import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { callLogs } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

@Controller('calls')
@UseGuards(ClerkAuthGuard)
export class CallLogsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('campaignId') campaignId?: string,
    @Query('leadId') leadId?: string,
  ) {
    return withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select({
        id: callLogs.id,
        campaignId: callLogs.campaignId,
        leadId: callLogs.leadId,
        status: callLogs.status,
        attemptNumber: callLogs.attemptNumber,
        connectedDurationSeconds: callLogs.connectedDurationSeconds,
        chargedPaise: callLogs.chargedPaise,
        settlementStatus: callLogs.settlementStatus,
        queuedAt: callLogs.queuedAt,
        connectedAt: callLogs.connectedAt,
        endedAt: callLogs.endedAt,
        errorCode: callLogs.errorCode,
      })
        .from(callLogs)
        .where(and(
          eq(callLogs.organizationId, user.organizationId),
          ...(campaignId ? [eq(callLogs.campaignId, campaignId)] : []),
          ...(leadId ? [eq(callLogs.leadId, leadId)] : []),
        ))
        .orderBy(desc(callLogs.queuedAt))
        .limit(100),
    );
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(callLogs)
        .where(and(eq(callLogs.organizationId, user.organizationId), eq(callLogs.id, id)))
        .limit(1),
    );
    return row ?? null;
  }
}
