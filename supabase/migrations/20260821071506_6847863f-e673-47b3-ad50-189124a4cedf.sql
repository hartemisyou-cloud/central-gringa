UPDATE public.orders SET status='CANCELLED' WHERE id='59b4c849-0b43-43c2-be77-ace7bd92a1c9';
UPDATE public.stripe_checkout_sessions SET status='expired' WHERE order_id='59b4c849-0b43-43c2-be77-ace7bd92a1c9';
SELECT public.release_order_stock('59b4c849-0b43-43c2-be77-ace7bd92a1c9');