-- Apply inside the same migration transaction as schema/data restore.
-- Both real roles are provisioned by scripts/setup-database-roles.mjs.
-- The migration login is explicitly a member of central_owner; central_runtime is not.

DO $acl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_owner' AND NOT rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Expected the restricted NOLOGIN central_owner role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_runtime' AND rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Expected the restricted LOGIN NOINHERIT NOBYPASSRLS central_runtime role';
  END IF;
  IF current_user = 'central_runtime' OR NOT pg_has_role(current_user, 'central_owner', 'MEMBER') OR NOT pg_has_role(current_user, 'central_owner', 'USAGE') THEN
    RAISE EXCEPTION 'The migration login must be an explicit member of central_owner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'central_runtime'::regrole) THEN
    RAISE EXCEPTION 'The runtime role must not be a member of any other role';
  END IF;
END
$acl$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, central_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, central_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, central_runtime;

ALTER SCHEMA public OWNER TO central_owner;
DO $ownership$
DECLARE object record;
BEGIN
  FOR object IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO central_owner', object.relname);
  END LOOP;
  FOR object IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO central_owner', object.proname, object.args);
  END LOOP;
  FOR object IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO central_owner', object.typname);
  END LOOP;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO central_runtime', current_database());
END
$ownership$;

GRANT USAGE ON SCHEMA public TO central_runtime;

-- RLS remains enabled on all35tables. Only the server role has an allow policy.
-- SQL operation privileges below further restrict each table's policy.
DROP POLICY IF EXISTS central_server ON public.addresses;
CREATE POLICY central_server ON public.addresses TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE public.addresses TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.analytics_events;
CREATE POLICY central_server ON public.analytics_events TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON TABLE public.analytics_events TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.audit_logs;
CREATE POLICY central_server ON public.audit_logs TO central_runtime USING (true) WITH CHECK (true);
GRANT INSERT ON TABLE public.audit_logs TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.checkout_sessions;
CREATE POLICY central_server ON public.checkout_sessions TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_sessions TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.customers;
CREATE POLICY central_server ON public.customers TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.customers TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donation_beneficiaries;
CREATE POLICY central_server ON public.donation_beneficiaries TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.donation_beneficiaries TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donation_campaigns;
CREATE POLICY central_server ON public.donation_campaigns TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.donation_campaigns TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donation_ledger;
CREATE POLICY central_server ON public.donation_ledger TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE public.donation_ledger TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donation_releases;
CREATE POLICY central_server ON public.donation_releases TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT ON TABLE public.donation_releases TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donation_settings;
CREATE POLICY central_server ON public.donation_settings TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.donation_settings TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.donations;
CREATE POLICY central_server ON public.donations TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.donations TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.meta_conversion_events;
CREATE POLICY central_server ON public.meta_conversion_events TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.meta_conversion_events TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.meta_tracking_settings;
CREATE POLICY central_server ON public.meta_tracking_settings TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.meta_tracking_settings TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.order_attribution;
CREATE POLICY central_server ON public.order_attribution TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_attribution TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.order_items;
CREATE POLICY central_server ON public.order_items TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE public.order_items TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.orders;
CREATE POLICY central_server ON public.orders TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.payment_events;
CREATE POLICY central_server ON public.payment_events TO central_runtime USING (true) WITH CHECK (true);
GRANT INSERT ON TABLE public.payment_events TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.payments;
CREATE POLICY central_server ON public.payments TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.payments TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.presence_sessions;
CREATE POLICY central_server ON public.presence_sessions TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.presence_sessions TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.products;
CREATE POLICY central_server ON public.products TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT ON TABLE public.products TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.rate_limit_counters;
CREATE POLICY central_server ON public.rate_limit_counters TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON TABLE public.rate_limit_counters TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.refunds;
CREATE POLICY central_server ON public.refunds TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON TABLE public.refunds TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.store_api_key_scopes;
CREATE POLICY central_server ON public.store_api_key_scopes TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE public.store_api_key_scopes TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.store_api_keys;
CREATE POLICY central_server ON public.store_api_keys TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.store_api_keys TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.stores;
CREATE POLICY central_server ON public.stores TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON TABLE public.stores TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.stripe_integrations;
CREATE POLICY central_server ON public.stripe_integrations TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_integrations TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.utmify_events;
CREATE POLICY central_server ON public.utmify_events TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.utmify_events TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.utmify_settings;
CREATE POLICY central_server ON public.utmify_settings TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.utmify_settings TO central_runtime;

DROP POLICY IF EXISTS central_server ON public.webhook_events;
CREATE POLICY central_server ON public.webhook_events TO central_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE public.webhook_events TO central_runtime;

-- Six historical tables intentionally have no runtime grants/policies:
-- cart_items, carts, product_variants, profiles, stripe_checkout_sessions, user_roles.
-- Their definitions and any restored rows are retained under central_owner.

-- Exactly the nine RPCs called by the server. Trigger/helper functions have no
-- PUBLIC or runtime EXECUTE grant; trigger execution uses PostgreSQL's rules.
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.release_order_stock(uuid) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.commit_order_stock(uuid) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.donation_apply_event(uuid, text, text, text, jsonb) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.donation_release_mark(uuid, text, text, text) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.donation_release_submit_guard(uuid, integer) TO central_runtime;
GRANT EXECUTE ON FUNCTION public.donation_release_flag_manual(uuid, text) TO central_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE central_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE central_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE central_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Also protect later objects created directly by the migration login.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET row_security = on;
