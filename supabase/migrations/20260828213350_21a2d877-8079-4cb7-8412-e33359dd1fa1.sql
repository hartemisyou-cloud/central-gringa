UPDATE public.products p
   SET weight_grams = 0,
       updated_at = now()
 WHERE p.store_id = (SELECT id FROM public.stores WHERE slug = 'livraria-cultura')
   AND p.sku IN ('LC-ROM-002','LC-NFI-002','LC-LIT-003','LC-FIC-002','LC-BIO-002','LC-LIT-004')
   AND p.price_cents IN (2000,3000,5000,10000,25000,50000);