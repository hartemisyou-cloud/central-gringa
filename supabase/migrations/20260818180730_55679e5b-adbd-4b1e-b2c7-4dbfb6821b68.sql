DO $$
DECLARE _store uuid; _integ uuid; _key uuid := '48dbc170-da27-4dc9-b1c0-777708b19143';
BEGIN
  SELECT id INTO _integ FROM public.stripe_integrations WHERE status='ACTIVE' ORDER BY created_at LIMIT 1;

  SELECT id INTO _store FROM public.stores WHERE slug='livraria-crista';
  IF _store IS NULL THEN
    INSERT INTO public.stores (name, slug, status, environment, currency, allowed_origins, stripe_integration_id)
    VALUES ('Livraria Cristã','livraria-crista','ACTIVE','live','USD','{}', _integ)
    RETURNING id INTO _store;
  ELSE
    UPDATE public.stores SET status='ACTIVE', stripe_integration_id=_integ WHERE id=_store;
  END IF;

  INSERT INTO public.products (store_id, name, slug, description, sku, price_cents, currency, stock, weight_grams, active)
  SELECT _store, 'Doação US$ '||v, 'doacao-usd-'||lpad(v::text,3,'0'),
         'Ticket de doação de US$ '||v, 'CU-DON-'||lpad(v::text,3,'0'),
         v*100, 'USD', 1000000, 0, true
  FROM (VALUES (20),(30),(50),(100),(250),(500)) AS t(v)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.store_api_key_scopes (api_key_id, store_id)
  SELECT _key, _store
  WHERE NOT EXISTS (SELECT 1 FROM public.store_api_key_scopes WHERE api_key_id=_key AND store_id=_store);
END $$;