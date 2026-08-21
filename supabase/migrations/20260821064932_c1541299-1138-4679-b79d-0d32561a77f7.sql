CREATE TABLE public.stripe_checkout_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.stripe_integrations(id),
  session_id TEXT NOT NULL UNIQUE,
  client_secret TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  payment_intent_id TEXT,
  base_amount_cents INTEGER NOT NULL,
  base_currency TEXT NOT NULL,
  amount_total INTEGER,
  currency TEXT,
  presented_amount_total INTEGER,
  presented_currency TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX stripe_checkout_sessions_open_order_idx
  ON public.stripe_checkout_sessions (order_id)
  WHERE status = 'open';

CREATE INDEX stripe_checkout_sessions_order_idx ON public.stripe_checkout_sessions (order_id);
CREATE INDEX stripe_checkout_sessions_pi_idx ON public.stripe_checkout_sessions (payment_intent_id);

GRANT ALL ON public.stripe_checkout_sessions TO service_role;

ALTER TABLE public.stripe_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stripe_checkout_sessions_staff_read"
  ON public.stripe_checkout_sessions FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE TRIGGER trg_stripe_checkout_sessions_updated
  BEFORE UPDATE ON public.stripe_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();