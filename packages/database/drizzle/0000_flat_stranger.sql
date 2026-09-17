CREATE TYPE "public"."call_status" AS ENUM('queued', 'dialing', 'ringing', 'connected', 'completed', 'failed', 'cancelled', 'no_answer', 'busy');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'queued', 'calling', 'contacted', 'qualified', 'unqualified', 'do_not_call', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."qualification_class" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'awaiting_settlement', 'settled', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('unreserved', 'reserved', 'awaiting_settlement', 'settled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."supported_language" AS ENUM('te-IN', 'hi-IN', 'en-IN', 'te-en');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."transaction_reason" AS ENUM('top_up', 'call_charge', 'refund', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"provider" varchar(100),
	"provider_account_id" varchar(200),
	"provider_call_id" varchar(200),
	"status" "call_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"connected_duration_seconds" integer,
	"duration_verified_at" timestamp with time zone,
	"duration_source_reference" text,
	"rate_paise_per_minute" bigint NOT NULL,
	"billing_quantum_seconds" integer DEFAULT 60 NOT NULL,
	"max_connected_duration_seconds" integer NOT NULL,
	"termination_margin_seconds" integer DEFAULT 30 NOT NULL,
	"billable_seconds" integer DEFAULT 0 NOT NULL,
	"charged_paise" bigint DEFAULT 0 NOT NULL,
	"settlement_status" "settlement_status" DEFAULT 'unreserved' NOT NULL,
	"settled_at" timestamp with time zone,
	"transcript" jsonb,
	"transcript_object_key" text,
	"recording_object_key" text,
	"recording_consent_granted" boolean DEFAULT false NOT NULL,
	"analysis" jsonb,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_logs_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "call_logs_org_wallet_id_unique" UNIQUE("organization_id","wallet_id","id"),
	CONSTRAINT "call_logs_attempt_unique" UNIQUE("organization_id","lead_id","attempt_number"),
	CONSTRAINT "call_logs_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "call_logs_attempt_positive" CHECK ("call_logs"."attempt_number" > 0),
	CONSTRAINT "call_logs_billing_valid" CHECK ("call_logs"."rate_paise_per_minute" > 0 AND "call_logs"."billing_quantum_seconds" IN (30, 60) AND ("call_logs"."billing_quantum_seconds" = 60 OR "call_logs"."rate_paise_per_minute" % 2 = 0) AND "call_logs"."max_connected_duration_seconds" > 0 AND "call_logs"."termination_margin_seconds" >= 0),
	CONSTRAINT "call_logs_amounts_nonnegative" CHECK ("call_logs"."charged_paise" >= 0 AND "call_logs"."billable_seconds" >= 0 AND ("call_logs"."connected_duration_seconds" IS NULL OR "call_logs"."connected_duration_seconds" >= 0)),
	CONSTRAINT "call_logs_provider_complete" CHECK ("call_logs"."provider_call_id" IS NULL OR ("call_logs"."provider" IS NOT NULL AND "call_logs"."provider_account_id" IS NOT NULL)),
	CONSTRAINT "call_logs_timing_valid" CHECK (("call_logs"."ended_at" IS NULL OR "call_logs"."started_at" IS NULL OR "call_logs"."ended_at" >= "call_logs"."started_at") AND ("call_logs"."connected_at" IS NULL OR "call_logs"."started_at" IS NULL OR "call_logs"."connected_at" >= "call_logs"."started_at") AND ("call_logs"."ended_at" IS NULL OR "call_logs"."connected_at" IS NULL OR "call_logs"."ended_at" >= "call_logs"."connected_at")),
	CONSTRAINT "call_logs_verified_duration_complete" CHECK (("call_logs"."duration_verified_at" IS NULL AND "call_logs"."duration_source_reference" IS NULL) OR ("call_logs"."duration_verified_at" IS NOT NULL AND "call_logs"."duration_source_reference" IS NOT NULL AND "call_logs"."connected_duration_seconds" IS NOT NULL AND "call_logs"."ended_at" IS NOT NULL AND "call_logs"."status" IN ('completed', 'failed', 'cancelled', 'no_answer', 'busy'))),
	CONSTRAINT "call_logs_zero_connection_zero_charge" CHECK (("call_logs"."connected_duration_seconds" IS NOT NULL AND "call_logs"."connected_duration_seconds" > 0) OR ("call_logs"."charged_paise" = 0 AND "call_logs"."billable_seconds" = 0)),
	CONSTRAINT "call_logs_settled_consistent" CHECK (("call_logs"."settlement_status" = 'settled') = ("call_logs"."settled_at" IS NOT NULL) AND ("call_logs"."settlement_status" <> 'settled' OR ("call_logs"."duration_verified_at" IS NOT NULL AND "call_logs"."ended_at" IS NOT NULL AND "call_logs"."billable_seconds" = ceil("call_logs"."connected_duration_seconds"::numeric / "call_logs"."billing_quantum_seconds") * "call_logs"."billing_quantum_seconds" AND "call_logs"."charged_paise"::numeric = "call_logs"."billable_seconds"::numeric * "call_logs"."rate_paise_per_minute" / 60 AND "call_logs"."connected_duration_seconds"::numeric <= "call_logs"."max_connected_duration_seconds"::numeric + "call_logs"."termination_margin_seconds"))),
	CONSTRAINT "call_logs_json_shapes" CHECK (("call_logs"."transcript" IS NULL OR jsonb_typeof("call_logs"."transcript") = 'array') AND ("call_logs"."analysis" IS NULL OR jsonb_typeof("call_logs"."analysis") = 'object')),
	CONSTRAINT "call_logs_recording_consent" CHECK ("call_logs"."recording_object_key" IS NULL OR "call_logs"."recording_consent_granted"),
	CONSTRAINT "call_logs_idempotency_nonempty" CHECK (length(trim("call_logs"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"language" "supported_language" DEFAULT 'en-IN' NOT NULL,
	"voice" varchar(100),
	"captured_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retry_configuration" jsonb DEFAULT '{"maxAttempts":1,"delaySeconds":[],"retryableOutcomes":[]}'::jsonb NOT NULL,
	"calling_configuration" jsonb DEFAULT '{"timezone":"Asia/Kolkata","weekdays":[1,2,3,4,5],"startTime":"09:00","endTime":"18:00"}'::jsonb NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"rate_paise_per_minute" bigint NOT NULL,
	"billing_quantum_seconds" integer DEFAULT 60 NOT NULL,
	"max_connected_duration_seconds" integer NOT NULL,
	"termination_margin_seconds" integer DEFAULT 30 NOT NULL,
	"pause_reason" text,
	"pause_notification_pending" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "campaigns_name_nonempty" CHECK (length(trim("campaigns"."name")) > 0),
	CONSTRAINT "campaigns_concurrency_positive" CHECK ("campaigns"."concurrency_limit" > 0),
	CONSTRAINT "campaigns_billing_valid" CHECK ("campaigns"."rate_paise_per_minute" > 0 AND "campaigns"."billing_quantum_seconds" IN (30, 60) AND ("campaigns"."billing_quantum_seconds" = 60 OR "campaigns"."rate_paise_per_minute" % 2 = 0) AND "campaigns"."max_connected_duration_seconds" > 0 AND "campaigns"."termination_margin_seconds" >= 0),
	CONSTRAINT "campaigns_json_shapes" CHECK (jsonb_typeof("campaigns"."captured_fields") = 'array' AND jsonb_typeof("campaigns"."retry_configuration") = 'object' AND jsonb_typeof("campaigns"."calling_configuration") = 'object')
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"phone_e164" varchar(16) NOT NULL,
	"name" varchar(200),
	"source" varchar(100) NOT NULL,
	"external_reference" varchar(300),
	"idempotency_key" varchar(200) NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_evidence" jsonb DEFAULT '{"voice":{"status":"unknown"},"whatsapp":{"status":"unknown"}}'::jsonb NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"qualification_score" integer,
	"qualification" "qualification_class",
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_outcome" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "leads_org_campaign_id_unique" UNIQUE("organization_id","campaign_id","id"),
	CONSTRAINT "leads_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "leads_e164_valid" CHECK ("leads"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "leads_score_valid" CHECK ("leads"."qualification_score" IS NULL OR "leads"."qualification_score" BETWEEN 1 AND 10),
	CONSTRAINT "leads_attempts_nonnegative" CHECK ("leads"."attempt_count" >= 0),
	CONSTRAINT "leads_json_shapes" CHECK (jsonb_typeof("leads"."attributes") = 'object' AND jsonb_typeof("leads"."consent_evidence") = 'object'),
	CONSTRAINT "leads_references_nonempty" CHECK (length(trim("leads"."source")) > 0 AND length(trim("leads"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"defaults" jsonb DEFAULT '{"language":"en-IN","timezone":"Asia/Kolkata"}'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name_nonempty" CHECK (length(trim("organizations"."name")) > 0),
	CONSTRAINT "organizations_defaults_object" CHECK (jsonb_typeof("organizations"."defaults") = 'object'),
	CONSTRAINT "organizations_closed_consistent" CHECK (("organizations"."status" = 'closed') = ("organizations"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auth_issuer" varchar(500) NOT NULL,
	"auth_subject" varchar(300) NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(200),
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "users_org_auth_unique" UNIQUE("organization_id","auth_issuer","auth_subject"),
	CONSTRAINT "users_identity_nonempty" CHECK (length(trim("users"."auth_issuer")) > 0 AND length(trim("users"."auth_subject")) > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"authorized_amount_paise" bigint NOT NULL,
	"settled_amount_paise" bigint DEFAULT 0 NOT NULL,
	"released_amount_paise" bigint DEFAULT 0 NOT NULL,
	"rate_paise_per_minute" bigint NOT NULL,
	"billing_quantum_seconds" integer DEFAULT 60 NOT NULL,
	"max_connected_duration_seconds" integer NOT NULL,
	"termination_margin_seconds" integer DEFAULT 30 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reconciliation_requested_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconciliation_reference" text,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_reservations_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "wallet_reservations_ownership_unique" UNIQUE("organization_id","wallet_id","call_id","id"),
	CONSTRAINT "wallet_reservations_call_unique" UNIQUE("organization_id","call_id"),
	CONSTRAINT "wallet_reservations_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "wallet_reservations_billing_valid" CHECK ("wallet_reservations"."rate_paise_per_minute" > 0 AND "wallet_reservations"."billing_quantum_seconds" IN (30, 60) AND ("wallet_reservations"."billing_quantum_seconds" = 60 OR "wallet_reservations"."rate_paise_per_minute" % 2 = 0) AND "wallet_reservations"."max_connected_duration_seconds" > 0 AND "wallet_reservations"."termination_margin_seconds" >= 0),
	CONSTRAINT "wallet_reservations_authorization_valid" CHECK ("wallet_reservations"."authorized_amount_paise" >= "wallet_reservations"."rate_paise_per_minute" AND "wallet_reservations"."authorized_amount_paise"::numeric = ceil(("wallet_reservations"."max_connected_duration_seconds"::numeric + "wallet_reservations"."termination_margin_seconds") / "wallet_reservations"."billing_quantum_seconds") * "wallet_reservations"."billing_quantum_seconds" * "wallet_reservations"."rate_paise_per_minute" / 60),
	CONSTRAINT "wallet_reservations_amounts_valid" CHECK ("wallet_reservations"."authorized_amount_paise" > 0 AND "wallet_reservations"."settled_amount_paise" >= 0 AND "wallet_reservations"."released_amount_paise" >= 0 AND "wallet_reservations"."settled_amount_paise"::numeric + "wallet_reservations"."released_amount_paise" <= "wallet_reservations"."authorized_amount_paise"),
	CONSTRAINT "wallet_reservations_accounting_valid" CHECK (("wallet_reservations"."status" IN ('active', 'awaiting_settlement') AND "wallet_reservations"."settled_amount_paise" = 0 AND "wallet_reservations"."released_amount_paise" = 0 AND "wallet_reservations"."settled_at" IS NULL AND "wallet_reservations"."released_at" IS NULL) OR ("wallet_reservations"."status" = 'settled' AND "wallet_reservations"."settled_amount_paise"::numeric + "wallet_reservations"."released_amount_paise" = "wallet_reservations"."authorized_amount_paise" AND "wallet_reservations"."settled_at" IS NOT NULL AND ("wallet_reservations"."released_amount_paise" = 0 OR "wallet_reservations"."released_at" IS NOT NULL)) OR ("wallet_reservations"."status" IN ('released', 'expired') AND "wallet_reservations"."settled_amount_paise" = 0 AND "wallet_reservations"."released_amount_paise" = "wallet_reservations"."authorized_amount_paise" AND "wallet_reservations"."released_at" IS NOT NULL AND "wallet_reservations"."settled_at" IS NULL)),
	CONSTRAINT "wallet_reservations_reconciliation_valid" CHECK (("wallet_reservations"."reconciled_at" IS NULL AND "wallet_reservations"."reconciliation_reference" IS NULL) OR ("wallet_reservations"."reconciled_at" IS NOT NULL AND "wallet_reservations"."reconciliation_reference" IS NOT NULL AND "wallet_reservations"."reconciliation_requested_at" IS NOT NULL)),
	CONSTRAINT "wallet_reservations_expiry_reconciled" CHECK ("wallet_reservations"."status" <> 'expired' OR ("wallet_reservations"."reconciled_at" IS NOT NULL AND "wallet_reservations"."reconciliation_reference" IS NOT NULL)),
	CONSTRAINT "wallet_reservations_expiry_future" CHECK ("wallet_reservations"."expires_at" > "wallet_reservations"."created_at"),
	CONSTRAINT "wallet_reservations_idempotency_nonempty" CHECK (length(trim("wallet_reservations"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"call_id" uuid,
	"reservation_id" uuid,
	"reason" "transaction_reason" NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"balance_before_paise" bigint NOT NULL,
	"balance_after_paise" bigint NOT NULL,
	"reserved_before_paise" bigint NOT NULL,
	"reserved_after_paise" bigint NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"provider" varchar(100),
	"provider_account_id" varchar(200),
	"provider_event_id" varchar(200),
	"provider_payment_id" varchar(200),
	"payment_verified_at" timestamp with time zone,
	"description" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "wallet_transactions_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "wallet_transactions_amount_positive" CHECK ("wallet_transactions"."amount_paise" > 0),
	CONSTRAINT "wallet_transactions_balances_valid" CHECK ("wallet_transactions"."balance_before_paise" >= 0 AND "wallet_transactions"."balance_after_paise" >= 0 AND "wallet_transactions"."reserved_before_paise" >= 0 AND "wallet_transactions"."reserved_after_paise" >= 0 AND "wallet_transactions"."reserved_before_paise" <= "wallet_transactions"."balance_before_paise" AND "wallet_transactions"."reserved_after_paise" <= "wallet_transactions"."balance_after_paise"),
	CONSTRAINT "wallet_transactions_balance_delta" CHECK (("wallet_transactions"."direction" = 'credit' AND "wallet_transactions"."balance_after_paise"::numeric = "wallet_transactions"."balance_before_paise"::numeric + "wallet_transactions"."amount_paise") OR ("wallet_transactions"."direction" = 'debit' AND "wallet_transactions"."balance_after_paise"::numeric = "wallet_transactions"."balance_before_paise"::numeric - "wallet_transactions"."amount_paise")),
	CONSTRAINT "wallet_transactions_reason_direction" CHECK (("wallet_transactions"."reason" NOT IN ('top_up', 'refund') OR "wallet_transactions"."direction" = 'credit') AND ("wallet_transactions"."reason" <> 'call_charge' OR ("wallet_transactions"."direction" = 'debit' AND "wallet_transactions"."call_id" IS NOT NULL AND "wallet_transactions"."reservation_id" IS NOT NULL))),
	CONSTRAINT "wallet_transactions_payment_verified" CHECK ("wallet_transactions"."reason" <> 'top_up' OR ("wallet_transactions"."provider" IS NOT NULL AND "wallet_transactions"."provider_account_id" IS NOT NULL AND "wallet_transactions"."provider_event_id" IS NOT NULL AND "wallet_transactions"."provider_payment_id" IS NOT NULL AND "wallet_transactions"."payment_verified_at" IS NOT NULL AND "wallet_transactions"."call_id" IS NULL AND "wallet_transactions"."reservation_id" IS NULL)),
	CONSTRAINT "wallet_transactions_provider_complete" CHECK (("wallet_transactions"."provider_event_id" IS NULL AND "wallet_transactions"."provider_payment_id" IS NULL) OR ("wallet_transactions"."provider" IS NOT NULL AND "wallet_transactions"."provider_account_id" IS NOT NULL)),
	CONSTRAINT "wallet_transactions_reservation_has_call" CHECK ("wallet_transactions"."reservation_id" IS NULL OR "wallet_transactions"."call_id" IS NOT NULL),
	CONSTRAINT "wallet_transactions_metadata_object" CHECK (jsonb_typeof("wallet_transactions"."metadata") = 'object'),
	CONSTRAINT "wallet_transactions_audit_nonempty" CHECK (length(trim("wallet_transactions"."idempotency_key")) > 0 AND length(trim("wallet_transactions"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"balance_paise" bigint DEFAULT 0 NOT NULL,
	"reserved_paise" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_org_unique" UNIQUE("organization_id"),
	CONSTRAINT "wallets_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "wallets_currency_inr" CHECK ("wallets"."currency" = 'INR'),
	CONSTRAINT "wallets_funds_valid" CHECK ("wallets"."balance_paise" >= 0 AND "wallets"."reserved_paise" >= 0 AND "wallets"."reserved_paise" <= "wallets"."balance_paise"),
	CONSTRAINT "wallets_version_nonnegative" CHECK ("wallets"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_campaign_tenant_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_campaign_tenant_fk" FOREIGN KEY ("organization_id","campaign_id","lead_id") REFERENCES "public"."leads"("organization_id","campaign_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_wallet_tenant_fk" FOREIGN KEY ("organization_id","wallet_id") REFERENCES "public"."wallets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_tenant_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_wallet_tenant_fk" FOREIGN KEY ("organization_id","wallet_id") REFERENCES "public"."wallets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_call_wallet_tenant_fk" FOREIGN KEY ("organization_id","wallet_id","call_id") REFERENCES "public"."call_logs"("organization_id","wallet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_tenant_fk" FOREIGN KEY ("organization_id","wallet_id") REFERENCES "public"."wallets"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_call_wallet_tenant_fk" FOREIGN KEY ("organization_id","wallet_id","call_id") REFERENCES "public"."call_logs"("organization_id","wallet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_reservation_tenant_fk" FOREIGN KEY ("organization_id","wallet_id","call_id","reservation_id") REFERENCES "public"."wallet_reservations"("organization_id","wallet_id","call_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_logs_provider_call_unique" ON "call_logs" USING btree ("provider","provider_account_id","provider_call_id") WHERE "call_logs"."provider_call_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "call_logs_history_idx" ON "call_logs" USING btree ("organization_id","campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "call_logs_lead_history_idx" ON "call_logs" USING btree ("organization_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "call_logs_settlement_idx" ON "call_logs" USING btree ("organization_id","settlement_status","ended_at");--> statement-breakpoint
CREATE INDEX "call_logs_queue_idx" ON "call_logs" USING btree ("organization_id","queued_at") WHERE "call_logs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_idx" ON "campaigns" USING btree ("scheduled_at") WHERE "campaigns"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_reference_unique" ON "leads" USING btree ("organization_id","campaign_id","source","external_reference") WHERE "leads"."external_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_crm_idx" ON "leads" USING btree ("organization_id","campaign_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("organization_id","phone_e164");--> statement-breakpoint
CREATE INDEX "leads_qualification_idx" ON "leads" USING btree ("organization_id","qualification","qualification_score");--> statement-breakpoint
CREATE INDEX "leads_queue_idx" ON "leads" USING btree ("organization_id","next_attempt_at") WHERE "leads"."status" IN ('new', 'queued');--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_unique" ON "users" USING btree ("organization_id",lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_status_idx" ON "users" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "wallet_reservations_reconcile_idx" ON "wallet_reservations" USING btree ("organization_id","status","expires_at") WHERE "wallet_reservations"."status" IN ('active', 'awaiting_settlement');--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_provider_event_unique" ON "wallet_transactions" USING btree ("provider","provider_account_id","provider_event_id") WHERE "wallet_transactions"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_payment_credit_unique" ON "wallet_transactions" USING btree ("provider","provider_account_id","provider_payment_id") WHERE "wallet_transactions"."reason" = 'top_up';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_call_charge_unique" ON "wallet_transactions" USING btree ("organization_id","call_id") WHERE "wallet_transactions"."reason" = 'call_charge';--> statement-breakpoint
CREATE INDEX "wallet_transactions_history_idx" ON "wallet_transactions" USING btree ("organization_id","wallet_id","created_at");