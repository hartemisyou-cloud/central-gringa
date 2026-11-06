import { sql, one, exec } from "@/lib/db/client.server";
import { decryptSecret } from "./crypto.server";
import { StripeService, type StripeCheckoutSession } from "./stripe.server";

interface RefreshState {
  order_id: string;
  order_status: string;
  provider_payment_id: string | null;
  secret_key_ciphertext: string | null;
}

/**
 * Confirmação pós-pagamento do fluxo de doação (cloaker).
 *
 * Depois que a Stripe completa o pagamento hospedado, ela redireciona o cliente
 * para o success URL enquanto o webhook assinado ainda está em trânsito. Este
 * helper pergunta diretamente à Stripe se a sessão de checkout terminou e
 * espelha no banco as duas mudanças de estado no nível do pedido que o pipeline
 * de webhook faria (PAID + commit de estoque). A linha payments fica
 * propositalmente intocada: o webhook assinado continua sendo o finalizador
 * canônico e emite cada evento (analytics, Meta CAPI, UTMify, e-mail) uma vez
 * só — ele ignora o que já estiver PAID. Nunca lança exceção.
 */
export async function confirmPaidReceiptFromProvider(publicToken: string): Promise<boolean> {
  const { data, error } = await one<RefreshState>(sql`
    select o.id as order_id, o.status as order_status,
      p.provider_payment_id, i.secret_key_ciphertext
    from public.orders o
    left join lateral (
      select provider_payment_id from public.payments
      where order_id = o.id and status in ('REQUIRES_PAYMENT', 'PROCESSING')
      order by attempt desc limit 1
    ) p on true
    left join public.stores s on s.id = o.store_id
    left join public.stripe_integrations i on i.id = s.stripe_integration_id
    where o.public_token = ${publicToken}`, true);
  if (error || !data || data.order_status !== "PAYMENT_PROCESSING") return false;
  const sessionId = data.provider_payment_id ?? "";
  if (!sessionId.startsWith("cs_") || !data.secret_key_ciphertext) return false;

  let secret: string;
  try { secret = await decryptSecret(data.secret_key_ciphertext); } catch { return false; }
  const expectedLive = /^sk_live_[A-Za-z0-9]+$/.test(secret);
  if (!expectedLive && !/^sk_test_[A-Za-z0-9]+$/.test(secret)) return false;

  let session: StripeCheckoutSession;
  try { session = await new StripeService(secret).retrieveCheckoutSession(sessionId); } catch { return false; }
  if (session.status !== "complete" || session.livemode !== expectedLive) return false;

  // Mesmas instruções protegidas aplicadas pelo pipeline de webhook (ver
  // webhooks.server.ts), idempotentes sob chamadas concorrentes.
  await exec(sql`update public.orders set status = 'PAID', paid_at = coalesce(paid_at, ${new Date().toISOString()})
    where id = ${data.order_id} and status not in ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')`);
  await exec(sql`with locked_order as materialized (
      select id, stock_committed, status from public.orders where id = ${data.order_id} for update
    ) select public.commit_order_stock(id) from locked_order where not stock_committed and status = 'PAID'`);
  return true;
}
