-- Explicit owner policies for the auth helpers: FORCE RLS remains enabled.
-- voice_app cannot assume voice_migrator. JWT verification stays in the API;
-- these functions accept only the issuer/subject obtained from verified tokens.
DO $$ BEGIN
  IF current_user <> 'voice_migrator' THEN
    RAISE EXCEPTION 'Migration must run as voice_migrator';
  END IF;
  IF pg_has_role('voice_app', 'voice_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'Runtime role must not assume migration role';
  END IF;
END $$;
--> statement-breakpoint
CREATE POLICY auth_owner_select ON public.organizations FOR SELECT TO voice_migrator USING (true);
CREATE POLICY auth_owner_insert ON public.organizations FOR INSERT TO voice_migrator WITH CHECK (true);
CREATE POLICY auth_owner_select ON public.users FOR SELECT TO voice_migrator USING (true);
CREATE POLICY auth_owner_insert ON public.users FOR INSERT TO voice_migrator WITH CHECK (true);
CREATE POLICY auth_owner_select ON public.wallets FOR SELECT TO voice_migrator USING (true);
CREATE POLICY auth_owner_insert ON public.wallets FOR INSERT TO voice_migrator WITH CHECK (true);
--> statement-breakpoint
ALTER POLICY tenant_isolation ON public.agent_configs TO voice_app
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_tenant_identity(p_auth_issuer TEXT, p_auth_subject TEXT)
RETURNS TABLE (organization_id UUID, user_id UUID, user_role user_role)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org_id UUID;
  v_wallet_id UUID;
  v_user_id UUID;
BEGIN
  IF nullif(trim(p_org_name), '') IS NULL OR length(p_org_name) > 200
     OR nullif(trim(p_auth_issuer), '') IS NULL
     OR nullif(trim(p_auth_subject), '') IS NULL THEN
    RAISE EXCEPTION 'Organization name and verified identity are required' USING ERRCODE = '22023';
  END IF;
  -- Serialize this low-volume onboarding operation so retries and slug allocation
  -- cannot create duplicate workspaces. Released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(731904, 1);
  -- Idempotency: if this identity is already provisioned, return existing IDs.
  SELECT u.organization_id INTO v_org_id
  FROM users u
  WHERE u.auth_issuer = p_auth_issuer AND u.auth_subject = p_auth_subject
  LIMIT 1;

  IF FOUND THEN
    SELECT u.id INTO v_user_id FROM users u
    WHERE u.organization_id = v_org_id
      AND u.auth_issuer = p_auth_issuer AND u.auth_subject = p_auth_subject LIMIT 1;
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
