-- Incremental migration only. Apply with the production owner connection.
-- Existing rows remain excluded from automatic recovery; no historical backfill.
ALTER TABLE public.meta_conversion_events
  ADD COLUMN IF NOT EXISTS purchase_snapshot_ciphertext text,
  ADD COLUMN IF NOT EXISTS destination_pixel_id text,
  ADD COLUMN IF NOT EXISTS destination_graph_version text,
  ADD COLUMN IF NOT EXISTS automatic_recovery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remote_acceptance_unknown boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.protect_meta_purchase_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.automatic_recovery AND (
    NEW.purchase_snapshot_ciphertext IS DISTINCT FROM OLD.purchase_snapshot_ciphertext OR
    NEW.destination_pixel_id IS DISTINCT FROM OLD.destination_pixel_id OR
    NEW.destination_graph_version IS DISTINCT FROM OLD.destination_graph_version OR
    NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.event_name IS DISTINCT FROM OLD.event_name OR
    NEW.store_id IS DISTINCT FROM OLD.store_id OR
    NEW.order_id IS DISTINCT FROM OLD.order_id OR
    NEW.automatic_recovery IS DISTINCT FROM OLD.automatic_recovery
  ) THEN
    RAISE EXCEPTION 'Purchase dispatch snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_meta_purchase_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS protect_meta_purchase_snapshot ON public.meta_conversion_events;
CREATE TRIGGER protect_meta_purchase_snapshot BEFORE UPDATE ON public.meta_conversion_events
FOR EACH ROW EXECUTE FUNCTION public.protect_meta_purchase_snapshot();
CREATE INDEX IF NOT EXISTS idx_meta_purchase_automatic_recovery
ON public.meta_conversion_events (status, updated_at)
WHERE automatic_recovery;
-- Existing central_runtime SELECT/INSERT/UPDATE grants and RLS remain unchanged.