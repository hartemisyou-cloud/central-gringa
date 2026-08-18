-- 1. Lojas 2, 3 e 4
INSERT INTO public.stores (name, slug, status, environment, currency, stripe_integration_id)
SELECT v.name, v.slug, 'ACTIVE', s.environment, 'USD', s.stripe_integration_id
  FROM (VALUES ('Loja 2','loja-2'), ('Loja 3','loja-3'), ('Loja 4','loja-4')) AS v(name, slug),
       public.stores s
 WHERE s.slug = 'coracoes-unidos'
   AND NOT EXISTS (SELECT 1 FROM public.stores x WHERE x.slug = v.slug);

-- 2. Mesmos tickets de doação em cada nova loja
INSERT INTO public.products (store_id, name, slug, sku, price_cents, currency, stock, weight_grams, active, category)
SELECT st.id, t.name, t.slug, t.sku, t.cents, 'USD', 1000000, 0, true, 'doacao'
  FROM public.stores st,
       (VALUES
         ('Doação US$ 20','doacao-us-20','CU-DON-020',2000),
         ('Doação US$ 30','doacao-us-30','CU-DON-030',3000),
         ('Doação US$ 50','doacao-us-50','CU-DON-050',5000),
         ('Doação US$ 100','doacao-us-100','CU-DON-100',10000),
         ('Doação US$ 250','doacao-us-250','CU-DON-250',25000),
         ('Doação US$ 500','doacao-us-500','CU-DON-500',50000)
       ) AS t(name, slug, sku, cents)
 WHERE st.slug IN ('loja-2','loja-3','loja-4')
   AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.store_id = st.id AND p.sku = t.sku);

-- 3. Escopo multi-loja para a credencial unificada
CREATE TABLE IF NOT EXISTS public.store_api_key_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES public.store_api_keys(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, store_id)
);

GRANT ALL ON public.store_api_key_scopes TO service_role;
ALTER TABLE public.store_api_key_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_api_key_scopes_no_client_access ON public.store_api_key_scopes;
CREATE POLICY store_api_key_scopes_no_client_access
  ON public.store_api_key_scopes FOR SELECT TO authenticated USING (false);

INSERT INTO public.store_api_key_scopes (api_key_id, store_id)
SELECT k.id, s.id
  FROM public.store_api_keys k, public.stores s
 WHERE k.key_id = 'sk_live_b9DHfFufCHbB'
   AND s.slug IN ('coracoes-unidos','loja-2','loja-3','loja-4')
ON CONFLICT DO NOTHING;