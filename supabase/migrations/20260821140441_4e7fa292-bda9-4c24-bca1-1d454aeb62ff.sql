ALTER TABLE public.order_attribution
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS client_user_agent text,
  ADD COLUMN IF NOT EXISTS event_source_url text;