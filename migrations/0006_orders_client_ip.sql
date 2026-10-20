-- Manual, additive Neon migration. Run with the owner connection BEFORE publish.
-- This migration belongs to migrations/, independently of drizzle/migrations/.
-- The historical Drizzle 0006_public_storefront_catalog_read.sql stays intact.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_ip text NULL,
  ADD COLUMN IF NOT EXISTS checkout_customer_details jsonb NULL,
  ADD COLUMN IF NOT EXISTS delivery_email_sent_at timestamptz NULL;

COMMIT;

-- Confirmation: exactly these three rows, with is_nullable = YES.
-- PostgreSQL reports timestamptz as "timestamp with time zone".
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name IN ('client_ip', 'checkout_customer_details', 'delivery_email_sent_at')
ORDER BY column_name;
