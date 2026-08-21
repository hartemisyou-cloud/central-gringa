CREATE TABLE public.meta_tracking_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  pixel_id TEXT,
  access_token_ciphertext TEXT,
  access_token_last4 TEXT,
  test_event_code TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.meta_tracking_settings TO service_role;
ALTER TABLE public.meta_tracking_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meta_tracking_settings_no_client_access" ON public.meta_tracking_settings FOR ALL USING (false) WITH CHECK (false);
CREATE TRIGGER trg_meta_tracking_settings_updated BEFORE UPDATE ON public.meta_tracking_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.meta_conversion_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  meta_event_id TEXT,
  http_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, event_id, event_name)
);

GRANT ALL ON public.meta_conversion_events TO service_role;
ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meta_conversion_events_no_client_access" ON public.meta_conversion_events FOR ALL USING (false) WITH CHECK (false);
CREATE TRIGGER trg_meta_conversion_events_updated BEFORE UPDATE ON public.meta_conversion_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_meta_conversion_events_store_status ON public.meta_conversion_events (store_id, status, created_at DESC);