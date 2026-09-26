-- Migration 0005: payment_orders table for Razorpay prepaid wallet top-up.
-- Runs as voice_migrator (bypasses RLS). voice_app gets SELECT/INSERT/UPDATE only.
DO $$ BEGIN
  IF current_user <> 'voice_migrator' THEN
    RAISE EXCEPTION 'Migration must run as voice_migrator';
  END IF;
END $$;
--> statement-breakpoint
CREATE TYPE public.payment_order_status AS ENUM ('created', 'paid', 'failed', 'expired', 'refunded');
--> statement-breakpoint
CREATE TABLE public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  razorpay_order_id varchar(200) NOT NULL,
  amount_paise bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status public.payment_order_status NOT NULL DEFAULT 'created',
  idempotency_key varchar(200) NOT NULL,
  razorpay_payment_id varchar(200),
  razorpay_signature varchar(500),
  credited_at timestamptz,
  failed_reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_orders_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payment_orders_razorpay_order_unique UNIQUE (razorpay_order_id),
  CONSTRAINT payment_orders_org_idem_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT payment_orders_amount_positive CHECK (amount_paise > 0 AND amount_paise <= 100000000),
  CONSTRAINT payment_orders_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT payment_orders_credited_consistent CHECK ((status = 'paid') = (credited_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX payment_orders_org_status_idx ON public.payment_orders(organization_id, status);
--> statement-breakpoint
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_orders FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.payment_orders TO voice_app;
CREATE POLICY tenant_isolation ON public.payment_orders TO voice_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
-- voice_migrator needs INSERT+UPDATE to create orders and update them from webhooks
-- when called via SECURITY DEFINER functions. For now, use voice_app (JWT ensures tenant).
-- Protect organization_id from mutation (same audit pattern as all tenant tables)
CREATE TRIGGER zz_protect_identity_audit BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_row_identity_and_audit();
