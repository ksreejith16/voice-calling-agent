import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { wallets, walletTransactions, paymentOrders } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import Razorpay from 'razorpay';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';
import type { AppConfig } from '../config';
import { APP_CONFIG } from '../config.token';

const MIN_TOPUP_PAISE = 10000n;   // ₹100 minimum
const MAX_TOPUP_PAISE = 10000000n; // ₹1,00,000 maximum per order

@Controller('wallet')
export class WalletController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @UseGuards(ClerkAuthGuard)
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
  @UseGuards(ClerkAuthGuard)
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

  /** POST /wallet/topup/order — create a Razorpay order for wallet top-up. */
  @Post('topup/order')
  @UseGuards(ClerkAuthGuard)
  async createTopupOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amountPaise: number },
  ) {
    if (!this.config.RAZORPAY_KEY_ID || !this.config.RAZORPAY_KEY_SECRET) {
      throw new BadRequestException('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');
    }
    const amount = BigInt(Math.round(body.amountPaise ?? 0));
    if (amount < MIN_TOPUP_PAISE) throw new BadRequestException(`Minimum top-up is ₹${Number(MIN_TOPUP_PAISE) / 100}`);
    if (amount > MAX_TOPUP_PAISE) throw new BadRequestException(`Maximum top-up is ₹${Number(MAX_TOPUP_PAISE) / 100}`);

    const razorpay = new Razorpay({ key_id: this.config.RAZORPAY_KEY_ID, key_secret: this.config.RAZORPAY_KEY_SECRET });
    const idemKey = `topup:${user.organizationId}:${Date.now()}:${randomUUID().slice(0, 8)}`;

    const order = await razorpay.orders.create({
      amount: Number(amount),
      currency: 'INR',
      receipt: idemKey.slice(0, 40),
      notes: { org_id: user.organizationId },
    });

    await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.insert(paymentOrders).values({
        organizationId: user.organizationId,
        razorpayOrderId: order.id,
        amountPaise: amount,
        idempotencyKey: idemKey,
      }),
    );

    return { orderId: order.id, amountPaise: amount.toString(), currency: 'INR', keyId: this.config.RAZORPAY_KEY_ID };
  }

  /** POST /wallet/topup/webhook — Razorpay calls this after payment. No Clerk auth — uses HMAC. */
  @Post('topup/webhook')
  async razorpayWebhook(@Req() req: { rawBody?: string; body: unknown }, @Body() body: Record<string, unknown>) {
    const signature = (req as { headers?: Record<string, string> } & typeof req).headers?.['x-razorpay-signature'] ?? '';
    if (!this.config.RAZORPAY_WEBHOOK_SECRET) {
      console.warn('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured');
      return { status: 'ignored' };
    }

    // Verify HMAC-SHA256 on raw body
    const rawBody = req.rawBody ?? JSON.stringify(body);
    const expected = createHmac('sha256', this.config.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      console.warn('Razorpay webhook: invalid signature');
      return { status: 'rejected' };
    }

    const event = body['event'] as string;
    if (event !== 'payment.captured') return { status: 'ignored' };

    const payload = body['payload'] as Record<string, unknown>;
    const paymentEntity = (payload['payment'] as Record<string, unknown>)?.['entity'] as Record<string, unknown>;
    if (!paymentEntity) return { status: 'ignored' };

    const razorpayOrderId = paymentEntity['order_id'] as string;
    const razorpayPaymentId = paymentEntity['id'] as string;
    const notes = paymentEntity['notes'] as Record<string, string> | undefined;
    const organizationId = notes?.['org_id'];

    if (!razorpayOrderId || !razorpayPaymentId || !organizationId) return { status: 'ignored' };

    // Look up the order within the org's RLS context (org_id from notes is HMAC-verified above)
    const [order] = await withTenantTransaction(this.db, organizationId, (tx) =>
      tx.select({ id: paymentOrders.id, organizationId: paymentOrders.organizationId, amountPaise: paymentOrders.amountPaise, status: paymentOrders.status })
        .from(paymentOrders)
        .where(and(eq(paymentOrders.razorpayOrderId, razorpayOrderId), eq(paymentOrders.organizationId, organizationId)))
        .limit(1),
    ).catch(() => [undefined]);

    if (!order || order.status !== 'created') return { status: 'already_processed' };

    // Atomic: mark order paid + credit wallet + append ledger
    await withTenantTransaction(this.db, order.organizationId, async (tx) => {
      // Mark order paid (idempotent — unique constraint on razorpay_payment_id would catch duplicates)
      await tx.update(paymentOrders)
        .set({ status: 'paid', razorpayPaymentId, razorpaySignature: razorpayPaymentId, creditedAt: new Date(), updatedAt: new Date() })
        .where(eq(paymentOrders.id, order.id));

      // Credit wallet: increment balance
      const [wallet] = await tx.select({ id: wallets.id, balancePaise: wallets.balancePaise, reservedPaise: wallets.reservedPaise })
        .from(wallets).where(eq(wallets.organizationId, order.organizationId)).limit(1);
      if (!wallet) throw new Error('Wallet not found for org ' + order.organizationId);

      const balBefore = wallet.balancePaise ?? 0n;
      const balAfter = balBefore + order.amountPaise;
      const resBefore = wallet.reservedPaise ?? 0n;

      await tx.update(wallets)
        .set({ balancePaise: balAfter, version: sql`${wallets.version} + 1`, updatedAt: new Date() })
        .where(eq(wallets.id, wallet.id));

      await tx.insert(walletTransactions).values({
        organizationId: order.organizationId,
        walletId: wallet.id,
        reason: 'top_up',
        direction: 'credit',
        amountPaise: order.amountPaise,
        balanceBeforePaise: balBefore,
        balanceAfterPaise: balAfter,
        reservedBeforePaise: resBefore,
        reservedAfterPaise: resBefore,
        idempotencyKey: `topup:${razorpayPaymentId}`,
        provider: 'razorpay',
        providerAccountId: this.config.RAZORPAY_KEY_ID ?? 'unknown',
        providerEventId: razorpayPaymentId,
        providerPaymentId: razorpayPaymentId,
        paymentVerifiedAt: new Date(),
        description: `Razorpay top-up ₹${(Number(order.amountPaise) / 100).toFixed(2)}`,
      });
    });

    return { status: 'credited' };
  }
}
