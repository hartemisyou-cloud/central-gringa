REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_order_stock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_order_stock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC;

-- RLS policies referencing these run as the invoking role, so signed-in users keep access.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
