import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { eq, count, sql, and } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { campaigns, leads, callLogs, wallets } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';
import type { AppConfig } from '../config';
import { APP_CONFIG } from '../config.token';

@Controller('dashboard')
@UseGuards(ClerkAuthGuard)
export class DashboardController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthenticatedUser) {
    const orgId = user.organizationId;

    const [wallet, campaignStats, leadStats, callStats] = await Promise.all([
      withTenantTransaction(this.db, orgId, (tx) =>
        tx.select({
          balancePaise: wallets.balancePaise,
          reservedPaise: wallets.reservedPaise,
        })
          .from(wallets)
          .where(eq(wallets.organizationId, orgId))
          .limit(1),
      ).then((rows) => rows[0] ?? null),

      withTenantTransaction(this.db, orgId, (tx) =>
        tx.select({
          status: campaigns.status,
          total: count(),
        })
          .from(campaigns)
          .where(eq(campaigns.organizationId, orgId))
          .groupBy(campaigns.status),
      ),

      withTenantTransaction(this.db, orgId, (tx) =>
        tx.select({
          status: leads.status,
          total: count(),
        })
          .from(leads)
          .where(eq(leads.organizationId, orgId))
          .groupBy(leads.status),
      ),

      withTenantTransaction(this.db, orgId, (tx) =>
        tx.select({
          status: callLogs.status,
          total: count(),
        })
          .from(callLogs)
          .where(eq(callLogs.organizationId, orgId))
          .groupBy(callLogs.status),
      ),
    ]);

    const toMap = <T extends { status: string; total: number }>(rows: T[]) =>
      Object.fromEntries(rows.map((r) => [r.status, r.total]));

    const campaignMap = toMap(campaignStats);
    const leadMap = toMap(leadStats);
    const callMap = toMap(callStats);

    const bal = wallet?.balancePaise ?? 0n;
    const res = wallet?.reservedPaise ?? 0n;

    return {
      wallet: {
        balancePaise: bal.toString(),
        reservedPaise: res.toString(),
        availablePaise: (bal - res).toString(),
        availableRupees: Number(bal - res) / 100,
      },
      campaigns: {
        running: campaignMap['running'] ?? 0,
        draft: campaignMap['draft'] ?? 0,
        paused: campaignMap['paused'] ?? 0,
        total: Object.values(campaignMap).reduce((a, b) => a + b, 0),
      },
      leads: {
        new: leadMap['new'] ?? 0,
        qualified: leadMap['qualified'] ?? 0,
        total: Object.values(leadMap).reduce((a, b) => a + b, 0),
      },
      calls: {
        connected: callMap['connected'] ?? 0,
        completed: callMap['completed'] ?? 0,
        failed: callMap['failed'] ?? 0,
        total: Object.values(callMap).reduce((a, b) => a + b, 0),
      },
      providerStatus: {
        voice: this.config.AUTH_MODE === 'clerk' ? 'configured' : 'disabled',
        auth: this.config.AUTH_MODE,
      },
    };
  }

  @Get('integrations')
  async integrations(@CurrentUser() _user: AuthenticatedUser) {
    return {
      sarvam: { status: 'not_verified', label: 'Sarvam AI (STT + TTS)', note: 'Add SARVAM_API_KEY to .env and test voice' },
      livekit: { status: 'not_verified', label: 'LiveKit', note: 'Running locally; configure cloud instance for production' },
      groq: { status: 'not_verified', label: 'Groq LLM', note: 'Add LLM_API_KEY, LLM_MODEL to .env' },
      razorpay: { status: 'not_configured', label: 'Razorpay Payments', note: 'Milestone 4 — not yet implemented' },
      exotel: { status: 'not_configured', label: 'Exotel Telephony', note: 'Milestone 5 — verify account capabilities first' },
      whatsapp: { status: 'not_configured', label: 'WhatsApp (Meta Cloud API)', note: 'Milestone 8 — not yet implemented' },
    };
  }
}
