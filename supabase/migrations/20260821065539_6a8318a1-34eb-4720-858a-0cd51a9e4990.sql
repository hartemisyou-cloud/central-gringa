DELETE FROM public.store_api_keys WHERE key_id = 'sk_live_E1balKwMdD9n';

UPDATE public.orders SET status = 'CANCELLED'
 WHERE customer_id IN (SELECT id FROM public.customers WHERE email LIKE 'qa+cs%@example.com')
   AND status IN ('PENDING_PAYMENT','PAYMENT_PROCESSING');