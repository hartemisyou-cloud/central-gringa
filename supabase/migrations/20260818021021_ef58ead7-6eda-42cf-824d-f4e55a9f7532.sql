REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_order_stock(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_order_stock(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_order_stock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_order_stock(uuid) TO service_role;