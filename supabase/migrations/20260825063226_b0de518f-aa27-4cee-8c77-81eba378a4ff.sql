UPDATE public.products AS p
SET image_url = v.image_url
FROM (VALUES
  ('biblia-de-estudo-ilustrada', '/__l5e/assets-v1/dc6f413d-03af-426b-a07a-ffa4bb313cb4/biblia-ilustrada.jpg'),
  ('kit-biblia-estudo-devocional', '/__l5e/assets-v1/b56a00f6-153b-4fd6-810c-63706445ea47/kit-biblia-devocional.jpg'),
  ('biblia-de-bolso-capa-dura', '/__l5e/assets-v1/f88a0679-e6c0-4456-b28d-2f3b5cc7e694/biblia-bolso.jpg'),
  ('colecao-classicos-cristaos', '/__l5e/assets-v1/d51ea1fd-1d3c-4626-8d4a-ac49b535d948/colecao-classicos.jpg'),
  ('devocional-diario-fe-em-acao', '/__l5e/assets-v1/0066e810-dddc-4e51-b03b-c8ee1f43555a/devocional-fe-acao.jpg'),
  ('biblioteca-crista-completa-premium', '/__l5e/assets-v1/8a4c6c17-64e7-4942-b1f5-3625d7b93b0c/biblioteca-premium.jpg')
) AS v(slug, image_url)
WHERE p.slug = v.slug
  AND p.store_id IN (SELECT id FROM public.stores WHERE slug = 'livraria-crista');