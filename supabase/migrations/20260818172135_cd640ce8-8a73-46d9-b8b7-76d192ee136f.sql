UPDATE public.store_api_keys
   SET status = 'REVOKED', revoked_at = now()
 WHERE label IN ('doacao-usd-20','doacao-usd-30','doacao-usd-50','doacao-usd-100','doacao-usd-250','doacao-usd-500')
   AND status = 'ACTIVE';

INSERT INTO public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, status)
SELECT s.id, 'coracoes-unidos-unica', 'sk_live_b9DHfFufCHbB', 'sk_live_b9DHfF',
       'ae6ddab11028795d49b15e0b339a45965578f9a2888e3789277935db8cc95c41', 'ACTIVE'
  FROM public.stores s WHERE s.slug = 'coracoes-unidos';

INSERT INTO public.audit_logs (actor_email, action, resource_type, resource_id, metadata)
VALUES ('admin-panel','api_key.consolidated','store_api_key','sk_live_b9DHfFufCHbB',
        jsonb_build_object('store','Corações Unidos','revoked_labels','doacao-usd-*'));