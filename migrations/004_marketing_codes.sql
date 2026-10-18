-- Additive, post-restore migration. Apply with the owner connection AFTER
-- 001_pre → data → 002_post → 003_server_acl. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marketing_codes (
  code text PRIMARY KEY,
  utm_source text NOT NULL,
  utm_medium text NOT NULL,
  utm_campaign text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_codes FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_runtime') THEN
    DROP POLICY IF EXISTS central_server ON public.marketing_codes;
    CREATE POLICY central_server ON public.marketing_codes TO central_runtime USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE ON TABLE public.marketing_codes TO central_runtime;
  END IF;
END $$;

COMMIT;
