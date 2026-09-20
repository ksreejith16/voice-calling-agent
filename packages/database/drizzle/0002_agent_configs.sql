-- Migration 0002: agent_configs table + tenant auth helper functions
-- Must run as voice_migrator role (enforced below).
DO $$ BEGIN
  IF current_user <> 'voice_migrator' THEN
    RAISE EXCEPTION 'migration must run as voice_migrator, not %', current_user;
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language supported_language NOT NULL DEFAULT 'en-IN',
  voice VARCHAR(100),
  instructions TEXT NOT NULL DEFAULT '',
  opening_message TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_configs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agent_configs_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT agent_configs_status_valid CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint

CREATE INDEX agent_configs_org_status_idx ON agent_configs (organization_id, status);
--> statement-breakpoint

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON agent_configs FROM PUBLIC;
REVOKE ALL ON agent_configs FROM voice_app;
GRANT SELECT, INSERT, UPDATE ON agent_configs TO voice_app;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON agent_configs
  USING (organization_id = current_setting('app.organization_id', TRUE)::UUID)
  WITH CHECK (organization_id = current_setting('app.organization_id', TRUE)::UUID);
--> statement-breakpoint

-- resolve_tenant_identity: given Clerk JWT iss+sub, returns org/user context
-- SECURITY DEFINER runs as voice_migrator, bypassing RLS for auth-only lookups.
CREATE OR REPLACE FUNCTION resolve_tenant_identity(p_auth_issuer TEXT, p_auth_subject TEXT)
RETURNS TABLE (organization_id UUID, user_id UUID, user_role user_role)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT u.organization_id, u.id, u.role
  FROM users u
  WHERE u.auth_issuer = p_auth_issuer
    AND u.auth_subject = p_auth_subject
    AND u.status = 'active'
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION resolve_tenant_identity(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_identity(TEXT, TEXT) TO voice_app;
--> statement-breakpoint

-- provision_new_tenant: creates org + wallet + owner user atomically.
-- Idempotent: returns existing data if the user is already provisioned.
CREATE OR REPLACE FUNCTION provision_new_tenant(
  p_org_name TEXT,
  p_org_slug TEXT,
  p_org_language supported_language,
  p_auth_issuer TEXT,
  p_auth_subject TEXT,
  p_email TEXT,
  p_display_name TEXT
) RETURNS TABLE (organization_id UUID, user_id UUID, wallet_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_wallet_id UUID;
  v_user_id UUID;
BEGIN
  -- Idempotency: if this identity is already provisioned, return existing IDs.
  SELECT u.organization_id INTO v_org_id
  FROM users u
  WHERE u.auth_issuer = p_auth_issuer AND u.auth_subject = p_auth_subject
  LIMIT 1;

  IF FOUND THEN
    SELECT u.id INTO v_user_id FROM users u WHERE u.organization_id = v_org_id LIMIT 1;
    SELECT w.id INTO v_wallet_id FROM wallets w WHERE w.organization_id = v_org_id LIMIT 1;
    RETURN QUERY SELECT v_org_id, v_user_id, v_wallet_id;
    RETURN;
  END IF;

  -- Slug uniqueness: append random suffix if taken.
  DECLARE v_slug TEXT := p_org_slug; v_attempt INT := 0; BEGIN
    LOOP
      IF NOT EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN EXIT; END IF;
      v_attempt := v_attempt + 1;
      v_slug := p_org_slug || '-' || v_attempt;
      IF v_attempt > 99 THEN RAISE EXCEPTION 'could not find unique slug for %', p_org_slug; END IF;
    END LOOP;
    p_org_slug := v_slug;
  END;

  INSERT INTO organizations(name, slug, defaults)
  VALUES (
    p_org_name,
    p_org_slug,
    jsonb_build_object('language', p_org_language::text, 'timezone', 'Asia/Kolkata')
  )
  RETURNING id INTO v_org_id;

  INSERT INTO wallets(organization_id) VALUES (v_org_id) RETURNING id INTO v_wallet_id;

  INSERT INTO users(organization_id, auth_issuer, auth_subject, email, display_name, role, status)
  VALUES (v_org_id, p_auth_issuer, p_auth_subject, p_email, p_display_name, 'owner', 'active')
  RETURNING id INTO v_user_id;

  RETURN QUERY SELECT v_org_id, v_user_id, v_wallet_id;
END;
$$;
REVOKE ALL ON FUNCTION provision_new_tenant(TEXT, TEXT, supported_language, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_new_tenant(TEXT, TEXT, supported_language, TEXT, TEXT, TEXT, TEXT) TO voice_app;
