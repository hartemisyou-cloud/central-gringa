update public.store_api_keys set status='ACTIVE', revoked_at=null where key_id='sk_live_b9DHfFufCHbB';
insert into public.store_api_key_scopes (api_key_id, store_id)
select k.id, s.id from public.store_api_keys k, public.stores s
 where k.key_id='sk_live_b9DHfFufCHbB' and s.slug='livraria-crista'
 and not exists (select 1 from public.store_api_key_scopes x where x.api_key_id=k.id and x.store_id=s.id);