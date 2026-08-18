import { getRequest } from "@tanstack/react-start/server";

function apiBaseUrl(): string {
  const origin = new URL(getRequest().url).origin;
  const configured = process.env["PAYMENTS_API_BASE_URL"]?.trim().replace(/\/$/, "");

  // Só usamos a base configurada se ela fizer sentido para o ambiente atual.
  // Um valor de desenvolvimento (localhost) em produção quebraria o site inteiro.
  if (configured) {
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(configured);
    const originIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(origin);
    if (!isLocal || originIsLocal) return configured;
  }

  return origin;
}

/**
 * Chama a API central em nome da Loja 1.
 * A credencial da loja (`STORE1_API_KEY`) nunca sai do servidor.
 */
export async function callCentralApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const apiKey = process.env["STORE1_API_KEY"];
  if (!apiKey) throw new Error("Credencial da loja não configurada no servidor.");

  const response = await fetch(`${apiBaseUrl()}/api/public/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-store-api-key": apiKey,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string } }
    | null;

  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error?.message ?? "Não foi possível concluir a operação.");
  }
  return payload.data;
}
