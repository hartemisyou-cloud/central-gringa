INSERT INTO public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, status)
SELECT id, 'temp-qa-checkout-session', 'sk_live_E1balKwMdD9n', 'sk_live_E1balK',
       '9c91c3cdc4d9264973556550687d9665fab67270271f5d87b4bcf0dbf393eaef', 'ACTIVE'
FROM public.stores WHERE slug = 'livraria-crista' LIMIT 1;