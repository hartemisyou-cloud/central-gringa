UPDATE public.products SET
  name = CASE price_cents
    WHEN 2000 THEN 'Devocional Diário Fé em Ação'
    WHEN 3000 THEN 'Bíblia de Bolso Capa Dura'
    WHEN 5000 THEN 'Bíblia de Estudo Ilustrada'
    WHEN 10000 THEN 'Kit Bíblia de Estudo + Devocional'
    WHEN 25000 THEN 'Coleção Clássicos Cristãos (10 volumes)'
    WHEN 50000 THEN 'Biblioteca Cristã Completa Edição Premium'
    ELSE name END,
  sku = CASE price_cents
    WHEN 2000 THEN 'LC-DEV-020'
    WHEN 3000 THEN 'LC-BIB-030'
    WHEN 5000 THEN 'LC-BIE-050'
    WHEN 10000 THEN 'LC-KIT-100'
    WHEN 25000 THEN 'LC-COL-250'
    WHEN 50000 THEN 'LC-PRE-500'
    ELSE sku END,
  slug = CASE price_cents
    WHEN 2000 THEN 'devocional-diario-fe-em-acao'
    WHEN 3000 THEN 'biblia-de-bolso-capa-dura'
    WHEN 5000 THEN 'biblia-de-estudo-ilustrada'
    WHEN 10000 THEN 'kit-biblia-estudo-devocional'
    WHEN 25000 THEN 'colecao-classicos-cristaos'
    WHEN 50000 THEN 'biblioteca-crista-completa-premium'
    ELSE slug END,
  description = CASE price_cents
    WHEN 2000 THEN 'Devocional diário com reflexões bíblicas para 365 dias.'
    WHEN 3000 THEN 'Bíblia Sagrada de bolso, capa dura, letra confortável.'
    WHEN 5000 THEN 'Bíblia de estudo ilustrada com mapas e notas explicativas.'
    WHEN 10000 THEN 'Kit com Bíblia de estudo e devocional diário encadernados.'
    WHEN 25000 THEN 'Coleção com 10 volumes de clássicos da literatura cristã.'
    WHEN 50000 THEN 'Biblioteca cristã completa em edição premium com acabamento especial.'
    ELSE description END,
  category = 'literatura-crista'
WHERE category = 'doacao';