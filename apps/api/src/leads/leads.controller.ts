import {
  BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe,
  Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { leads } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

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

  @Post('import')
  async import_(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { campaignId: string; rows: Array<{ phone: string; name?: string; externalReference?: string }> },
  ) {
    if (!body.campaignId || !Array.isArray(body.rows)) throw new BadRequestException('campaignId and rows[] are required');
    if (body.rows.length === 0) return { total: 0, imported: 0, skipped: 0, errors: [] };
    if (body.rows.length > 5000) throw new BadRequestException('Maximum 5000 rows per import');

    const errors: { row: number; field: string; message: string }[] = [];
    const valid: typeof body.rows = [];
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i]!;
      if (!row.phone || typeof row.phone !== 'string') {
        errors.push({ row: i + 1, field: 'phone', message: 'Missing phone number' });
        continue;
      }
      const phone = row.phone.trim();
      if (!E164_RE.test(phone)) {
        errors.push({ row: i + 1, field: 'phone', message: `Invalid E.164 format: ${phone}` });
        continue;
      }
      valid.push({ phone, name: row.name?.trim() || undefined, externalReference: row.externalReference?.trim() || undefined });
    }

    let imported = 0; let skipped = 0;
    if (valid.length > 0) {
      const inserted = await withTenantTransaction(this.db, user.organizationId, (tx) =>
        tx.insert(leads).values(valid.map((r) => ({
          organizationId: user.organizationId,
          campaignId: body.campaignId,
          phoneE164: r.phone,
          name: r.name ?? null,
          source: 'csv_import',
          externalReference: r.externalReference ?? null,
          idempotencyKey: `${user.organizationId}:${body.campaignId}:csv:${r.phone}`,
        }))).onConflictDoNothing().returning({ id: leads.id }),
      );
      imported = inserted.length;
      skipped = valid.length - imported;
    }

    return { total: body.rows.length, imported, skipped, errors };
  }

  @Patch(':id')
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string },
  ) {
    const allowedStatuses = ['do_not_call', 'new', 'queued'];
    if (body.status !== undefined && !allowedStatuses.includes(body.status)) {
      throw new BadRequestException(`status must be one of: ${allowedStatuses.join(', ')}`);
    }
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(leads)
        .set({
          ...(body.status ? { status: body.status as typeof leads.$inferSelect['status'] } : {}),
          ...(body.status === 'do_not_call' ? { nextAttemptAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(leads.organizationId, user.organizationId), eq(leads.id, id)))
        .returning({ id: leads.id, status: leads.status }),
    );
    if (!row) throw new BadRequestException('Lead not found');
    return row;
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
