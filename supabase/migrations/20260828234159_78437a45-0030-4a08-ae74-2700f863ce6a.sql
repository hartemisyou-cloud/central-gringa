-- 1) user_roles: only admins may write roles (prevents privilege escalation)
CREATE POLICY "user_roles_admin_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "user_roles_admin_update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role));

CREATE POLICY "user_roles_admin_delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));

-- 2) SECURITY DEFINER functions: remove client-callable EXECUTE grants.
-- Stock / rate-limit / trigger functions are server-only.
REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_order_stock(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_order_stock(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;

-- has_role/is_staff are referenced by RLS policies evaluated as `authenticated`,
-- so that role keeps EXECUTE; anonymous callers do not need them.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon;
