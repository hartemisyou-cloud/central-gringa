update public.products set category = 'doacao'
 where store_id = '3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e' and sku like 'CU-DON-%';

insert into public.products (store_id, name, slug, description, sku, price_cents, currency, stock, weight_grams, image_url, category, active) values
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Bíblia de Estudo — Capa em Couro','biblia-estudo-couro','Bíblia de estudo com capa em couro legítimo, páginas com bordas douradas, notas explicativas e concordância.','LC-BIB-001',18900,'USD',40,1200,'/products/biblia-estudo.jpg','livros',true),
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Devocional Diário — 365 Dias com Deus','devocional-365','Livro devocional com uma reflexão bíblica para cada dia do ano, espaço para anotações e orações.','LC-LIV-002',7900,'USD',80,600,'/products/devocional.jpg','livros',true),
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Hinário de Louvor e Adoração','hinario-louvor','Coletânea de hinos clássicos e cânticos contemporâneos com cifras e partituras.','LC-LIV-003',5900,'USD',60,450,'/products/hinario.jpg','livros',true),
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Cruz de Parede em Madeira de Oliveira','cruz-parede-oliveira','Cruz artesanal esculpida em madeira de oliveira, acabamento natural, pronta para pendurar.','LC-DEC-004',6900,'USD',35,700,'/products/cruz-madeira.jpg','decoracao',true),
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Caneca Cristã em Cerâmica','caneca-crista','Caneca de cerâmica branca 330ml com cruz discreta em relevo. Segura para micro-ondas e lava-louças.','LC-PRE-005',2900,'USD',120,400,'/products/caneca-crista.jpg','presentes',true),
('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','Quadro Versículo Bíblico com Moldura','quadro-versiculo','Quadro decorativo com versículo bíblico impresso em papel fine art e moldura de madeira clara.','LC-DEC-006',8900,'USD',45,900,'/products/quadro-versiculo.jpg','decoracao',true);

insert into public.store_api_keys (store_id, label, key_id, key_prefix, key_hash, status)
values ('3bdc4b3c-36cf-4199-ad4c-966a5cb2b98e','livraria-crista-bff','sk_live_0LTMQbTM','sk_live_0LTMQb','a2c0c5668a9d851a64279b3df13501292c3c361b979771376203a120b81f3d51','ACTIVE');

insert into public.store_api_key_scopes (api_key_id, store_id)
select k.id, s.id from public.store_api_keys k, public.stores s
 where k.key_id = 'sk_live_0LTMQbTM' and s.slug in ('coracoes-unidos','loja-2','loja-3','loja-4','livraria-crista');