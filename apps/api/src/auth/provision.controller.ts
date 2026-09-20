import {
  Body, Controller, Get, Inject, Post, UnauthorizedException,
  BadRequestException, ConflictException, Headers,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import { eq, and } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { users, organizations, wallets } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { DATABASE } from '../database.token';
import { APP_CONFIG } from '../config.token';
import type { AppConfig } from '../config';

interface ProvisionBody {
  orgName: string;
  language?: string;
  displayName?: string;
}

@Controller('auth')
export class ProvisionController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('provision')
  async provision(
    @Headers('authorization') authHeader: string | undefined,
    @Body() body: ProvisionBody,
  ) {
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing authorization token');
    const token = authHeader.slice(7);

    let payload: { sub: string; iss: string; email_addresses?: Array<{ email_address: string }> };
    try {
      payload = await verifyToken(token, { secretKey: this.config.CLERK_SECRET_KEY ?? '' }) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const { orgName, language = 'en-IN', displayName = '' } = body;
    if (!orgName?.trim()) throw new BadRequestException('orgName is required');

    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'my-org';
    const validLanguages = ['te-IN', 'hi-IN', 'en-IN', 'te-en'];
    const safeLanguage = validLanguages.includes(language) ? language : 'en-IN';

    type ProvisionRow = { organization_id: string; user_id: string; wallet_id: string };
    const result = await this.db.execute(
      sql`SELECT organization_id, user_id, wallet_id FROM provision_new_tenant(
        ${orgName.trim()}, ${slug}, ${safeLanguage}::supported_language,
        ${payload.iss}, ${payload.sub},
        ${(payload as { email?: string }).email ?? ''},
        ${displayName.trim()}
      )`,
    );
    const row = result.rows[0] as ProvisionRow | undefined;
    if (!row) throw new ConflictException('Provisioning failed');

    return {
      organizationId: row.organization_id,
      userId: row.user_id,
      walletId: row.wallet_id,
    };
  }

  @Get('me')
  async me(@Headers('authorization') authHeader: string | undefined) {
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing authorization token');
    const token = authHeader.slice(7);

    let payload: { sub: string; iss: string };
    try {
      payload = await verifyToken(token, { secretKey: this.config.CLERK_SECRET_KEY ?? '' });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    type Row = { organization_id: string; user_id: string; user_role: string };
    const result = await this.db.execute(
      sql`SELECT organization_id, user_id, user_role FROM resolve_tenant_identity(${payload.iss}, ${payload.sub})`,
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) return { provisioned: false };

    const [org] = await withTenantTransaction(this.db, row.organization_id, (tx) =>
      tx.select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
        defaults: organizations.defaults,
      })
        .from(organizations)
        .where(eq(organizations.id, row.organization_id))
        .limit(1),
    );

    const [wallet] = await withTenantTransaction(this.db, row.organization_id, (tx) =>
      tx.select({
        id: wallets.id,
        balancePaise: wallets.balancePaise,
        reservedPaise: wallets.reservedPaise,
      })
        .from(wallets)
        .where(eq(wallets.organizationId, row.organization_id))
        .limit(1),
    );

    return {
      provisioned: true,
      userId: row.user_id,
      role: row.user_role,
      organization: org,
      wallet: wallet ? {
        id: wallet.id,
        balancePaise: wallet.balancePaise?.toString(),
        reservedPaise: wallet.reservedPaise?.toString(),
        availablePaise: ((wallet.balancePaise ?? 0n) - (wallet.reservedPaise ?? 0n)).toString(),
      } : null,
    };
  }
}
