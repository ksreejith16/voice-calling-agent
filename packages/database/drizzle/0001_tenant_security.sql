-- Applied as the second versioned Drizzle migration, by voice_migrator.
-- Role creation/password assignment belongs to infra initialization, never migration source.
DO $$
BEGIN
  IF current_user <> 'voice_migrator' THEN
    RAISE EXCEPTION 'Migrations must run as voice_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voice_app' AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Create the restricted voice_app role before running migrations';
  END IF;
  IF pg_has_role('voice_app', 'voice_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'voice_app must not inherit or assume the owner role';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM voice_app;
GRANT USAGE ON SCHEMA public TO voice_app;
GRANT SELECT, UPDATE ON public.organizations TO voice_app;
GRANT SELECT, INSERT, UPDATE ON public.users, public.wallets, public.campaigns,
  public.leads, public.call_logs, public.wallet_reservations TO voice_app;
GRANT SELECT, INSERT ON public.wallet_transactions TO voice_app;
--> statement-breakpoint
DO $$
DECLARE table_name text;
DECLARE tenant_column text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'users', 'wallets', 'wallet_transactions',
    'wallet_reservations', 'campaigns', 'leads', 'call_logs']
  LOOP
    tenant_column := CASE WHEN table_name = 'organizations' THEN 'id' ELSE 'organization_id' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I FOR ALL TO voice_app USING (%I = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (%I = nullif(current_setting(''app.organization_id'', true), '''')::uuid)', table_name, tenant_column, tenant_column);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.protect_row_identity_and_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Row identity and creation timestamp are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME <> 'organizations' AND (to_jsonb(NEW)->>'organization_id') IS DISTINCT FROM (to_jsonb(OLD)->>'organization_id') THEN
    RAISE EXCEPTION 'Organization ownership is immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  IF TG_TABLE_NAME = 'wallets' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'users', 'wallets', 'campaigns', 'leads', 'call_logs', 'wallet_reservations']
  LOOP
    EXECUTE format('CREATE TRIGGER zz_protect_identity_audit BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_row_identity_and_audit()', table_name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; use a compensating financial entry', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_transactions_append_only BEFORE UPDATE OR DELETE ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER wallet_transactions_no_truncate BEFORE TRUNCATE ON public.wallet_transactions
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER wallet_reservations_no_delete BEFORE DELETE ON public.wallet_reservations
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER wallet_reservations_no_truncate BEFORE TRUNCATE ON public.wallet_reservations
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER call_logs_no_delete BEFORE DELETE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER call_logs_no_truncate BEFORE TRUNCATE ON public.call_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION public.protect_call_billing() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.organization_id, NEW.campaign_id, NEW.lead_id, NEW.wallet_id, NEW.attempt_number,
    NEW.idempotency_key, NEW.rate_paise_per_minute, NEW.billing_quantum_seconds,
    NEW.max_connected_duration_seconds, NEW.termination_margin_seconds)
    IS DISTINCT FROM ROW(OLD.organization_id, OLD.campaign_id, OLD.lead_id, OLD.wallet_id, OLD.attempt_number,
    OLD.idempotency_key, OLD.rate_paise_per_minute, OLD.billing_quantum_seconds,
    OLD.max_connected_duration_seconds, OLD.termination_margin_seconds) THEN
    RAISE EXCEPTION 'Call ownership, attempt identity, and billing snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.provider_call_id IS NOT NULL AND ROW(NEW.provider, NEW.provider_account_id, NEW.provider_call_id)
    IS DISTINCT FROM ROW(OLD.provider, OLD.provider_account_id, OLD.provider_call_id) THEN
    RAISE EXCEPTION 'Assigned provider call identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.duration_verified_at IS NOT NULL AND ROW(NEW.connected_duration_seconds, NEW.duration_verified_at,
    NEW.duration_source_reference, NEW.ended_at) IS DISTINCT FROM ROW(OLD.connected_duration_seconds,
    OLD.duration_verified_at, OLD.duration_source_reference, OLD.ended_at) THEN
    RAISE EXCEPTION 'Verified final duration evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.settlement_status = 'settled' AND ROW(NEW.settlement_status, NEW.settled_at,
    NEW.billable_seconds, NEW.charged_paise) IS DISTINCT FROM ROW(OLD.settlement_status,
    OLD.settled_at, OLD.billable_seconds, OLD.charged_paise) THEN
    RAISE EXCEPTION 'Settled call accounting is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER call_logs_billing_immutable BEFORE UPDATE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.protect_call_billing();
--> statement-breakpoint
CREATE FUNCTION public.protect_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE call_record public.call_logs%ROWTYPE;
DECLARE expected_charge numeric;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'Reservations must start active' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('settled', 'released', 'expired') THEN
      RAISE EXCEPTION 'Terminal reservations are immutable' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.organization_id, NEW.wallet_id, NEW.call_id, NEW.idempotency_key,
      NEW.authorized_amount_paise, NEW.rate_paise_per_minute, NEW.billing_quantum_seconds,
      NEW.max_connected_duration_seconds, NEW.termination_margin_seconds)
      IS DISTINCT FROM ROW(OLD.organization_id, OLD.wallet_id, OLD.call_id, OLD.idempotency_key,
      OLD.authorized_amount_paise, OLD.rate_paise_per_minute, OLD.billing_quantum_seconds,
      OLD.max_connected_duration_seconds, OLD.termination_margin_seconds) THEN
      RAISE EXCEPTION 'Reservation ownership, authorization, and billing snapshots are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> OLD.status AND NOT ((OLD.status = 'active' AND NEW.status = 'awaiting_settlement')
      OR (OLD.status = 'awaiting_settlement' AND NEW.status IN ('settled', 'released', 'expired'))) THEN
      RAISE EXCEPTION 'Illegal reservation state transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO call_record FROM public.call_logs
    WHERE organization_id = NEW.organization_id AND wallet_id = NEW.wallet_id AND id = NEW.call_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation call is absent or outside this tenant/wallet' USING ERRCODE = '23503';
  END IF;
  IF ROW(NEW.rate_paise_per_minute, NEW.billing_quantum_seconds, NEW.max_connected_duration_seconds, NEW.termination_margin_seconds)
    IS DISTINCT FROM ROW(call_record.rate_paise_per_minute, call_record.billing_quantum_seconds,
      call_record.max_connected_duration_seconds, call_record.termination_margin_seconds) THEN
    RAISE EXCEPTION 'Reservation billing snapshots must match its call' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('settled', 'released', 'expired') THEN
    IF call_record.duration_verified_at IS NULL OR call_record.duration_source_reference IS NULL
      OR call_record.connected_duration_seconds IS NULL OR call_record.ended_at IS NULL
      OR call_record.status NOT IN ('completed', 'failed', 'cancelled', 'no_answer', 'busy') THEN
      RAISE EXCEPTION 'Terminal reservation needs a finished call with verified authoritative duration' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('released', 'expired') AND call_record.connected_duration_seconds <> 0 THEN
      RAISE EXCEPTION 'A connected call requires settlement; it cannot be released as unconnected' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'expired' AND (NEW.expires_at > clock_timestamp() OR NEW.reconciled_at IS NULL
      OR NEW.reconciliation_reference IS NULL) THEN
      RAISE EXCEPTION 'Expiry requires reconciliation after expiry; a timer alone cannot release money' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'settled' THEN
      IF call_record.connected_duration_seconds::numeric > NEW.max_connected_duration_seconds::numeric + NEW.termination_margin_seconds THEN
        RAISE EXCEPTION 'Verified duration exceeds funded limit; reconcile as a dispute' USING ERRCODE = '23514';
      END IF;
      expected_charge := ceil(call_record.connected_duration_seconds::numeric / NEW.billing_quantum_seconds)
        * NEW.billing_quantum_seconds * NEW.rate_paise_per_minute / 60;
      IF NEW.settled_amount_paise::numeric <> expected_charge THEN
        RAISE EXCEPTION 'Settlement must use verified duration and snapshotted integer billing' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_reservations_guard BEFORE INSERT OR UPDATE ON public.wallet_reservations
FOR EACH ROW EXECUTE FUNCTION public.protect_reservation();
--> statement-breakpoint
CREATE FUNCTION public.validate_call_charge_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.reason = 'call_charge' AND NOT EXISTS (
    SELECT 1 FROM public.wallet_reservations WHERE organization_id = NEW.organization_id
      AND wallet_id = NEW.wallet_id AND call_id = NEW.call_id AND id = NEW.reservation_id
      AND status = 'settled' AND settled_amount_paise = NEW.amount_paise
  ) THEN
    RAISE EXCEPTION 'Call charge must match its settled reservation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_transactions_charge_guard BEFORE INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_call_charge_entry();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_row_identity_and_audit(), public.reject_audit_mutation(),
  public.protect_call_billing(), public.protect_reservation(), public.validate_call_charge_entry() FROM PUBLIC;
