INSERT INTO public.stores (name, slug, environment, status, currency, allowed_origins)
VALUES ('Corações Unidos', 'coracoes-unidos', 'live', 'ACTIVE', 'BRL', ARRAY[]::text[])
ON CONFLICT DO NOTHING;

INSERT INTO public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, status)
SELECT s.id, 'coracoes-unidos-prod', 'sk_live_NdDWj2G5NMLE', 'sk_live_NdDWj2',
       'e99f8b8c8763c23e2407972f94f3968dd4668d09f7f5770378887224756d0071', 'ACTIVE'
FROM public.stores s WHERE s.slug = 'coracoes-unidos';