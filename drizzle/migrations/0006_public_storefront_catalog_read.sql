GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.stores TO anon;

CREATE POLICY "Anyone can read active products"
ON public.products
FOR SELECT
TO anon
USING (active = true);

CREATE POLICY "Anyone can read active stores"
ON public.stores
FOR SELECT
TO anon
USING (status = 'ACTIVE');