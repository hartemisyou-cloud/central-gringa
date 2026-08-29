CREATE TABLE public.presence_sessions (
  session_id TEXT NOT NULL PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  page TEXT,
  user_agent TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT presence_sessions_state_check CHECK (state IN ('ACTIVE','CART','CHECKOUT','PAID','ENDED'))
);

CREATE INDEX presence_sessions_last_seen_idx ON public.presence_sessions (last_seen_at DESC);
CREATE INDEX presence_sessions_store_state_idx ON public.presence_sessions (store_id, state, last_seen_at DESC);

GRANT ALL ON public.presence_sessions TO service_role;

ALTER TABLE public.presence_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presence_sessions_no_public_access"
  ON public.presence_sessions FOR SELECT
  USING (false);

CREATE TRIGGER trg_presence_sessions_updated
  BEFORE UPDATE ON public.presence_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();