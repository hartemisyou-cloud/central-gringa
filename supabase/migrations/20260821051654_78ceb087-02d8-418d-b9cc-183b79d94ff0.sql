CREATE UNIQUE INDEX IF NOT EXISTS meta_conversion_events_store_order_event_key
  ON public.meta_conversion_events (store_id, order_id, event_name)
  WHERE order_id IS NOT NULL;