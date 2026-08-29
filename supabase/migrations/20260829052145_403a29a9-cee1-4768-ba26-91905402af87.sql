ALTER TABLE public.presence_sessions
  ADD COLUMN IF NOT EXISTS cart_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS cart_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_viewed_at timestamptz;

CREATE INDEX IF NOT EXISTS presence_sessions_last_seen_idx
  ON public.presence_sessions (last_seen_at DESC);