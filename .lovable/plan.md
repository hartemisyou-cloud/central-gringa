# Analytics em tempo real no /admin/analytics

## Auditoria do que existe hoje

- Eventos do checkout são enviados em lote pelo navegador (`src/lib/analytics/client.ts`) para `POST /api/public/v1/analytics/events`, com flush por tempo e no `pagehide`.
- A ingestão (`src/lib/analytics/ingest.server.ts`) grava em duas tabelas: `analytics_events` (histórico, dedupe por `event_id`) e `checkout_sessions` (uma linha por sessão de checkout, com `status`, `last_seen_at`, `viewed_at`, `started_at`, `attempted_at`, `succeeded_at`).
- O painel (`src/routes/admin_.analytics.tsx`) chama `analyticsReport` (server fn admin) que agrega tudo em memória a partir dessas duas tabelas.
- O "threshold" de 30 não filtra métricas: `MIN_SAMPLE = 30` em `query.server.ts` só governa **insights** comparativos e adiciona um aviso "amostra insuficiente". Todas as métricas/cards já aparecem a partir do primeiro evento.
- A vitrine (`/`) e o `/checkout` usam `useStorefrontTracking` (Meta Pixel + atribuição) e **não** enviam eventos de presença; só a página de pagamento (`/pay/$token`) usa o tracker de analytics.

## Implementação proposta (mínima, reaproveitando a infra existente)

1. **Uma tabela nova de presença** (migration): `presence_sessions` com `session_id` (PK), `store_id`, `state` (`ACTIVE`/`CART`/`CHECKOUT`/`PAID`/`ENDED`), `last_seen_at`, `first_seen_at`, `page`, `user_agent`, `is_bot`. Sem RLS pública (só service role / server fns), GRANTs apenas para `service_role`.
   - Nada é gravado em `analytics_events`/`checkout_sessions` de forma diferente — o histórico fica intacto.
2. **Endpoint público de heartbeat**: `POST /api/public/v1/analytics/presence` recebendo `{ sessionId, storeSlug?, state, page? }`.
   - Rate limit pela mesma função `enforceRateLimit` já usada no endpoint de eventos.
   - Descarta bots por user-agent (bot/crawler/spider/headless/node/curl/monitor/health) e requisições sem UA de navegador → não contam como online.
   - `upsert` por `session_id`, com progressão de estado (não regride de CHECKOUT para CART; `PAID`/`ENDED` são finais).
3. **Cliente de presença** (`src/lib/analytics/presence-client.ts` + hook `usePresence`): gera/reusa um `session_id` em `sessionStorage`, envia heartbeat a cada 25s enquanto a aba está visível, e envia eventos `SESSION_ACTIVE`, `CART_OPENED`, `CHECKOUT_VIEWED`, `PAYMENT_SUCCEEDED`, `SESSION_ENDED` (este via `sendBeacon` no `pagehide`).
   - Instrumentado em `/` (session ativa + abertura do carrinho), `/checkout` (checkout visualizado), `/pay/$token` (checkout visualizado + pagamento aprovado). Nada do fluxo de pagamento muda.
4. **Server fn admin `analyticsRealtime`**: conta sessões distintas por `session_id`:
   - Online agora: `last_seen_at >= now - 60s`, `state != ENDED`, `is_bot = false`.
   - Carrinho aberto agora: `state = CART` e `last_seen_at >= now - 5min`.
   - No checkout agora: `state = CHECKOUT` e `last_seen_at >= now - 5min`.
   - Expiração automática: sessões sem heartbeat simplesmente saem das janelas; linhas com mais de 1 dia são limpas na própria consulta.
5. **UI**: três cards no topo do painel, com `refetchInterval` de 7s, e a linha "Última atualização: HH:mm:ss". Filtro de loja do painel é respeitado.
6. **Ajuste do threshold**: os cards em tempo real e as métricas básicas não usam `MIN_SAMPLE`; removo apenas o insight "Amostra insuficiente" e mantenho o gate de 30 somente nas comparações estatísticas (mobile vs desktop, wallet vs cartão), onde ele evita conclusões falsas.

## Fora de escopo (não será tocado)

Stripe, webhooks, Meta CAPI, UTMify, attribution e qualquer lógica de pagamento/pedido.
