CREATE TABLE public.utmify_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  webhook_id TEXT,
  api_token_ciphertext TEXT,
  api_token_last4 TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  is_test BOOLEAN NOT NULL DEFAULT false,
  last_success_at TIMESTAMPTZ,
  last_order_number TEXT,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.utmify_settings TO service_role;
ALTER TABLE public.utmify_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "utmify_settings server only" ON public.utmify_settings FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_utmify_settings_updated BEFORE UPDATE ON public.utmify_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.utmify_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_number TEXT,
  event_status TEXT NOT NULL DEFAULT 'paid',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_id, event_status)
);

GRANT ALL ON public.utmify_events TO service_role;
ALTER TABLE public.utmify_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "utmify_events server only" ON public.utmify_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER trg_utmify_events_updated BEFORE UPDATE ON public.utmify_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();