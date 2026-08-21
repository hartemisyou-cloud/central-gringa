import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ATTRIBUTION_KEYS,
  hasAttribution,
  normalizeAttribution,
  type Attribution,
} from "./attribution";

/**
 * Persiste a atribuição de um pedido (1 pedido -> 1 linha).
 * Idempotente: reprocessar o mesmo order_id atualiza a linha existente,
 * nunca cria uma segunda. Sem atribuição, nenhuma linha é criada.
 * Nunca lança: atribuição é telemetria e não pode derrubar um pedido.
 */
export async function saveOrderAttribution(
  orderId: string,
  input: Attribution | undefined | null,
): Promise<Attribution> {
  const attribution = normalizeAttribution(input);
  if (!hasAttribution(attribution)) return attribution;

  try {
    const row = { order_id: orderId, ...attribution };
    await supabaseAdmin.from("order_attribution").upsert(row as never, { onConflict: "order_id" });


    // Liga a sessão de analytics existente ao pedido (sem criar sessões novas).
    const sessionId = attribution.checkout_session_id;
    const anonymousId = attribution.anonymous_session_id;
    if (sessionId || anonymousId) {
      const query = supabaseAdmin
        .from("checkout_sessions")
        .update({ order_id: orderId })
        .is("order_id", null);
      await (sessionId
        ? query.eq("checkout_session_id", sessionId)
        : query.eq("anonymous_session_id", anonymousId!));
    }
  } catch {
    // silencioso por design
  }
  return attribution;
}

/** Recupera a atribuição persistida de um pedido. Retorna {} se não houver. */
export async function getOrderAttribution(orderId: string): Promise<Attribution> {
  const { data } = await supabaseAdmin
    .from("order_attribution")
    .select(ATTRIBUTION_KEYS.join(", "))
    .eq("order_id", orderId)
    .maybeSingle();
  return normalizeAttribution(data as Attribution | null);
}
