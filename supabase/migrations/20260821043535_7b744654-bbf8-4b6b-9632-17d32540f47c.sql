CREATE TABLE public.order_attribution (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  gclid TEXT,
  fbclid TEXT,
  ttclid TEXT,
  msclkid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbp TEXT,
  fbc TEXT,
  referrer TEXT,
  landing_page TEXT,
  click_id TEXT,
  checkout_session_id TEXT,
  anonymous_session_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT order_attribution_order_id_key UNIQUE (order_id)
);

CREATE INDEX idx_order_attribution_order_id ON public.order_attribution (order_id);

GRANT ALL ON public.order_attribution TO service_role;

ALTER TABLE public.order_attribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_attribution_no_client_access" ON public.order_attribution FOR SELECT USING (false);

CREATE TRIGGER trg_order_attribution_updated
BEFORE UPDATE ON public.order_attribution
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();