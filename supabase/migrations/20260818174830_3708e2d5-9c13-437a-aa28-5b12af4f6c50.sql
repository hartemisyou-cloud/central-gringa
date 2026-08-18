UPDATE public.stores s
SET stripe_integration_id = (SELECT id FROM public.stripe_integrations WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1),
    updated_at = now()
WHERE s.stripe_integration_id IS NULL;