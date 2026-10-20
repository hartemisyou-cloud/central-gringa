# Auditoria Central (hopehumanbooks.com) — 2026-10-20 ~20:10 UTC

## 1. Resumo em 4 linhas
- **Autoridade única:** confirmada no código — todos os arquivos que falam com a Stripe são `*.server.ts`; zero chamadas Stripe em código de cliente (evidência 1.2).
- **Fio da Stripe:** NÃO foi possível inspecionar a sessão real — as chaves Stripe deste ambiente são placeholders (a própria API respondeu `Invalid API Key provided: PLACEHOL…ACED`). No código atual há um ACHADO: para entradas vindas da fundação, o `success_url` da sessão é `https://www.hopehumanfoundation.org/thank-you?amount=N` — ou seja, o domínio da fundação ENTRA na sessão Stripe neste código (ver 2.2).
- **Pedido pago:** o pedido da auditoria NÃO está no banco acessível. O domínio publicado é servido pela **Vercel** (header `server: Vercel`), com backend/banco próprios; o banco alcançável daqui (Lovable Cloud) tem o pedido mais recente de 2026-10-16 e nenhum com `origin_hhf=true`. É o mesmo tipo de divergência do bug de 19/10: verifiquei o banco errado por não ter acesso ao de produção.
- **Tracking (Meta CAPI / UTMify):** sem token CAPI nem logs Vercel acessíveis neste ambiente; tabelas locais `meta_conversion_events` e `utmify_events` estão vazias (refere-se ao banco Cloud, não ao de produção).

## 2. Evidências por parte

### Parte 1 — Só a Central fala com a Stripe
- **1.1** 37 ocorrências de `hopehumanfoundation` no código (`evidencia-1.1-grep-foundation.txt`). Fora de testes, são exatamente 4 usos:
  - `src/lib/payments/purchase-entry.ts:25,30` — detecção de Referer → marca `origin_hhf` no NOSSO banco e acrescenta `?via=hhf` na URL local `/pay/<token>` (handoff do navegador, não vai à Stripe).
  - `src/lib/payments/checkout-session.server.ts:28` — validação estrita do destino de retorno (host `www.hopehumanfoundation.org`, path `/thank-you`, único param `amount` inteiro ≥ 1).
  - `src/lib/payments/hhf-return.ts:28` — URL de retorno usada só em `window.location.replace` pós-PAID, no navegador.
  - `src/lib/donations/start.server.ts:10-15` — allowlist de Origin e base de erro do fluxo de doações.
  - **Ressalva:** o `success_url` validado em `checkout-session.server.ts` É enviado à Stripe (é campo da sessão). Ver 2.2.
- **1.2** Arquivos que mencionam Stripe (`evidencia-1.2-arquivos-stripe.txt`): `stripe.server.ts`, `provider.server.ts`, `checkout-session.server.ts`, `checkout-health.server.ts`, `admin/stripe.server.ts`, `donations/stripe-sdk.server.ts`, `donations/rules.ts`, `donations/pay-bridge.ts` — todos servidor — mais testes. Grep em `src/routes/`, `src/components/`, `src/hooks/` por `api.stripe.com`/`new Stripe`: **0 resultados** (`evidencia-1.2-stripe-no-cliente.txt`, 0 bytes). A criação de sessão ocorre server-side em `/comprar/<slug>` (purchase-entry → checkout-session.server.ts) e nas rotas de doação.
- **1.3** Chaves em vigor: as 4 variáveis Stripe deste ambiente (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_RESTRICTED_API_KEY`, `STRIPE_LIVE_API_KEY`) são **placeholders** — a API Stripe respondeu `Invalid API Key provided: PLACEHOL********************ACED` (evidência `sessions-list.json`). As chaves reais vivem server-side (cifradas em `stripe_integrations` / env da Vercel) e não são legíveis daqui. Evidência indireta de modo: a sessão criada pelo site publicado hoje tem ID `cs_test_…` → **o deploy de produção está em modo TEST**. Mapa da virada LIVE: trocar a chave cifrada da integração (via /admin, criptografia com `PAYMENTS_ENCRYPTION_KEY`), cadastrar webhook com eventos live e novo `whsec`, renomear perfil Stripe (G3). Código, rotas e gates permanecem idênticos.

### Parte 2 — Fio da Stripe limpo
- **2.1/2.2 BLOQUEADO:** sem chave Stripe válida neste ambiente, não foi possível baixar a sessão real da auditoria. Nenhuma sessão foi criada ou paga por mim na API (apenas GETs, que falharam por chave inválida).
- **ACHADO (código, não sessão real):** em `checkout-session.server.ts:66-82`, para entradas HHF a sessão leva `success_url = https://www.hopehumanfoundation.org/thank-you?amount=N`. A regex da auditoria (`/hopehumanfoundation|via=/`) teria **1 match** nesse campo nas sessões HHF geradas por ESTE código. O line item HHF segue exatamente: `name: "$20"`, `description: "Make a Difference Today"`, `images: ["https://hopehumanbooks.com/hhf-emblem.png"]` (origin da Central), `unit_amount: 2000`, `currency: usd`, `mode: payment` (2.3 confirmado em código). Metadata enviado à Stripe (`buildOrderPaymentMetadata`): apenas `store_id`, `order_id`, `order_number`, `environment`, `product_type`/`category` — UTMs ficam em `order_attribution` (nosso banco), nunca na Stripe.
- **2.4 BLOQUEADO:** GET /account impossível sem chave. Status G3 (renomear perfil para "Hope Human"): **pendente**, sem evidência de concluído.

### Parte 3 — Banco e pedido (produção)
- **3.1 PENDENTE (bloqueio de acesso):** o banco alcançável deste sandbox é o Lovable Cloud. Nele, `orders.origin_hhf boolean NOT NULL DEFAULT false` **existe** (saída `information_schema` salva). Mas o site publicado é servido pela **Vercel** (`server: Vercel`, `x-vercel-id`), com banco de produção próprio que NÃO é acessível daqui. Não posso confirmar a coluna em produção.
- **3.2 Pedido da auditoria: NÃO ENCONTRADO no banco acessível.** Últimos pedidos: ORD-20261016-ZJHURS (PENDING_PAYMENT, $30), ORD-20261016-1GTPS2 (PAYMENT_PROCESSING, $5), dois CANCELLED de 14/10. Nenhum `origin_hhf=true`, nenhum PAID, nada de 20/10. O pagamento da auditoria caiu no backend da Vercel.
- **3.3** Painel admin: não consultado (requer credencial; e mostraria o banco Cloud, não o de produção).

### Parte 4 — Webhook e máquina de estados
- **4.1 BLOQUEADO:** sem chave Stripe, sem GET de eventos. No banco acessível: `webhook_events` = 0 linhas, `payment_events` = 5 (antigas, ≤16/10).
- **4.2 BLOQUEADO:** logs da Vercel não são acessíveis deste ambiente.

### Parte 5 — Meta CAPI
- **5.1/5.2/5.3 BLOQUEADO:** não há token CAPI neste ambiente (não consta em secrets nem env). `meta_conversion_events` = 0 no banco acessível. Sem evidência do Purchase da auditoria.

### Parte 6 — UTMify
- **6.1/6.2 BLOQUEADO:** `utmify_events` = 0 no banco acessível; logs de `api.utmify.com.br` estão na Vercel. A questão operacional (pedidos TEST chegando ao UTMify, incl. ORD-20261019-X9SDP4) fica **aberta para decisão do dono** — sem evidência disponível aqui.

### Parte 7 — Superfície de go-live (site publicado, medido hoje)
- `GET /donations/start` → **405** (só POST); `GET /donations/pay/<token>` → 404 para token inexistente; `GET /donations/receipt/<token>` → **500** para token inexistente (merece revisão: esperado 404); `GET /api/public/v1/donations` → **200** (catálogo ainda público; gate 410 NÃO aplicado).
- `GET /comprar/the-adventures-of-tom-sawyer` → **302 para checkout.stripe.com** (sessão `cs_test_…` real criada pelo deploy Vercel — efeito colateral do meu GET de verificação; a rota cria pedido+sessão no GET por design).
- Tabela go-live:

| Item | Status hoje | Onde será feito |
|---|---|---|
| Chaves pk_live/sk_live | Aberto (hoje TEST, `cs_test_` observado) | /admin da Central (chave cifrada) |
| Webhook em eventos live | Aberto | Stripe Dashboard + `STRIPE_WEBHOOK_SECRET` |
| Perfil Stripe "Hope Human" (G3) | Aberto (sem evidência de renomeado) | Stripe Dashboard pelo dono |
| Repositórios voltar ao privado | Aberto | GitHub |
| Gate 410 em /donations/* | Aberto (rotas respondem; API 200) | Código da Central |

## 3. TABELA FINAL GO/NO-GO

| Verificação | Veredito | Evidência |
|---|---|---|
| Único writer Stripe | **PASS** (código) | 0 refs Stripe em cliente; writers só `*.server.ts` |
| Fio limpo na sessão real | **PENDENTE** | Sem chave Stripe válida; sessão real não inspecionada |
| — Achado no código | **FAIL parcial** | `success_url` HHF leva `hopehumanfoundation.org` para dentro da sessão (checkout-session.server.ts:66) |
| Linha $20 exata | **PASS** (código) / PENDENTE (sessão real) | name "$20", desc "Make a Difference Today", emblem Books, 2000 usd, mode payment |
| Perfil de negócio (G3) | **PENDENTE** | GET /account bloqueado |
| Banco produção OK | **PENDENTE** | Produção é Vercel, inacessível; no banco Cloud a coluna existe |
| Pedido PAID | **PENDENTE** | Pedido de 20/10 ausente no banco acessível |
| Webhook OK | **PENDENTE** | Sem acesso a eventos Stripe/logs Vercel |
| Purchase Meta recebido | **PENDENTE** | Sem token CAPI; tabela local vazia |
| user_data (classificado) | **PENDENTE** | Idem |
| UTMify OK | **PENDENTE** | Tabela local vazia; logs na Vercel |
| Inventário go-live | **PASS** | Tabela da Parte 7 |

## 4. Bloqueios concretos (o que falta para fechar a auditoria)
1. Uma chave Stripe de leitura válida (ou o JSON da sessão exportado do Dashboard) para as Partes 2 e 4.
2. Acesso ao banco de PRODUÇÃO da Vercel (ou export das tabelas `orders`, `webhook_events`, `meta_conversion_events`, `utmify_events`) para as Partes 3–6.
3. Logs da Vercel (ou token CAPI) para Partes 4.2, 5 e 6.
4. Decisão sobre o ACHADO de 2.2: hoje o `success_url` das sessões HHF contém o domínio da fundação por design do código atual.
