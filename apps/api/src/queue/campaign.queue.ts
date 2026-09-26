import { Queue, Worker, type Job } from 'bullmq';
import type { Database } from '@india-voice/database';
import { campaigns, leads, callLogs, wallets, walletReservations } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { calculateReservationAmount } from '@india-voice/database';
import { eq, and, sql, count } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export interface DispatchJobData {
  organizationId: string;
  campaignId: string;
}

const QUEUE_NAME = 'campaign-dispatch';

/** Returns ms until the next calling window opens, or 0 if currently within window. */
function msUntilCallingWindow(cfg: { timezone: string; weekdays: number[]; startTime: string; endTime: string }): number {
  const now = new Date();

  // Get current time components in org timezone
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.timezone,
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'long',
  }).formatToParts(now);

  const hour2d = dateParts.find((p) => p.type === 'hour')?.value ?? '00';
  const min2d = dateParts.find((p) => p.type === 'minute')?.value ?? '00';
  const hm = `${hour2d}:${min2d}`;
  const weekdayName = dateParts.find((p) => p.type === 'weekday')?.value ?? '';
  const longDayMap: Record<string, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
  };
  const currentDay = longDayMap[weekdayName] ?? 0;

  const inWindow = cfg.weekdays.includes(currentDay) && hm >= cfg.startTime && hm < cfg.endTime;
  if (inWindow) return 0;

  // Out of window: re-enqueue in 60 minutes to re-check (simple, correct for prototype)
  // For same-day window that hasn't opened yet, this undershoots delay but is safe
  return 60 * 60 * 1000;
}

export function createCampaignQueue(redisUrl: string) {
  const connection = { url: redisUrl };
  return new Queue<DispatchJobData>(QUEUE_NAME, { connection });
}

async function reconcileExpiredReservations(db: Database, organizationId: string): Promise<void> {
  // Find active reservations past their expiry for this org and release them
  const expired = await withTenantTransaction(db, organizationId, (tx) =>
    tx.select({
      id: walletReservations.id,
      walletId: walletReservations.walletId,
      authorizedAmountPaise: walletReservations.authorizedAmountPaise,
    })
      .from(walletReservations)
      .where(and(
        eq(walletReservations.organizationId, organizationId),
        sql`${walletReservations.status} IN ('active', 'awaiting_settlement')`,
        sql`${walletReservations.expiresAt} < now()`,
      ))
      .limit(50),
  );

  if (expired.length === 0) return;

  const now = new Date();
  for (const res of expired) {
    try {
      await withTenantTransaction(db, organizationId, async (tx) => {
        await tx.update(walletReservations)
          .set({
            status: 'expired',
            releasedAmountPaise: res.authorizedAmountPaise,
            releasedAt: now,
            reconciliationRequestedAt: now,
            reconciledAt: now,
            reconciliationReference: 'expired_by_reconciler',
            updatedAt: now,
          })
          .where(and(
            eq(walletReservations.id, res.id),
            eq(walletReservations.organizationId, organizationId),
            sql`${walletReservations.status} IN ('active', 'awaiting_settlement')`,
          ));

        await tx.update(wallets)
          .set({
            reservedPaise: sql`greatest(0, ${wallets.reservedPaise} - ${res.authorizedAmountPaise})`,
            version: sql`${wallets.version} + 1`,
            updatedAt: now,
          })
          .where(and(
            eq(wallets.id, res.walletId),
            eq(wallets.organizationId, organizationId),
          ));
      });
    } catch (e) {
      console.error(`[reconciler] Failed to expire reservation ${res.id}:`, (e as Error).message);
    }
  }
  console.log(`[reconciler] Expired ${expired.length} stale reservation(s) for org ${organizationId}`);
}

export function createCampaignWorker(redisUrl: string, db: Database) {
  const connection = { url: redisUrl };
  const queue = new Queue<DispatchJobData>(QUEUE_NAME, { connection });

  const worker = new Worker<DispatchJobData>(QUEUE_NAME, async (job: Job<DispatchJobData>) => {
    const { organizationId, campaignId } = job.data;

    // Reconcile expired reservations for this org first
    await reconcileExpiredReservations(db, organizationId);

    // 1. Verify campaign is still running
    const [campaign] = await withTenantTransaction(db, organizationId, (tx) =>
      tx.select().from(campaigns)
        .where(and(eq(campaigns.organizationId, organizationId), eq(campaigns.id, campaignId)))
        .limit(1),
    );
    if (!campaign || campaign.status !== 'running') {
      return { status: 'skipped', reason: 'campaign_not_running' };
    }

    // 2. Check calling window (timezone, weekdays, time range)
    const callingCfg = campaign.callingConfiguration as { timezone: string; weekdays: number[]; startTime: string; endTime: string };
    const windowWaitMs = msUntilCallingWindow(callingCfg);
    if (windowWaitMs > 0) {
      await queue.add('dispatch', { organizationId, campaignId }, {
        delay: windowWaitMs, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100, removeOnFail: 200,
      });
      return { status: 'deferred', reason: 'outside_calling_window', windowWaitMs };
    }

    // 3. Enforce concurrency limit — count calls in active states for this campaign
    const [{ activeCalls }] = await withTenantTransaction(db, organizationId, (tx) =>
      tx.select({ activeCalls: count() })
        .from(callLogs)
        .where(and(
          eq(callLogs.organizationId, organizationId),
          eq(callLogs.campaignId, campaignId),
          sql`${callLogs.status} IN ('queued', 'dialing', 'ringing', 'connected')`,
        )),
    );
    if (activeCalls >= campaign.concurrencyLimit) {
      // Re-enqueue after a short delay to check again
      await queue.add('dispatch', { organizationId, campaignId }, {
        delay: 3000, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100, removeOnFail: 200,
      });
      return { status: 'deferred', reason: 'concurrency_limit_reached', activeCalls };
    }

    // 3. Verify wallet has available funds for at least one call
    const [wallet] = await withTenantTransaction(db, organizationId, (tx) =>
      tx.select().from(wallets).where(eq(wallets.organizationId, organizationId)).limit(1),
    );
    if (!wallet) return { status: 'skipped', reason: 'no_wallet' };

    const reservationAmount = calculateReservationAmount(
      BigInt(campaign.maxConnectedDurationSeconds),
      BigInt(campaign.terminationMarginSeconds),
      campaign.ratePaisePerMinute,
      campaign.billingQuantumSeconds as 30 | 60,
    );

    const available = (wallet.balancePaise ?? 0n) - (wallet.reservedPaise ?? 0n);
    if (available < reservationAmount) {
      await withTenantTransaction(db, organizationId, (tx) =>
        tx.update(campaigns)
          .set({ status: 'paused', pauseReason: 'Insufficient wallet balance', pauseNotificationPending: true, updatedAt: new Date() })
          .where(eq(campaigns.id, campaignId)),
      );
      return { status: 'paused', reason: 'insufficient_funds' };
    }

    // 4. Pick next eligible lead
    const [lead] = await withTenantTransaction(db, organizationId, (tx) =>
      tx.select({ id: leads.id, phoneE164: leads.phoneE164, attemptCount: leads.attemptCount })
        .from(leads)
        .where(and(
          eq(leads.organizationId, organizationId),
          eq(leads.campaignId, campaignId),
          sql`${leads.status} IN ('new', 'queued')`,
          sql`(${leads.nextAttemptAt} IS NULL OR ${leads.nextAttemptAt} <= now())`,
        ))
        .orderBy(leads.createdAt)
        .limit(1),
    );

    if (!lead) {
      // Check if any calls are still active (in-flight); if so, re-check later
      if (activeCalls > 0) {
        await queue.add('dispatch', { organizationId, campaignId }, {
          delay: 10000, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100, removeOnFail: 200,
        });
        return { status: 'deferred', reason: 'waiting_for_active_calls' };
      }

      // Check for leads with future nextAttemptAt (scheduled retries)
      const [futureLeadRow] = await withTenantTransaction(db, organizationId, (tx) =>
        tx.select({ nextAttemptAt: leads.nextAttemptAt })
          .from(leads)
          .where(and(
            eq(leads.organizationId, organizationId),
            eq(leads.campaignId, campaignId),
            eq(leads.status, 'queued'),
          ))
          .orderBy(leads.nextAttemptAt)
          .limit(1),
      );

      if (futureLeadRow?.nextAttemptAt) {
        const delayMs = Math.max(10000, futureLeadRow.nextAttemptAt.getTime() - Date.now());
        await queue.add('dispatch', { organizationId, campaignId }, {
          delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100, removeOnFail: 200,
        });
        return { status: 'deferred', reason: 'waiting_for_retry_window', nextAttemptAt: futureLeadRow.nextAttemptAt };
      }

      // All leads processed and no retries pending — campaign is done
      await withTenantTransaction(db, organizationId, (tx) =>
        tx.update(campaigns)
          .set({ status: 'completed', pauseReason: null, updatedAt: new Date() })
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running'))),
      );
      return { status: 'done', reason: 'all_leads_processed' };
    }

    // 5. Create call record + atomically reserve funds
    const callIdempotencyKey = `${organizationId}:${campaignId}:${lead.id}:${lead.attemptCount + 1}`;
    const callId = randomUUID();
    const reservationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (campaign.maxConnectedDurationSeconds + campaign.terminationMarginSeconds + 120) * 1000);

    await withTenantTransaction(db, organizationId, async (tx) => {
      await tx.update(leads)
        .set({ status: 'calling', attemptCount: sql`${leads.attemptCount} + 1`, lastAttemptAt: now, updatedAt: now })
        .where(eq(leads.id, lead.id));

      await tx.insert(callLogs).values({
        id: callId,
        organizationId,
        campaignId,
        leadId: lead.id,
        walletId: wallet.id,
        attemptNumber: lead.attemptCount + 1,
        idempotencyKey: callIdempotencyKey,
        provider: 'exotel',
        status: 'queued',
        ratePaisePerMinute: campaign.ratePaisePerMinute,
        billingQuantumSeconds: campaign.billingQuantumSeconds,
        maxConnectedDurationSeconds: campaign.maxConnectedDurationSeconds,
        terminationMarginSeconds: campaign.terminationMarginSeconds,
        settlementStatus: 'reserved',
      });

      await tx.insert(walletReservations).values({
        id: reservationId,
        organizationId,
        walletId: wallet.id,
        callId,
        idempotencyKey: `res:${callIdempotencyKey}`,
        authorizedAmountPaise: reservationAmount,
        ratePaisePerMinute: campaign.ratePaisePerMinute,
        billingQuantumSeconds: campaign.billingQuantumSeconds,
        maxConnectedDurationSeconds: campaign.maxConnectedDurationSeconds,
        terminationMarginSeconds: campaign.terminationMarginSeconds,
        expiresAt,
      });

      await tx.update(wallets)
        .set({
          reservedPaise: sql`${wallets.reservedPaise} + ${reservationAmount}`,
          version: sql`${wallets.version} + 1`,
          updatedAt: now,
        })
        .where(and(
          eq(wallets.id, wallet.id),
          sql`${wallets.balancePaise} - ${wallets.reservedPaise} >= ${reservationAmount}`,
        ));
    });

    // 6. Dispatch Exotel call (STUB — not yet configured)
    console.log(`[campaign-dispatch] Would call ${lead.phoneE164} for campaign ${campaignId}, call ${callId}`);

    // Determine retry disposition based on campaign retry config
    const currentAttempt = lead.attemptCount + 1; // DB was incremented before this
    const retryCfg = campaign.retryConfiguration as { maxAttempts: number; delaySeconds: number[]; retryableOutcomes: string[] };
    const exhausted = currentAttempt >= retryCfg.maxAttempts;
    const nextAttemptAt = exhausted
      ? null
      : new Date(Date.now() + (retryCfg.delaySeconds[currentAttempt - 1] ?? 3600) * 1000);

    await withTenantTransaction(db, organizationId, async (tx) => {
      const releaseNow = new Date();
      await tx.update(callLogs)
        .set({ status: 'failed', errorCode: 'telephony_not_configured', endedAt: releaseNow, updatedAt: releaseNow })
        .where(eq(callLogs.id, callId));
      await tx.update(leads)
        .set({
          status: exhausted ? 'exhausted' : 'queued',
          lastOutcome: 'telephony_not_configured',
          nextAttemptAt,
          updatedAt: releaseNow,
        })
        .where(eq(leads.id, lead.id));
      await tx.update(walletReservations)
        .set({
          status: 'released',
          releasedAmountPaise: reservationAmount,
          releasedAt: releaseNow,
          reconciledAt: releaseNow,
          reconciliationRequestedAt: releaseNow,
          reconciliationReference: 'dispatch_failed',
          updatedAt: releaseNow,
        })
        .where(eq(walletReservations.id, reservationId));
      await tx.update(wallets)
        .set({
          reservedPaise: sql`greatest(0, ${wallets.reservedPaise} - ${reservationAmount})`,
          version: sql`${wallets.version} + 1`,
          updatedAt: releaseNow,
        })
        .where(eq(wallets.id, wallet.id));
    });

    // 7. Re-enqueue to pick up next lead (with small delay to prevent tight loops)
    await queue.add('dispatch', { organizationId, campaignId }, {
      delay: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    return { status: 'dispatched_stub', callId, leadId: lead.id };
  }, { connection, concurrency: 3 });

  worker.on('failed', (job, err) => {
    console.error(`[campaign-dispatch] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
