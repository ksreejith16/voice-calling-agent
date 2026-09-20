import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { wallets, walletTransactions } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

@Controller('wallet')
@UseGuards(ClerkAuthGuard)
export class WalletController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async balance(@CurrentUser() user: AuthenticatedUser) {
    const [wallet] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(wallets)
        .where(eq(wallets.organizationId, user.organizationId))
        .limit(1),
    );
    if (!wallet) return null;
    const balance = wallet.balancePaise ?? 0n;
    const reserved = wallet.reservedPaise ?? 0n;
    return {
      id: wallet.id,
      currency: wallet.currency,
      balancePaise: balance.toString(),
      reservedPaise: reserved.toString(),
      availablePaise: (balance - reserved).toString(),
      balanceRupees: Number(balance) / 100,
      availableRupees: Number(balance - reserved) / 100,
    };
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit = '50') {
    const rows = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select({
        id: walletTransactions.id,
        reason: walletTransactions.reason,
        direction: walletTransactions.direction,
        amountPaise: walletTransactions.amountPaise,
        balanceAfterPaise: walletTransactions.balanceAfterPaise,
        description: walletTransactions.description,
        callId: walletTransactions.callId,
        createdAt: walletTransactions.createdAt,
      })
        .from(walletTransactions)
        .where(eq(walletTransactions.organizationId, user.organizationId))
        .orderBy(desc(walletTransactions.createdAt))
        .limit(Math.min(parseInt(limit, 10) || 50, 200)),
    );
    return rows.map((r) => ({
      ...r,
      amountPaise: r.amountPaise?.toString(),
      balanceAfterPaise: r.balanceAfterPaise?.toString(),
    }));
  }
}
