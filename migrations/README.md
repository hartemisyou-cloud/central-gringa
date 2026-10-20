# Migração da Central para PostgreSQL comum

## Atualização manual 0006 — antes do publish

Executar `migrations/0006_orders_client_ip.sql` no Neon com a conexão de owner
antes de publicar a versão que grava os novos campos de `orders`. A alteração
aditiva preserva pedidos existentes e adiciona três colunas opcionais:
`client_ip` (`text`), `checkout_customer_details` (`jsonb`, snapshot mínimo dos
dados recebidos no webhook Stripe verificado) e `delivery_email_sent_at`
(`timestamptz`, confirmação de envio pelo transporte atual).

A consulta `information_schema.columns` incluída no arquivo deve devolver as
três colunas com `is_nullable = YES` e os tipos acima. A ordem operacional é
**ALTER → confirmação do esquema → publish → sonda GET /comprar/little-women**
(esperado 302). A numeração é independente de `drizzle/migrations/`; não
renumerar nem reaplicar o histórico `0006_public_storefront_catalog_read.sql`.

O esquema vem do backup oficial do Lovable Cloud, exportado com `pg_restore --schema-only --schema=public --no-owner --no-privileges`. A referência integral está em `reference/export-public-schema.sql`; `schema-adaptations.json` registra hashes, objetos preservados e todas as adaptações. Não há linhas de dados, credenciais ou conteúdo de ebooks neste diretório.

Foram preservadas35 tabelas,480 colunas,10 enums,17 funções,21 triggers e89índices. Das135 constraints originais,133 continuam no destino: foram retiradas somente `profiles_id_fkey` e `user_roles_user_id_fkey`, que apontavam para `auth.users`. O snapshot auditado tinha zero usuários em `auth.users`, `profiles` e `user_roles`; essa condição deve ser conferida novamente no backup que será importado. Nenhuma tabela ou linha histórica é descartada por esses ajustes.

As34 políticas de cliente Supabase foram removidas. RLS permanece habilitado nas35 tabelas. Não são criados `auth.uid()`, roles Supabase, usuários fictícios ou uma API pública de banco. O backend ativo usa a autenticação administrativa própria da Central.

## Ordem de restauração

1. Aprovar e provisionar o banco de destino. Configurar localmente `MIGRATION_DATABASE_URL` e `CENTRAL_RUNTIME_PASSWORD` por um meio seguro; não colocá-los no chat, Git, logs ou JavaScript público.
2. Executar `node scripts/setup-database-roles.mjs`. A conexão de migração precisa poder criar roles e administrar o banco. A senha deve ter pelo menos32 bytes. O script cria as roles numa transação, concede ao migrador participação explícita no owner e deixa senhas já existentes intactas ao repetir a execução.
3. Manter a exportação pública de dados fora do repositório. Depois de confirmar que o backup não contém usuários do Auth, executar `node scripts/migrate-database.mjs --apply --auth-users-empty-confirmed --data /caminho/absoluto/privado/public-data.sql`.
4. O script exige um esquema público vazio, aplica `001_pre.sql`, importa somente os35 blocos COPY validados, confere contagens e hashes canônicos de todas as linhas, aplica `002_post.sql` e finalmente `003_server_acl.sql`, dentro de uma única transação. Não executa comandos arbitrários da exportação de dados, não semeia registros e não chama Stripe.
5. Configurar `DATABASE_URL` da aplicação com a conexão de `central_runtime`. A aplicação não recebe `MIGRATION_DATABASE_URL`, a senha isolada usada pelo provisionador nem a conexão administrativa do provedor.

Separar pre-data e post-data permite restaurar as referências cíclicas entre lojas e integração Stripe antes de recriar FKs, constraints, índices e triggers. O importador recusa um destino preenchido: ele não apaga um banco para permitir uma nova tentativa. A preparação das roles e a aplicação da ACL podem ser repetidas sem redefinir dados ou senhas. Após falha durante a tentativa de COMMIT, conferir o estado do destino antes de repetir.

O script verifica o conteúdo restaurado por COPY com todas as colunas na ordem original. Ordena somente as linhas em memória para o hash, de forma que a ordem física não afete a comparação. Os valores são mantidos privados; a saída contém somente nomes de tabelas, contagens e hashes.

## Roles e permissões

`central_owner` é uma role real `NOLOGIN`, sem SUPERUSER, CREATEDB, CREATEROLE ou BYPASSRLS. Ela passa a ser proprietária das tabelas, enums, funções e esquema público. O login administrativo do provedor permanece como migrador, com participação explícita nessa role. Não há uma segunda senha de owner no aplicativo.

`central_runtime` é uma role real `LOGIN NOINHERIT NOBYPASSRLS`, sem SUPERUSER, CREATEDB, CREATEROLE e sem participação em outras roles. A ACL concede somente operações utilizadas pelo código nas29 tabelas ativas; WHERE e RETURNING também são considerados nas permissões SELECT. Ela recebe EXECUTE exatamente nos nove RPCs usados pelo servidor. Funções auxiliares e de trigger não recebem EXECUTE para runtime; o PostgreSQL trata a execução de triggers pelas regras próprias.

PUBLIC perde acesso ao esquema, tabelas, sequences e execução de funções, inclusive todas as SECURITY DEFINER. A aplicação não possui CREATE no esquema público, não pode assumir o owner e suas consultas continuam sujeitas a RLS. Os defaults de privilégios futuros também revogam EXECUTE público.

Seis tabelas históricas continuam preservadas, sem grants ou políticas de acesso para runtime: `cart_items`, `carts`, `product_variants`, `profiles`, `stripe_checkout_sessions` e `user_roles`. Elas não são utilizadas pelo fluxo ativo auditado. Qualquer uso futuro exige uma alteração explícita da ACL.

## Verificação e riscos existentes

`src/lib/db/schema.test.ts` restaura o esquema em PostgreSQL PGlite com roles reais e um migrador sem SUPERUSER. Confere os35 objetos de tabela,480 colunas,287 NOTNULL,10 enums,17 corpos de função idênticos,21 triggers,89índices,133 constraints e RLS. Testa negações reais para runtime/PUBLIC e reaplicação de owner/ACL. PGlite usa PostgreSQL 18; as contagens de constraints excluem o novo tipo de catálogo NOTNULL para comparar corretamente com a origem PostgreSQL 17.11.

As funções de estoque foram preservadas literalmente. Há um problema preexistente demonstrado pelos testes: chamar `commit_order_stock` duas vezes desconta estoque duas vezes; chamar `release_order_stock` duas vezes pode reduzir a reserva de outro pedido. Os guards do webhook na aplicação reduzem repetições sequenciais, mas não garantem exclusão entre entregas concorrentes. A correção precisa de uma nova migração revisada, com lock da linha do pedido, guard persistente e testes de concorrência; os testes atuais registram a evidência do risco, sem apresentá-lo como comportamento desejado.

As funções de doação também preservam suas transações e locks. A ordem de locks entre donation e release difere em algumas delas, podendo gerar deadlocks sob concorrência; os fluxos de release permanecem desligados. Alterar a ordem dos locks é um trabalho separado.

O esquema não substitui a cópia dos arquivos privados, a configuração segura da chave `PAYMENTS_ENCRYPTION_KEY`, a validação dos webhooks, a coordenação de gravações no corte ou os testes posteriores à implantação. Essas etapas devem terminar antes da troca de domínio.
