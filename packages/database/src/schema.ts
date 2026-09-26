import { relations, sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text,
  timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { Attributes, CallingConfiguration, CapturedFields, ConsentEvidence, ExtractedAnalysis,
  OrganizationDefaults, RetryConfiguration, Transcript } from './validation';

export const organizationStatus = pgEnum('organization_status', ['active', 'suspended', 'closed']);
export const userRole = pgEnum('user_role', ['owner', 'admin', 'member', 'viewer']);
export const userStatus = pgEnum('user_status', ['invited', 'active', 'disabled']);
export const transactionReason = pgEnum('transaction_reason', ['top_up', 'call_charge', 'refund', 'manual_adjustment']);
export const transactionDirection = pgEnum('transaction_direction', ['credit', 'debit']);
export const reservationStatus = pgEnum('reservation_status', ['active', 'awaiting_settlement', 'settled', 'released', 'expired']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'scheduled', 'running', 'paused', 'completed', 'archived']);
export const leadStatus = pgEnum('lead_status', ['new', 'queued', 'calling', 'contacted', 'qualified', 'unqualified', 'do_not_call', 'exhausted']);
export const qualificationClass = pgEnum('qualification_class', ['hot', 'warm', 'cold']);
export const callStatus = pgEnum('call_status', ['queued', 'dialing', 'ringing', 'connected', 'completed', 'failed', 'cancelled', 'no_answer', 'busy']);
export const settlementStatus = pgEnum('settlement_status', ['unreserved', 'reserved', 'awaiting_settlement', 'settled', 'disputed']);
export const supportedLanguage = pgEnum('supported_language', ['te-IN', 'hi-IN', 'en-IN', 'te-en']);

const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
const tenantId = () => uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' });

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  status: organizationStatus('status').notNull().default('active'),
  defaults: jsonb('defaults').$type<OrganizationDefaults>().notNull().default({ language: 'en-IN', timezone: 'Asia/Kolkata' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...auditColumns(),
}, (table) => [
  check('organizations_name_nonempty', sql`length(trim(${table.name})) > 0`),
  check('organizations_defaults_object', sql`jsonb_typeof(${table.defaults}) = 'object'`),
  check('organizations_closed_consistent', sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL)`),
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  authIssuer: varchar('auth_issuer', { length: 500 }).notNull(),
  authSubject: varchar('auth_subject', { length: 300 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  role: userRole('role').notNull().default('member'),
  status: userStatus('status').notNull().default('invited'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...auditColumns(),
}, (table) => [
  unique('users_org_id_unique').on(table.organizationId, table.id),
  unique('users_org_auth_unique').on(table.organizationId, table.authIssuer, table.authSubject),
  uniqueIndex('users_org_email_unique').on(table.organizationId, sql`lower(${table.email})`),
  index('users_org_status_idx').on(table.organizationId, table.status),
  check('users_identity_nonempty', sql`length(trim(${table.authIssuer})) > 0 AND length(trim(${table.authSubject})) > 0`),
]);

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  balancePaise: bigint('balance_paise', { mode: 'bigint' }).notNull().default(sql`0`),
  reservedPaise: bigint('reserved_paise', { mode: 'bigint' }).notNull().default(sql`0`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`0`),
  ...auditColumns(),
}, (table) => [
  unique('wallets_org_unique').on(table.organizationId),
  unique('wallets_org_id_unique').on(table.organizationId, table.id),
  check('wallets_currency_inr', sql`${table.currency} = 'INR'`),
  check('wallets_funds_valid', sql`${table.balancePaise} >= 0 AND ${table.reservedPaise} >= 0 AND ${table.reservedPaise} <= ${table.balancePaise}`),
  check('wallets_version_nonnegative', sql`${table.version} >= 0`),
]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  name: varchar('name', { length: 200 }).notNull(),
  status: campaignStatus('status').notNull().default('draft'),
  goal: text('goal').notNull().default(''),
  persona: text('persona').notNull().default(''),
  script: text('script').notNull().default(''),
  language: supportedLanguage('language').notNull().default('en-IN'),
  voice: varchar('voice', { length: 100 }),
  capturedFields: jsonb('captured_fields').$type<CapturedFields>().notNull().default([]),
  retryConfiguration: jsonb('retry_configuration').$type<RetryConfiguration>().notNull()
    .default({ maxAttempts: 1, delaySeconds: [], retryableOutcomes: [] }),
  callingConfiguration: jsonb('calling_configuration').$type<CallingConfiguration>().notNull()
    .default({ timezone: 'Asia/Kolkata', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }),
  concurrencyLimit: integer('concurrency_limit').notNull().default(1),
  ratePaisePerMinute: bigint('rate_paise_per_minute', { mode: 'bigint' }).notNull(),
  billingQuantumSeconds: integer('billing_quantum_seconds').notNull().default(60),
  maxConnectedDurationSeconds: integer('max_connected_duration_seconds').notNull(),
  terminationMarginSeconds: integer('termination_margin_seconds').notNull().default(30),
  pauseReason: text('pause_reason'),
  pauseNotificationPending: boolean('pause_notification_pending').notNull().default(false),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  ...auditColumns(),
}, (table) => [
  unique('campaigns_org_id_unique').on(table.organizationId, table.id),
  index('campaigns_org_status_idx').on(table.organizationId, table.status),
  index('campaigns_scheduled_idx').on(table.scheduledAt).where(sql`${table.status} = 'scheduled'`),
  check('campaigns_name_nonempty', sql`length(trim(${table.name})) > 0`),
  check('campaigns_concurrency_positive', sql`${table.concurrencyLimit} > 0`),
  check('campaigns_billing_valid', sql`${table.ratePaisePerMinute} > 0 AND ${table.billingQuantumSeconds} IN (30, 60) AND (${table.billingQuantumSeconds} = 60 OR ${table.ratePaisePerMinute} % 2 = 0) AND ${table.maxConnectedDurationSeconds} > 0 AND ${table.terminationMarginSeconds} >= 0`),
  check('campaigns_json_shapes', sql`jsonb_typeof(${table.capturedFields}) = 'array' AND jsonb_typeof(${table.retryConfiguration}) = 'object' AND jsonb_typeof(${table.callingConfiguration}) = 'object'`),
]);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  campaignId: uuid('campaign_id').notNull(),
  phoneE164: varchar('phone_e164', { length: 16 }).notNull(),
  name: varchar('name', { length: 200 }),
  source: varchar('source', { length: 100 }).notNull(),
  externalReference: varchar('external_reference', { length: 300 }),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  attributes: jsonb('attributes').$type<Attributes>().notNull().default({}),
  consentEvidence: jsonb('consent_evidence').$type<ConsentEvidence>().notNull()
    .default({ voice: { status: 'unknown' }, whatsapp: { status: 'unknown' } }),
  status: leadStatus('status').notNull().default('new'),
  qualificationScore: integer('qualification_score'),
  qualification: qualificationClass('qualification'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastOutcome: varchar('last_outcome', { length: 100 }),
  ...auditColumns(),
}, (table) => [
  unique('leads_org_id_unique').on(table.organizationId, table.id),
  unique('leads_org_campaign_id_unique').on(table.organizationId, table.campaignId, table.id),
  unique('leads_org_idempotency_unique').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('leads_external_reference_unique').on(table.organizationId, table.campaignId, table.source, table.externalReference)
    .where(sql`${table.externalReference} IS NOT NULL`),
  foreignKey({ name: 'leads_campaign_tenant_fk', columns: [table.organizationId, table.campaignId], foreignColumns: [campaigns.organizationId, campaigns.id] }).onDelete('restrict'),
  index('leads_crm_idx').on(table.organizationId, table.campaignId, table.status, table.createdAt),
  index('leads_phone_idx').on(table.organizationId, table.phoneE164),
  index('leads_qualification_idx').on(table.organizationId, table.qualification, table.qualificationScore),
  index('leads_queue_idx').on(table.organizationId, table.nextAttemptAt).where(sql`${table.status} IN ('new', 'queued')`),
  check('leads_e164_valid', sql`${table.phoneE164} ~ '^[+][1-9][0-9]{7,14}$'`),
  check('leads_score_valid', sql`${table.qualificationScore} IS NULL OR ${table.qualificationScore} BETWEEN 1 AND 10`),
  check('leads_attempts_nonnegative', sql`${table.attemptCount} >= 0`),
  check('leads_json_shapes', sql`jsonb_typeof(${table.attributes}) = 'object' AND jsonb_typeof(${table.consentEvidence}) = 'object'`),
  check('leads_references_nonempty', sql`length(trim(${table.source})) > 0 AND length(trim(${table.idempotencyKey})) > 0`),
]);

export const callLogs = pgTable('call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  campaignId: uuid('campaign_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  walletId: uuid('wallet_id').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  provider: varchar('provider', { length: 100 }),
  providerAccountId: varchar('provider_account_id', { length: 200 }),
  providerCallId: varchar('provider_call_id', { length: 200 }),
  status: callStatus('status').notNull().default('queued'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  connectedDurationSeconds: integer('connected_duration_seconds'),
  durationVerifiedAt: timestamp('duration_verified_at', { withTimezone: true }),
  durationSourceReference: text('duration_source_reference'),
  ratePaisePerMinute: bigint('rate_paise_per_minute', { mode: 'bigint' }).notNull(),
  billingQuantumSeconds: integer('billing_quantum_seconds').notNull().default(60),
  maxConnectedDurationSeconds: integer('max_connected_duration_seconds').notNull(),
  terminationMarginSeconds: integer('termination_margin_seconds').notNull().default(30),
  billableSeconds: integer('billable_seconds').notNull().default(0),
  chargedPaise: bigint('charged_paise', { mode: 'bigint' }).notNull().default(sql`0`),
  settlementStatus: settlementStatus('settlement_status').notNull().default('unreserved'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  transcript: jsonb('transcript').$type<Transcript>(),
  transcriptObjectKey: text('transcript_object_key'),
  recordingObjectKey: text('recording_object_key'),
  recordingConsentGranted: boolean('recording_consent_granted').notNull().default(false),
  analysis: jsonb('analysis').$type<ExtractedAnalysis>(),
  errorCode: varchar('error_code', { length: 100 }),
  ...auditColumns(),
}, (table) => [
  unique('call_logs_org_id_unique').on(table.organizationId, table.id),
  unique('call_logs_org_wallet_id_unique').on(table.organizationId, table.walletId, table.id),
  unique('call_logs_attempt_unique').on(table.organizationId, table.leadId, table.attemptNumber),
  unique('call_logs_idempotency_unique').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('call_logs_provider_call_unique').on(table.provider, table.providerAccountId, table.providerCallId)
    .where(sql`${table.providerCallId} IS NOT NULL`),
  foreignKey({ name: 'call_logs_campaign_tenant_fk', columns: [table.organizationId, table.campaignId], foreignColumns: [campaigns.organizationId, campaigns.id] }).onDelete('restrict'),
  foreignKey({ name: 'call_logs_lead_campaign_tenant_fk', columns: [table.organizationId, table.campaignId, table.leadId], foreignColumns: [leads.organizationId, leads.campaignId, leads.id] }).onDelete('restrict'),
  foreignKey({ name: 'call_logs_wallet_tenant_fk', columns: [table.organizationId, table.walletId], foreignColumns: [wallets.organizationId, wallets.id] }).onDelete('restrict'),
  index('call_logs_history_idx').on(table.organizationId, table.campaignId, table.createdAt),
  index('call_logs_lead_history_idx').on(table.organizationId, table.leadId, table.createdAt),
  index('call_logs_settlement_idx').on(table.organizationId, table.settlementStatus, table.endedAt),
  index('call_logs_queue_idx').on(table.organizationId, table.queuedAt).where(sql`${table.status} = 'queued'`),
  check('call_logs_attempt_positive', sql`${table.attemptNumber} > 0`),
  check('call_logs_billing_valid', sql`${table.ratePaisePerMinute} > 0 AND ${table.billingQuantumSeconds} IN (30, 60) AND (${table.billingQuantumSeconds} = 60 OR ${table.ratePaisePerMinute} % 2 = 0) AND ${table.maxConnectedDurationSeconds} > 0 AND ${table.terminationMarginSeconds} >= 0`),
  check('call_logs_amounts_nonnegative', sql`${table.chargedPaise} >= 0 AND ${table.billableSeconds} >= 0 AND (${table.connectedDurationSeconds} IS NULL OR ${table.connectedDurationSeconds} >= 0)`),
  check('call_logs_provider_complete', sql`${table.providerCallId} IS NULL OR (${table.provider} IS NOT NULL AND ${table.providerAccountId} IS NOT NULL)`),
  check('call_logs_timing_valid', sql`(${table.endedAt} IS NULL OR ${table.startedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}) AND (${table.connectedAt} IS NULL OR ${table.startedAt} IS NULL OR ${table.connectedAt} >= ${table.startedAt}) AND (${table.endedAt} IS NULL OR ${table.connectedAt} IS NULL OR ${table.endedAt} >= ${table.connectedAt})`),
  check('call_logs_verified_duration_complete', sql`(${table.durationVerifiedAt} IS NULL AND ${table.durationSourceReference} IS NULL) OR (${table.durationVerifiedAt} IS NOT NULL AND ${table.durationSourceReference} IS NOT NULL AND ${table.connectedDurationSeconds} IS NOT NULL AND ${table.endedAt} IS NOT NULL AND ${table.status} IN ('completed', 'failed', 'cancelled', 'no_answer', 'busy'))`),
  check('call_logs_zero_connection_zero_charge', sql`(${table.connectedDurationSeconds} IS NOT NULL AND ${table.connectedDurationSeconds} > 0) OR (${table.chargedPaise} = 0 AND ${table.billableSeconds} = 0)`),
  check('call_logs_settled_consistent', sql`(${table.settlementStatus} = 'settled') = (${table.settledAt} IS NOT NULL) AND (${table.settlementStatus} <> 'settled' OR (${table.durationVerifiedAt} IS NOT NULL AND ${table.endedAt} IS NOT NULL AND ${table.billableSeconds} = ceil(${table.connectedDurationSeconds}::numeric / ${table.billingQuantumSeconds}) * ${table.billingQuantumSeconds} AND ${table.chargedPaise}::numeric = ${table.billableSeconds}::numeric * ${table.ratePaisePerMinute} / 60 AND ${table.connectedDurationSeconds}::numeric <= ${table.maxConnectedDurationSeconds}::numeric + ${table.terminationMarginSeconds}))`),
  check('call_logs_json_shapes', sql`(${table.transcript} IS NULL OR jsonb_typeof(${table.transcript}) = 'array') AND (${table.analysis} IS NULL OR jsonb_typeof(${table.analysis}) = 'object')`),
  check('call_logs_recording_consent', sql`${table.recordingObjectKey} IS NULL OR ${table.recordingConsentGranted}`),
  check('call_logs_idempotency_nonempty', sql`length(trim(${table.idempotencyKey})) > 0`),
]);

export const walletReservations = pgTable('wallet_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  walletId: uuid('wallet_id').notNull(),
  callId: uuid('call_id').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  status: reservationStatus('status').notNull().default('active'),
  authorizedAmountPaise: bigint('authorized_amount_paise', { mode: 'bigint' }).notNull(),
  settledAmountPaise: bigint('settled_amount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
  releasedAmountPaise: bigint('released_amount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
  ratePaisePerMinute: bigint('rate_paise_per_minute', { mode: 'bigint' }).notNull(),
  billingQuantumSeconds: integer('billing_quantum_seconds').notNull().default(60),
  maxConnectedDurationSeconds: integer('max_connected_duration_seconds').notNull(),
  terminationMarginSeconds: integer('termination_margin_seconds').notNull().default(30),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  reconciliationRequestedAt: timestamp('reconciliation_requested_at', { withTimezone: true }),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciliationReference: text('reconciliation_reference'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  ...auditColumns(),
}, (table) => [
  unique('wallet_reservations_org_id_unique').on(table.organizationId, table.id),
  unique('wallet_reservations_ownership_unique').on(table.organizationId, table.walletId, table.callId, table.id),
  unique('wallet_reservations_call_unique').on(table.organizationId, table.callId),
  unique('wallet_reservations_idempotency_unique').on(table.organizationId, table.idempotencyKey),
  foreignKey({ name: 'wallet_reservations_wallet_tenant_fk', columns: [table.organizationId, table.walletId], foreignColumns: [wallets.organizationId, wallets.id] }).onDelete('restrict'),
  foreignKey({ name: 'wallet_reservations_call_wallet_tenant_fk', columns: [table.organizationId, table.walletId, table.callId], foreignColumns: [callLogs.organizationId, callLogs.walletId, callLogs.id] }).onDelete('restrict'),
  index('wallet_reservations_reconcile_idx').on(table.organizationId, table.status, table.expiresAt)
    .where(sql`${table.status} IN ('active', 'awaiting_settlement')`),
  check('wallet_reservations_billing_valid', sql`${table.ratePaisePerMinute} > 0 AND ${table.billingQuantumSeconds} IN (30, 60) AND (${table.billingQuantumSeconds} = 60 OR ${table.ratePaisePerMinute} % 2 = 0) AND ${table.maxConnectedDurationSeconds} > 0 AND ${table.terminationMarginSeconds} >= 0`),
  check('wallet_reservations_authorization_valid', sql`${table.authorizedAmountPaise} >= ${table.ratePaisePerMinute} AND ${table.authorizedAmountPaise}::numeric = ceil((${table.maxConnectedDurationSeconds}::numeric + ${table.terminationMarginSeconds}) / ${table.billingQuantumSeconds}) * ${table.billingQuantumSeconds} * ${table.ratePaisePerMinute} / 60`),
  check('wallet_reservations_amounts_valid', sql`${table.authorizedAmountPaise} > 0 AND ${table.settledAmountPaise} >= 0 AND ${table.releasedAmountPaise} >= 0 AND ${table.settledAmountPaise}::numeric + ${table.releasedAmountPaise} <= ${table.authorizedAmountPaise}`),
  check('wallet_reservations_accounting_valid', sql`(${table.status} IN ('active', 'awaiting_settlement') AND ${table.settledAmountPaise} = 0 AND ${table.releasedAmountPaise} = 0 AND ${table.settledAt} IS NULL AND ${table.releasedAt} IS NULL) OR (${table.status} = 'settled' AND ${table.settledAmountPaise}::numeric + ${table.releasedAmountPaise} = ${table.authorizedAmountPaise} AND ${table.settledAt} IS NOT NULL AND (${table.releasedAmountPaise} = 0 OR ${table.releasedAt} IS NOT NULL)) OR (${table.status} IN ('released', 'expired') AND ${table.settledAmountPaise} = 0 AND ${table.releasedAmountPaise} = ${table.authorizedAmountPaise} AND ${table.releasedAt} IS NOT NULL AND ${table.settledAt} IS NULL)`),
  check('wallet_reservations_reconciliation_valid', sql`(${table.reconciledAt} IS NULL AND ${table.reconciliationReference} IS NULL) OR (${table.reconciledAt} IS NOT NULL AND ${table.reconciliationReference} IS NOT NULL AND ${table.reconciliationRequestedAt} IS NOT NULL)`),
  check('wallet_reservations_expiry_reconciled', sql`${table.status} <> 'expired' OR (${table.reconciledAt} IS NOT NULL AND ${table.reconciliationReference} IS NOT NULL)`),
  check('wallet_reservations_expiry_future', sql`${table.expiresAt} > ${table.createdAt}`),
  check('wallet_reservations_idempotency_nonempty', sql`length(trim(${table.idempotencyKey})) > 0`),
]);

export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  walletId: uuid('wallet_id').notNull(),
  callId: uuid('call_id'),
  reservationId: uuid('reservation_id'),
  reason: transactionReason('reason').notNull(),
  direction: transactionDirection('direction').notNull(),
  amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
  balanceBeforePaise: bigint('balance_before_paise', { mode: 'bigint' }).notNull(),
  balanceAfterPaise: bigint('balance_after_paise', { mode: 'bigint' }).notNull(),
  reservedBeforePaise: bigint('reserved_before_paise', { mode: 'bigint' }).notNull(),
  reservedAfterPaise: bigint('reserved_after_paise', { mode: 'bigint' }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  provider: varchar('provider', { length: 100 }),
  providerAccountId: varchar('provider_account_id', { length: 200 }),
  providerEventId: varchar('provider_event_id', { length: 200 }),
  providerPaymentId: varchar('provider_payment_id', { length: 200 }),
  paymentVerifiedAt: timestamp('payment_verified_at', { withTimezone: true }),
  description: text('description').notNull(),
  metadata: jsonb('metadata').$type<Attributes>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('wallet_transactions_org_id_unique').on(table.organizationId, table.id),
  unique('wallet_transactions_idempotency_unique').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('wallet_transactions_provider_event_unique').on(table.provider, table.providerAccountId, table.providerEventId)
    .where(sql`${table.providerEventId} IS NOT NULL`),
  uniqueIndex('wallet_transactions_payment_credit_unique').on(table.provider, table.providerAccountId, table.providerPaymentId)
    .where(sql`${table.reason} = 'top_up'`),
  uniqueIndex('wallet_transactions_call_charge_unique').on(table.organizationId, table.callId)
    .where(sql`${table.reason} = 'call_charge'`),
  foreignKey({ name: 'wallet_transactions_wallet_tenant_fk', columns: [table.organizationId, table.walletId], foreignColumns: [wallets.organizationId, wallets.id] }).onDelete('restrict'),
  foreignKey({ name: 'wallet_transactions_call_wallet_tenant_fk', columns: [table.organizationId, table.walletId, table.callId], foreignColumns: [callLogs.organizationId, callLogs.walletId, callLogs.id] }).onDelete('restrict'),
  foreignKey({ name: 'wallet_transactions_reservation_tenant_fk', columns: [table.organizationId, table.walletId, table.callId, table.reservationId], foreignColumns: [walletReservations.organizationId, walletReservations.walletId, walletReservations.callId, walletReservations.id] }).onDelete('restrict'),
  index('wallet_transactions_history_idx').on(table.organizationId, table.walletId, table.createdAt),
  check('wallet_transactions_amount_positive', sql`${table.amountPaise} > 0`),
  check('wallet_transactions_balances_valid', sql`${table.balanceBeforePaise} >= 0 AND ${table.balanceAfterPaise} >= 0 AND ${table.reservedBeforePaise} >= 0 AND ${table.reservedAfterPaise} >= 0 AND ${table.reservedBeforePaise} <= ${table.balanceBeforePaise} AND ${table.reservedAfterPaise} <= ${table.balanceAfterPaise}`),
  check('wallet_transactions_balance_delta', sql`(${table.direction} = 'credit' AND ${table.balanceAfterPaise}::numeric = ${table.balanceBeforePaise}::numeric + ${table.amountPaise}) OR (${table.direction} = 'debit' AND ${table.balanceAfterPaise}::numeric = ${table.balanceBeforePaise}::numeric - ${table.amountPaise})`),
  check('wallet_transactions_reason_direction', sql`(${table.reason} NOT IN ('top_up', 'refund') OR ${table.direction} = 'credit') AND (${table.reason} <> 'call_charge' OR (${table.direction} = 'debit' AND ${table.callId} IS NOT NULL AND ${table.reservationId} IS NOT NULL))`),
  check('wallet_transactions_payment_verified', sql`${table.reason} <> 'top_up' OR (${table.provider} IS NOT NULL AND ${table.providerAccountId} IS NOT NULL AND ${table.providerEventId} IS NOT NULL AND ${table.providerPaymentId} IS NOT NULL AND ${table.paymentVerifiedAt} IS NOT NULL AND ${table.callId} IS NULL AND ${table.reservationId} IS NULL)`),
  check('wallet_transactions_provider_complete', sql`(${table.providerEventId} IS NULL AND ${table.providerPaymentId} IS NULL) OR (${table.provider} IS NOT NULL AND ${table.providerAccountId} IS NOT NULL)`),
  check('wallet_transactions_reservation_has_call', sql`${table.reservationId} IS NULL OR ${table.callId} IS NOT NULL`),
  check('wallet_transactions_metadata_object', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  check('wallet_transactions_audit_nonempty', sql`length(trim(${table.idempotencyKey})) > 0 AND length(trim(${table.description})) > 0`),
]);

export const agentConfigs = pgTable('agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description').notNull().default(''),
  language: supportedLanguage('language').notNull().default('en-IN'),
  voice: varchar('voice', { length: 100 }),
  instructions: text('instructions').notNull().default(''),
  openingMessage: text('opening_message').notNull().default(''),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  ...auditColumns(),
}, (table) => [
  unique('agent_configs_org_id_unique').on(table.organizationId, table.id),
  index('agent_configs_org_status_idx').on(table.organizationId, table.status),
  check('agent_configs_name_nonempty', sql`length(trim(${table.name})) > 0`),
  check('agent_configs_status_valid', sql`${table.status} IN ('active', 'archived')`),
]);

// Browser tests are deliberately separate from billable telephone call records.
export const paymentOrderStatus = pgEnum('payment_order_status', ['created', 'paid', 'failed', 'expired', 'refunded']);

export const paymentOrders = pgTable('payment_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  razorpayOrderId: varchar('razorpay_order_id', { length: 200 }).notNull().unique(),
  amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('INR'),
  status: paymentOrderStatus('status').notNull().default('created'),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  razorpayPaymentId: varchar('razorpay_payment_id', { length: 200 }),
  razorpaySignature: varchar('razorpay_signature', { length: 500 }),
  creditedAt: timestamp('credited_at', { withTimezone: true }),
  failedReason: varchar('failed_reason', { length: 200 }),
  ...auditColumns(),
}, (table) => [
  unique('payment_orders_org_id_unique').on(table.organizationId, table.id),
  unique('payment_orders_org_idem_unique').on(table.organizationId, table.idempotencyKey),
  index('payment_orders_org_status_idx').on(table.organizationId, table.status),
  check('payment_orders_amount_positive', sql`${table.amountPaise} > 0 AND ${table.amountPaise} <= 100000000`),
  check('payment_orders_currency_inr', sql`${table.currency} = 'INR'`),
  check('payment_orders_credited_consistent', sql`(${table.status} = 'paid') = (${table.creditedAt} IS NOT NULL)`),
]);

export const voiceTestSessions = pgTable('voice_test_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: tenantId(),
  agentId: uuid('agent_id').notNull(),
  userId: uuid('user_id').notNull(),
  room: varchar('room', { length: 100 }).notNull().unique(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 30 }).notNull().default('starting'),
  errorCode: varchar('error_code', { length: 80 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  ...auditColumns(),
}, (t) => [
  foreignKey({ name: 'voice_test_agent_tenant_fk', columns: [t.organizationId, t.agentId], foreignColumns: [agentConfigs.organizationId, agentConfigs.id] }),
  foreignKey({ name: 'voice_test_user_tenant_fk', columns: [t.organizationId, t.userId], foreignColumns: [users.organizationId, users.id] }),
  index('voice_test_history_idx').on(t.organizationId, t.createdAt),
  check('voice_test_status_valid', sql`${t.status} IN ('starting', 'active', 'ended', 'failed', 'expired')`),
]);

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  users: many(users), wallet: one(wallets), campaigns: many(campaigns), leads: many(leads), calls: many(callLogs),
}));
export const walletsRelations = relations(wallets, ({ one, many }) => ({
  organization: one(organizations, { fields: [wallets.organizationId], references: [organizations.id] }),
  transactions: many(walletTransactions), reservations: many(walletReservations), calls: many(callLogs),
}));
export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
}));
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  organization: one(organizations, { fields: [campaigns.organizationId], references: [organizations.id] }),
  leads: many(leads), calls: many(callLogs),
}));
export const leadsRelations = relations(leads, ({ one, many }) => ({
  organization: one(organizations, { fields: [leads.organizationId], references: [organizations.id] }),
  campaign: one(campaigns, { fields: [leads.organizationId, leads.campaignId], references: [campaigns.organizationId, campaigns.id] }),
  calls: many(callLogs),
}));
export const callLogsRelations = relations(callLogs, ({ one, many }) => ({
  organization: one(organizations, { fields: [callLogs.organizationId], references: [organizations.id] }),
  campaign: one(campaigns, { fields: [callLogs.organizationId, callLogs.campaignId], references: [campaigns.organizationId, campaigns.id] }),
  lead: one(leads, { fields: [callLogs.organizationId, callLogs.campaignId, callLogs.leadId], references: [leads.organizationId, leads.campaignId, leads.id] }),
  wallet: one(wallets, { fields: [callLogs.organizationId, callLogs.walletId], references: [wallets.organizationId, wallets.id] }),
  reservation: one(walletReservations), transactions: many(walletTransactions),
}));
export const walletReservationsRelations = relations(walletReservations, ({ one, many }) => ({
  wallet: one(wallets, { fields: [walletReservations.organizationId, walletReservations.walletId], references: [wallets.organizationId, wallets.id] }),
  call: one(callLogs, { fields: [walletReservations.organizationId, walletReservations.walletId, walletReservations.callId], references: [callLogs.organizationId, callLogs.walletId, callLogs.id] }),
  transactions: many(walletTransactions),
}));
export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  wallet: one(wallets, { fields: [walletTransactions.organizationId, walletTransactions.walletId], references: [wallets.organizationId, wallets.id] }),
  call: one(callLogs, { fields: [walletTransactions.organizationId, walletTransactions.walletId, walletTransactions.callId], references: [callLogs.organizationId, callLogs.walletId, callLogs.id] }),
  reservation: one(walletReservations, { fields: [walletTransactions.organizationId, walletTransactions.walletId, walletTransactions.callId, walletTransactions.reservationId], references: [walletReservations.organizationId, walletReservations.walletId, walletReservations.callId, walletReservations.id] }),
}));
