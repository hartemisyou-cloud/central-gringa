CREATE TABLE public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id text NOT NULL,
  checkout_session_id text NOT NULL UNIQUE,
  store_id uuid REFERENCES public.stores(id),
  integration_id uuid REFERENCES public.stripe_integrations(id),
  order_id uuid REFERENCES public.orders(id),
  public_token text,
  payment_intent_id text,
  currency text,
  amount_cents integer,
  country text,
  browser text,
  device_type text,
  operating_system text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  status text NOT NULL DEFAULT 'VIEWED',
  viewed_at timestamptz,
  started_at timestamptz,
  attempted_at timestamptz,
  succeeded_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'client',
  store_id uuid REFERENCES public.stores(id),
  integration_id uuid REFERENCES public.stripe_integrations(id),
  order_id uuid REFERENCES public.orders(id),
  public_token text,
  payment_intent_id text,
  payment_method text,
  currency text,
  amount_cents integer,
  country text,
  browser text,
  device_type text,
  operating_system text,
  referrer text,
  checkout_session_id text,
  anonymous_session_id text,
  decline_code text,
  decline_category text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT ALL ON public.checkout_sessions TO service_role;
GRANT ALL ON public.analytics_events TO service_role;

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_events_staff_read" ON public.analytics_events FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "checkout_sessions_staff_read" ON public.checkout_sessions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
GRANT SELECT ON public.analytics_events TO authenticated;
GRANT SELECT ON public.checkout_sessions TO authenticated;

CREATE INDEX idx_analytics_events_store_time ON public.analytics_events (store_id, occurred_at DESC);
CREATE INDEX idx_analytics_events_type_time ON public.analytics_events (event_type, occurred_at DESC);
CREATE INDEX idx_analytics_events_integration ON public.analytics_events (integration_id);
CREATE INDEX idx_analytics_events_pi ON public.analytics_events (payment_intent_id);
CREATE INDEX idx_analytics_events_method ON public.analytics_events (payment_method);
CREATE INDEX idx_analytics_events_session ON public.analytics_events (checkout_session_id);
CREATE INDEX idx_checkout_sessions_store_time ON public.checkout_sessions (store_id, first_seen_at DESC);
CREATE INDEX idx_checkout_sessions_order ON public.checkout_sessions (order_id);