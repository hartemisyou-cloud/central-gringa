INSERT INTO public.products (store_id, name, slug, description, sku, price_cents, currency, stock, weight_grams, category, active) VALUES
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 20','doacao-usd-20','Doação única de US$ 20 para Corações Unidos.','CU-DON-020',2000,'USD',1000000,0,'doacao',true),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 30','doacao-usd-30','Doação única de US$ 30 para Corações Unidos.','CU-DON-030',3000,'USD',1000000,0,'doacao',true),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 50','doacao-usd-50','Doação única de US$ 50 para Corações Unidos.','CU-DON-050',5000,'USD',1000000,0,'doacao',true),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 100','doacao-usd-100','Doação única de US$ 100 para Corações Unidos.','CU-DON-100',10000,'USD',1000000,0,'doacao',true),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 250','doacao-usd-250','Doação única de US$ 250 para Corações Unidos.','CU-DON-250',25000,'USD',1000000,0,'doacao',true),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','Doação US$ 500','doacao-usd-500','Doação única de US$ 500 para Corações Unidos.','CU-DON-500',50000,'USD',1000000,0,'doacao',true);

INSERT INTO public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, status) VALUES
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-20','sk_live_6t3odjEAZ9P3','sk_live_6t3odj','b215e6fae4339d1f914f1b4ba6c4bdf084c481e078ee5fd65accb55a49c0c7d4','ACTIVE'),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-30','sk_live_ce4RJbHdPY3X','sk_live_ce4RJb','1ac8d9f508ba2eaf16ca1e94d360871ec29ad0fa57769ba502fc3c57a5c2310a','ACTIVE'),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-50','sk_live_zHxWTfpjoupJ','sk_live_zHxWTf','939ef8c835d7873e240775da1bc55a61cd74df03ed2d5c23c45daf5e293a17d2','ACTIVE'),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-100','sk_live_5GkbqA58qqhr','sk_live_5GkbqA','80194d614ba2a0a1f3a6b42342d41d2e560770f3a8dcc2526b5794a079ee92fd','ACTIVE'),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-250','sk_live_HKkB6Z3oVFLa','sk_live_HKkB6Z','79c4f15c9ed1314e2287a2fa525d4059c7317be7e59cddfaab1ecbb0e874aeb9','ACTIVE'),
 ('0f8a57ee-a78f-4ab9-84f5-dd007bdec316','doacao-usd-500','sk_live_HWDQTCJAGxtr','sk_live_HWDQTC','49c3a8237fb966bc0590cd41606f75308a2c7c71f1d36a8dcafb39d17ba80332','ACTIVE');