# Central Pay Hub

Quero que você atue como *arquiteto de software, desenvolvedor full stack sênior e especialista em segurança de pagamentos*.

Precisamos implementar uma arquitetura centralizada de pagamentos utilizando Stripe.

Não quero apenas uma integração simples com Stripe. Quero criar uma estrutura preparada para que *várias lojas/sites meus possam utilizar uma única API central de pagamentos*, sendo administradas por um painel privado.

A primeira integração será chamada *Loja 1*.

# CONTEXTO DA LOJA 1

A Loja 1 é um e-commerce de artigos religiosos.

Produtos iniciais:

* Terços

* Bíblias

* Artigos religiosos relacionados

São produtos físicos e precisam trabalhar com:

* catálogo;

* SKU;

* preço;

* estoque;

* quantidade;

* carrinho;

* pedidos;

* cliente;

* endereço de entrega;

* frete;

* pagamento;

* status do pagamento;

* status do pedido.

Não limite a arquitetura somente a esses dois produtos. Ela deverá permitir cadastrar outros produtos futuramente.

---

# STACK ATUAL

Antes de modificar qualquer coisa, analise o repositório inteiro e identifique como o projeto está estruturado.

A arquitetura preferencial é:

## Frontend

* React

* TypeScript

* Vite

* TanStack Query

* Tailwind CSS

* shadcn/ui

## Backend

* Node.js

* arquivos .mjs onde o projeto já utilizar esse padrão;

* AWS Lambda;

* API Gateway;

* AWS CDK em TypeScript;

* Aurora PostgreSQL;

* acesso ao Aurora através da RDS Data API.

## Infraestrutura

Utilizar, quando aplicável:

* AWS Secrets Manager;

* AWS CloudWatch;

* API Gateway;

* Lambda;

* Aurora PostgreSQL;

* AWS CDK.

Antes de implementar:

1. leia o projeto;

2. identifique o que já existe;

3. não recrie componentes, serviços ou módulos que já existam;

4. preserve padrões existentes;

5. identifique pontos que precisam de refatoração;

6. apresente resumidamente o plano;

7. depois execute a implementação.

Não quero apenas exemplos de código. Quero implementação funcional no projeto.

---

# OBJETIVO GERAL

Criar a seguinte arquitetura:

text

LOJA 1

   |

   v

BACKEND DA LOJA 1 / BFF

   |

   | autenticação da loja

   v

API CENTRAL DE PAGAMENTOS

   |

   +----------------------+

   |                      |

   v                      v

BANCO CENTRAL        STRIPE SERVICE

                          |

                          v

                       STRIPE

                          |

                          | Webhook

                          v

                 API CENTRAL DE PAGAMENTOS

E separadamente:

text

ADMIN

  |

  v

PAINEL PRIVADO

  |

  v

API ADMIN

  |

  +-- Lojas

  +-- Stripe

  +-- Pagamentos

  +-- Pedidos

  +-- Webhooks

  +-- Logs

  +-- Credenciais

---

# REGRA DE SEGURANÇA MAIS IMPORTANTE

A Stripe Secret Key:

text

sk_live_...

ou:

text

sk_test_...

NUNCA pode:

* aparecer no React;

* aparecer no bundle frontend;

* ser enviada ao navegador;

* ficar hardcoded;

* ser commitada no Git;

* aparecer em logs;

* aparecer em respostas da API;

* ser armazenada em plaintext no banco.

Armazene a chave secreta utilizando *AWS Secrets Manager*.

O banco deverá guardar somente uma referência ao Secret quando necessário.

Também deverá existir suporte separado para:

* ambiente test;

* ambiente live.

Nunca misturar objetos, pagamentos ou credenciais de test e live.

---

# RESTRICTED KEYS

Se for compatível com as operações necessárias, prepare a arquitetura para utilizar Stripe Restricted Keys no lugar de uma chave secreta irrestrita.

Não reduza a funcionalidade necessária somente para forçar restricted keys.

---

# PUBLISHABLE KEY

A Stripe Publishable Key:

text

pk_test_...

pk_live_...

pode ser utilizada pelo frontend no Stripe.js.

A Secret Key nunca poderá acompanhar essa chave.

---

# PAINEL CENTRAL DE PAGAMENTOS

Criar no painel administrativo uma seção:

text

Pagamentos

com submenu:

text

Dashboard

Transações

Lojas

Integrações

Webhooks

Logs

Configurações

---

# DASHBOARD

Criar dashboard contendo pelo menos:

* volume processado;

* quantidade de pagamentos;

* pagamentos aprovados;

* pagamentos pendentes;

* pagamentos recusados;

* pagamentos reembolsados;

* quantidade de lojas;

* volume por loja;

* pagamentos recentes.

Permitir filtros:

* hoje;

* últimos 7 dias;

* últimos 30 dias;

* período personalizado;

* loja;

* status.

---

# INTEGRAÇÕES > STRIPE

Criar área para configurar Stripe.

Campos:

text

Nome da integração

Ambiente: TEST | LIVE

Publishable Key

Secret Key

Status

A Secret Key deverá ser enviada ao backend e armazenada imediatamente no AWS Secrets Manager.

Depois de armazenada, o frontend nunca mais deverá receber seu valor integral.

No painel mostrar somente algo semelhante a:

text

••••••••••••••9AbC

Criar botão:

text

Testar conexão

O teste deverá acontecer server-side.

Salvar também, se disponível:

* Stripe Account ID;

* data de criação;

* data da última validação;

* status da conexão.

---

# LOJAS

Criar módulo:

text

Pagamentos > Lojas

Cada loja deverá possuir:

text

id

name

slug

domain

status

environment

stripe_integration_id

created_at

updated_at

Criar a primeira:

text

Nome: Loja 1

Tipo: E-commerce de artigos religiosos

O domínio deve ser configurável.

---

# CREDENCIAIS POR LOJA

Cada loja deverá possuir credenciais próprias para comunicação com a API central.

Exemplo conceitual:

text

store_id

store_api_key

Porém:

## MUITO IMPORTANTE

store_api_key nunca poderá ficar dentro do JavaScript público da Loja 1.

Ela deverá existir somente no backend/BFF da Loja 1.

Se a Loja 1 atualmente possuir apenas frontend, crie uma pequena camada server-side usando a infraestrutura existente para fazer essa comunicação.

Fluxo:

text

Browser

   |

   v

Backend/BFF da Loja

   |

   | private store credential

   v

API Central

Nunca:

text

Browser -> store_api_key -> API Central

As credenciais das lojas devem:

* ser aleatórias e criptograficamente seguras;

* permitir revogação;

* permitir rotação;

* possuir identificação;

* ter data de criação;

* ter último uso;

* permitir status ativo/revogado.

Não guardar a chave integral em plaintext se não for necessário.

Preferencialmente armazenar hash da chave quando a arquitetura permitir.

Mostrar o segredo apenas no momento da criação/rotação.

---

# CORS

Criar allowlist de domínios cadastrados.

Por exemplo:

text

https://loja1.com.br

Não utilizar:

text

Access-Control-Allow-Origin: *

nos endpoints sensíveis.

CORS não deverá ser utilizado como substituto de autenticação.

---

# RATE LIMIT

Adicionar proteção contra abuso nos endpoints públicos de pagamento.

Implementar uma estratégia compatível com a infraestrutura atual para:

* rate limiting;

* detecção de abuso;

* proteção contra criação massiva de PaymentIntents.

---

# BANCO DE DADOS

Analise o schema atual e crie migrations adequadas.

A estrutura conceitual deverá possuir algo equivalente a:

text

stripe_integrations

stores

store_api_keys

customers

addresses

products

product_variants

inventory

carts

cart_items

orders

order_items

payments

payment_events

refunds

webhook_events

audit_logs

Não crie tabelas redundantes se funcionalidades equivalentes já existirem.

---

# PRODUCTS

Para Loja 1 precisamos suportar inicialmente:

text

Terços

Bíblias

Um produto deve possuir pelo menos:

text

id

store_id

name

slug

description

sku

price

currency

stock

active

created_at

updated_at

Prepare para imagens e variantes se a arquitetura atual já comportar isso.

Exemplos futuros:

text

Bíblia Sagrada

Bíblia de Estudo

Terço de Madeira

Terço de Cristal

Terço Nossa Senhora

Não hardcode os produtos.

Eles deverão ser cadastráveis.

---

# CARRINHO

Implementar carrinho contendo:

text

product_id

quantity

O frontend poderá enviar os IDs dos produtos e quantidades.

Porém o frontend NÃO é fonte confiável para:

* preço;

* desconto;

* subtotal;

* frete;

* total.

Esses valores devem ser calculados/validados server-side.

NUNCA faça algo semelhante a:

text

frontend:

amount = 1.00

backend:

cobra 1.00

O servidor deverá buscar os preços válidos.

Fluxo:

text

Frontend:

[

  {

    "productId": "...",

    "quantity": 2

  }

]

Backend:

busca produto

valida produto ativo

valida estoque

busca preço

calcula subtotal

calcula frete

calcula descontos autorizados

calcula total

---

# PEDIDO

Antes do pagamento, criar um Order interno.

Exemplo de status:

text

PENDING_PAYMENT

PAYMENT_PROCESSING

PAID

PAYMENT_FAILED

CANCELLED

REFUNDED

PARTIALLY_REFUNDED

Não considerar o pedido pago simplesmente porque o navegador redirecionou para uma tela de sucesso.

A confirmação definitiva deverá ocorrer pelo backend.

---

# ENDEREÇO E ENTREGA

Como são produtos físicos, implementar estrutura para:

text

nome

sobrenome

email

telefone

CEP

logradouro

número

complemento

bairro

cidade

estado

país

Preparar a arquitetura para cálculo de frete.

Se atualmente não existir integração de frete, criar uma abstração:

text

ShippingService

Não inventar valores de frete.

Caso não exista provedor de frete configurado, deixar implementação preparada/configurável e documentar exatamente o que falta.

---

# FLUXO DE CHECKOUT DA LOJA 1

O fluxo deve ser:

text

Produto

   ↓

Carrinho

   ↓

Checkout

   ↓

Dados pessoais

   ↓

Endereço

   ↓

Frete

   ↓

Revisão

   ↓

Pagamento Stripe

   ↓

Processando

   ↓

Pagamento confirmado

   ↓

Pedido confirmado

---

# STRIPE SERVICE

Criar uma camada específica para Stripe.

Exemplo:

text

StripeService

Nenhuma página React deverá chamar diretamente endpoints privilegiados da Stripe.

O StripeService deverá ser responsável por operações como:

text

createPaymentIntent

retrievePaymentIntent

cancelPaymentIntent

refundPayment

retrieveRefund

Use o SDK oficial da Stripe compatível com o projeto.

Não espalhe chamadas diretas à Stripe pelo código.

---

# CRIAÇÃO DO PAGAMENTO

A criação deverá partir de um Order interno válido.

Fluxo:

text

Loja 1

   ↓

cria order

   ↓

backend valida itens

   ↓

backend calcula total

   ↓

cria PaymentIntent

Adicionar metadata útil ao objeto Stripe, sem informações sensíveis desnecessárias.

Exemplo:

text

store_id

order_id

environment

Nunca utilizar metadata como única fonte de verdade.

O banco local continua sendo a fonte da relação entre pagamento, pedido e loja.

---

# IDEMPOTÊNCIA

Implementar idempotência.

A mesma tentativa válida de criação de pagamento não poderá gerar múltiplas cobranças porque:

* usuário clicou duas vezes;

* navegador repetiu request;

* Lambda repetiu processamento;

* houve timeout;

* ocorreu retry.

Utilizar uma chave estável vinculada ao pedido/tentativa de pagamento.

Exemplo conceitual:

text

payment:create:{order_id}:{attempt}

Além da idempotência na Stripe, implementar proteções internas no banco contra duplicidade.

---

# PAYMENT ELEMENT

Para o checkout embedded da Loja 1, utilizar a integração moderna oficial da Stripe para o frontend, preferencialmente Stripe.js + Payment Element, desde que compatível com a arquitetura existente.

O PaymentIntent deve ser criado server-side.

O frontend deve receber apenas as informações públicas necessárias para concluir aquele pagamento.

---

# MÉTODOS DE PAGAMENTO

Não hardcode métodos que a conta Stripe não suporte.

Prepare a integração para utilizar os métodos habilitados/configurados na conta Stripe e compatíveis com o país/moeda da operação.

A arquitetura deverá permitir posteriormente ativar/desativar métodos sem reescrever todo o checkout.

---

# WEBHOOK STRIPE

Criar endpoint dedicado, por exemplo:

text

POST /webhooks/stripe

A implementação deverá:

1. receber o body RAW;

2. obter Stripe-Signature;

3. obter o Webhook Secret server-side;

4. validar a assinatura usando a SDK oficial Stripe;

5. rejeitar evento inválido;

6. identificar se o evento já foi processado;

7. registrar o evento;

8. processar de forma idempotente;

9. atualizar Payment;

10. atualizar Order quando necessário.

Nunca parsear/modificar o body antes da verificação da assinatura.

---

# EVENTOS

Suportar os eventos necessários ao fluxo implementado.

No mínimo considerar estados equivalentes a:

text

pagamento concluído;

pagamento falhou;

pagamento cancelado;

reembolso;

disputa/chargeback, se aplicável.

Utilize os eventos corretos para a modalidade de pagamento implementada.

Não marque o pedido como PAID apenas baseado no frontend.

---

# WEBHOOK EVENTS

Criar registro interno contendo pelo menos:

text

stripe_event_id

event_type

livemode

processed

processing_status

received_at

processed_at

error_message

Criar constraint UNIQUE para o Stripe Event ID quando adequado.

Isso deve impedir processamento duplicado do mesmo evento.

---

# PAGAMENTOS

Tabela de Payment deve relacionar:

text

id

store_id

order_id

provider

provider_payment_id

amount

currency

status

environment

created_at

updated_at

Nesse momento:

text

provider = STRIPE

Mas não faça a aplicação inteira depender do nome Stripe.

Quero deixar aberta a possibilidade de adicionar outros provedores no futuro.

Criar abstração adequada:

text

PaymentProvider

StripePaymentProvider

ou arquitetura equivalente compatível com o projeto.

---

# TRANSAÇÕES NO PAINEL ADMIN

Criar:

text

Pagamentos > Transações

Mostrar:

text

Pedido

Loja

Cliente

Valor

Moeda

Método

Status

Data

Stripe Payment ID

Filtros:

text

Loja

Status

Data inicial

Data final

Valor

Pedido

Email

Stripe Payment ID

Ao clicar, abrir detalhes.

---

# DETALHES DA TRANSAÇÃO

Mostrar:

text

Pedido

Loja

Cliente

Produtos

Subtotal

Frete

Desconto

Total

Status do pedido

Status do pagamento

Stripe PaymentIntent ID

Data de criação

Data de pagamento

Timeline

Timeline exemplo:

text

Pedido criado

Pagamento criado

Pagamento iniciado

Webhook recebido

Pagamento confirmado

Pedido confirmado

---

# REEMBOLSO

Adicionar funcionalidade administrativa para reembolso quando permitido.

A ação deverá exigir confirmação explícita.

Suportar:

text

reembolso total;

reembolso parcial;

Registrar:

text

quem solicitou

valor

motivo

data

Stripe Refund ID

status

Nunca permitir que uma chamada pública da Loja 1 faça reembolso sem autenticação e autorização adequadas.

---

# AUDITORIA

Criar audit log para operações administrativas relevantes.

Exemplos:

text

Stripe configurada

Stripe alterada

Stripe testada

Loja criada

Loja desativada

API key criada

API key rotacionada

API key revogada

Reembolso solicitado

Configuração modificada

Guardar:

text

actor

action

resource_type

resource_id

metadata segura

ip quando disponível

created_at

Nunca colocar secrets no audit log.

---

# LOGS

Nunca registrar:

text

Stripe Secret Key

Store API Key completa

Webhook Secret

dados completos de cartão

client_secret integral desnecessariamente

Sanitizar logs.

---

# ADMIN

O painel de Stripe e lojas é PRIVADO.

Reutilize o sistema de autenticação administrativa existente.

Se não existir controle adequado de autorização, implemente RBAC simples compatível com o projeto.

Exemplo:

text

ADMIN

FINANCE

SUPPORT

Somente permissões adequadas poderão:

text

alterar Stripe;

criar/revogar credenciais;

realizar reembolso;

alterar configurações críticas.

---

# ENDPOINTS

Analise os endpoints atuais antes de criar novos.

Uma estrutura conceitual aceitável seria:

text

/admin/payment-integrations

/admin/payment-integrations/stripe

/admin/stores

/admin/stores/:id

/admin/stores/:id/credentials

/admin/payments

/admin/payments/:id

/admin/payments/:id/refund

/admin/webhook-events

/admin/audit-logs

Para Loja 1:

text

/store/orders

/store/orders/:id

/store/orders/:id/payment

E:

text

/webhooks/stripe

Escolha rotas coerentes com o padrão já existente no projeto.

---

# NÃO EXPOR AMOUNT COMO AUTORIDADE

Um requisito crítico:

O frontend não decide quanto será cobrado.

Por exemplo, não confiar nisso:

json

{

  "amount": 100

}

para definir diretamente a cobrança.

Usar:

json

{

  "items": [

    {

      "productId": "abc",

      "quantity": 1

    }

  ]

}

O servidor calcula o valor.

---

# ESTOQUE

Implementar validação de estoque.

Evitar vender quantidade maior que a disponível.

Planejar corretamente quando:

* reservar estoque;

* liberar reserva após falha/cancelamento;

* confirmar baixa depois do pagamento.

Evite condições de corrida.

Utilize transações/locking ou estratégia equivalente compatível com Aurora PostgreSQL.

---

# SEGURANÇA

Revisar:

* SQL Injection;

* XSS;

* CSRF quando aplicável;

* broken access control;

* IDOR;

* exposição de secrets;

* replay;

* duplicidade de pagamentos;

* brute force;

* mass assignment;

* CORS;

* rate limiting;

* validação de inputs;

* authorization;

* webhook forgery.

Validar inputs com biblioteca já existente no projeto ou solução adequada.

Não confiar em IDs simplesmente porque vieram do frontend.

Sempre validar pertencimento à loja/usuário correto.

---

# AWS SECRETS MANAGER

Criar estrutura para:

text

/prod/payments/stripe/main

/test/payments/stripe/main

ou padrão equivalente coerente com a infraestrutura existente.

Não hardcode ARNs se o CDK puder fornecer referências adequadamente.

Configurar IAM usando princípio do menor privilégio.

A Lambda que processa Stripe deve ter acesso somente aos secrets necessários.

---

# INFRAESTRUTURA CDK

Atualizar o CDK para incluir o necessário.

Antes de criar recursos novos, verificar se equivalentes já existem.

Configurar:

* Secrets Manager;

* permissões IAM;

* Lambda;

* API Gateway;

* variáveis não sensíveis;

* logs;

* recursos necessários para webhook;

* banco/migrations quando necessário.

Não destruir infraestrutura existente.

---

# FRONTEND ADMIN

Manter o design system já utilizado no projeto.

Usar:

* componentes existentes;

* shadcn/ui;

* TanStack Query;

* padrão visual existente;

* responsividade;

* loading states;

* empty states;

* error states;

* confirmations;

* toast/feedback.

Não criar um segundo design system.

---

# FRONTEND LOJA 1

O checkout deverá ter aparência profissional e simples.

Etapas:

text

Carrinho

Entrega

Pagamento

Confirmação

Mostrar resumo fixo ou facilmente acessível contendo:

text

Produtos

Quantidade

Subtotal

Frete

Desconto

Total

Produtos como:

text

Terço de Madeira        2x

Bíblia Sagrada          1x

O usuário deverá conseguir entender claramente o valor final antes do pagamento.

---

# CONFIRMAÇÃO

Depois da tentativa de pagamento, não assumir sucesso apenas pelo retorno do navegador.

A página pode mostrar inicialmente:

text

Confirmando seu pagamento...

Consultar o backend.

Somente mostrar:

text

Pagamento confirmado

Pedido confirmado

quando o backend tiver o estado correspondente.

---

# PÁGINA DO PEDIDO

Criar página de confirmação contendo:

text

Número do pedido

Produtos

Valor

Endereço

Status do pagamento

Status do pedido

Não expor informações internas desnecessárias da Stripe.

---

# TEST MODE PRIMEIRO

Antes de permitir LIVE:

implementar e testar todo o fluxo com Stripe Test Mode.

O painel deverá deixar visualmente muito claro:

text

TEST

versus:

text

LIVE

Nunca misturar pagamentos dos dois ambientes.

---

# TESTES

Adicionar testes para os pontos críticos.

No mínimo:

1. cálculo de total;

2. produto inválido;

3. produto inativo;

4. estoque insuficiente;

5. pedido;

6. criação de pagamento;

7. idempotência;

8. webhook válido;

9. webhook com assinatura inválida;

10. webhook duplicado;

11. atualização de pagamento;

12. atualização de pedido;

13. autorização administrativa;

14. isolamento entre lojas.

Mockar Stripe onde for adequado.

Separar testes unitários e integração conforme estrutura atual.

---

# TESTE DE FLUXO

Quero conseguir testar:

text

1. Admin configura Stripe Test.

2. Admin cadastra Loja 1.

3. Loja 1 possui produtos.

4. Cliente adiciona Bíblia ao carrinho.

5. Cliente adiciona Terço ao carrinho.

6. Backend calcula preços.

7. Cliente informa endereço.

8. Sistema calcula/seleciona frete.

9. Order é criado.

10. PaymentIntent é criado.

11. Payment Element é carregado.

12. Cliente paga com método de teste.

13. Stripe envia webhook.

14. Webhook é validado.

15. Payment fica PAID.

16. Order fica PAID/CONFIRMED.

17. Estoque é atualizado.

18. Transação aparece no painel.

---

# MULTI-STORE

Embora apenas Loja 1 seja implementada agora, a arquitetura precisa permitir:

text

Loja 1

Loja 2

Loja 3

...

Não hardcode:

text

storeId = 1

Toda entidade relevante deverá possuir relação adequada com a loja.

---

# PREPARAÇÃO PARA FUTUROS PROVIDERS

Não implementar agora, mas deixar a camada de pagamentos preparada para futuramente suportar:

text

Stripe

Mercado Pago

Pagar.me

Asaas

outros

Não quero precisar reescrever Orders quando outro provedor for adicionado.

---

# NÃO USAR STRIPE CONNECT AGORA

Neste momento, as lojas pertencem à mesma operação e utilizarão minha infraestrutura central.

Não implementar Stripe Connect sem necessidade.

A abstração poderá permitir evolução futura, mas o escopo atual é uma integração Stripe central.

---

# MIGRATIONS

Todas as mudanças de banco deverão possuir migrations.

Não alterar banco manualmente sem migration.

Se já existir mecanismo próprio de migrations no projeto, reutilize-o.

---

# DOCUMENTAÇÃO

Criar documentação técnica contendo:

text

docs/payments/architecture.md

docs/payments/stripe.md

docs/payments/store-integration.md

docs/payments/webhooks.md

docs/payments/security.md

Se o projeto já possuir estrutura equivalente para documentação, use-a.

Documentar:

* arquitetura;

* variáveis necessárias;

* Secrets Manager;

* configuração Stripe;

* configuração webhook;

* fluxo do checkout;

* fluxo do pagamento;

* fluxo do webhook;

* como cadastrar uma nova loja;

* como gerar/rotacionar credenciais;

* como testar;

* como habilitar produção.

Nunca colocar chaves reais na documentação.

---

# ENVIRONMENT

Criar .env.example somente com placeholders.

Exemplo:

text

STRIPE_SECRET_REFERENCE=

STRIPE_WEBHOOK_SECRET_REFERENCE=

STRIPE_PUBLISHABLE_KEY=

Não coloque secrets verdadeiros.

---

# UX DO PAINEL

Quero conseguir fazer:

text

Pagamentos

    ↓

Integrações

    ↓

Stripe

    ↓

Adicionar Stripe

Depois:

text

Pagamentos

    ↓

Lojas

    ↓

Adicionar Loja

    ↓

Loja 1

    ↓

Selecionar Stripe

    ↓

Gerar credencial

Depois conseguir visualizar:

text

Loja 1

Status: Ativa

Stripe: Conectada

Ambiente: Test

Domínio: ...

Volume hoje: ...

Pagamentos: ...

---

# CRITÉRIOS DE ACEITE

A tarefa não será considerada concluída enquanto:

* Stripe Secret não estiver protegida;

* nenhum secret estiver no frontend;

* Loja 1 estiver cadastrável;

* Loja 1 conseguir criar pedido;

* produtos tiverem preço validado server-side;

* estoque for validado;

* PaymentIntent for criado server-side;

* Stripe frontend estiver funcional;

* webhook possuir validação de assinatura;

* webhook for idempotente;

* pagamento atualizar o pedido;

* transação aparecer no painel;

* test/live estiverem separados;

* migrations existirem;

* erros estiverem tratados;

* logs não vazarem secrets;

* testes críticos existirem;

* documentação estiver criada.

---

# FORMA DE TRABALHO

Primeiro faça uma auditoria do projeto.

Me responda inicialmente com:

text

1. Arquitetura atual encontrada

2. Componentes que podemos reutilizar

3. Problemas encontrados

4. Arquivos que serão criados

5. Arquivos que serão modificados

6. Schema/migrations necessárias

7. Endpoints necessários

8. Fluxo de pagamento proposto

9. Riscos de segurança encontrados

Depois prossiga com a implementação.

Não fique apenas descrevendo código.

Faça as alterações.

Depois de cada etapa:

* rode lint;

* rode typecheck;

* rode testes relevantes;

* corrija erros encontrados.

Não silencie erros TypeScript apenas com any.

Não remova funcionalidades existentes para fazer a nova implementação funcionar.

Não faça soluções fake/mockadas em produção.

Se faltar uma credencial externa, implemente toda a estrutura normalmente utilizando placeholder seguro e diga exatamente onde eu devo fornecer a credencial.

Ao terminar, me entregue:

text

IMPLEMENTADO

PENDENTE

VARIÁVEIS/SECRETS QUE PRECISO CONFIGURAR

MIGRATIONS CRIADAS

ENDPOINTS CRIADOS

TELAS CRIADAS

TESTES EXECUTADOS

COMO TESTAR A LOJA 1

COMO ATIVAR STRIPE LIVE

O objetivo é deixar o sistema efetivamente utilizável, seguro e preparado para adicionar Loja 2, Loja 3 e outras no futuro.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://livrariacristaglobal.com

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dfc262d1-6dc6-458b-a321-06bc42199114).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
