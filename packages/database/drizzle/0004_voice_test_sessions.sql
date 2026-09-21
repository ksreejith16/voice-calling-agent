CREATE TABLE public.voice_test_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 agent_id uuid NOT NULL,
 user_id uuid NOT NULL,
 room varchar(100) NOT NULL UNIQUE,
 snapshot jsonb NOT NULL,
 status varchar(30) NOT NULL DEFAULT 'starting',
 error_code varchar(80),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT voice_test_agent_tenant_fk FOREIGN KEY (organization_id,agent_id) REFERENCES public.agent_configs(organization_id,id),
 CONSTRAINT voice_test_user_tenant_fk FOREIGN KEY (organization_id,user_id) REFERENCES public.users(organization_id,id),
 CONSTRAINT voice_test_status_valid CHECK (status IN ('starting','active','ended','failed','expired'))
);
CREATE INDEX voice_test_history_idx ON public.voice_test_sessions(organization_id,created_at);
ALTER TABLE public.voice_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_test_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_test_sessions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.voice_test_sessions TO voice_app;
CREATE POLICY tenant_isolation ON public.voice_test_sessions TO voice_app
 USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE TRIGGER zz_protect_identity_audit BEFORE UPDATE ON public.voice_test_sessions
 FOR EACH ROW EXECUTE FUNCTION public.protect_row_identity_and_audit();
