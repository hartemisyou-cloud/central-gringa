import { getRequest } from "@tanstack/react-start/server";

// Domínio estável do projeto publicado. Serve o mesmo build sem depender de
// DNS de domínio customizado nem do gate de login do preview.
const STABLE_PROD_ORIGIN = "https://project--58e066df-edbc-45e6-aad2-2061ff559727.lovable.app";
const STABLE_DEV_ORIGIN = "https://project--58e066df-edbc-45e6-aad2-2061ff559727-dev.lovable.app";

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(url);
}

/** Bases candidatas, em ordem de preferência. */
function apiBaseUrls(): string[] {
  const origin = new URL(getRequest().url).origin;
  const configuredRaw = process.env["PAYMENTS_API_BASE_URL"]?.trim().replace(/\/$/, "");
  // Ignora valores de exemplo/deixados pelo remix do projeto (ex.: PLACEHOLDER_VALUE_TO_BE_REPLACED)
  const configured =
    configuredRaw && /^https?:\/\//i.test(configuredRaw) ? configuredRaw : undefined;

  const candidates: string[] = [];

  if (isLocal(origin)) {
    candidates.push(origin);
    if (configured && isLocal(configured)) candidates.push(configured);
  } else {
    // A API central é este mesmo app: o próprio deploy vem primeiro.
    // O preview `id-preview--*` fica atrás do login da Lovable, então usamos o
    // domínio estável correspondente.
    const isPreview = /^https:\/\/id-preview--/i.test(origin);
    candidates.push(isPreview ? STABLE_DEV_ORIGIN : STABLE_PROD_ORIGIN);
    if (!isPreview) candidates.push(origin);
    if (configured && !isLocal(configured)) candidates.push(configured);
  }

  return [...new Set(candidates)];
}



/**
 * Chama a API central em nome da loja configurada.
 * A credencial (`STORE_API_KEY`, com fallback para `STORE1_API_KEY`) e o slug
 * (`STORE_SLUG`) nunca saem do servidor.
 */
export async function callCentralApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const apiKey = (process.env["STORE_API_KEY"] ?? process.env["STORE1_API_KEY"])?.trim();
  if (!apiKey) throw new Error("Credencial da loja não configurada no servidor.");

  const slug = process.env["STORE_SLUG"]?.trim().toLowerCase() || "livraria-cultura";

  const requestInit: RequestInit = {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-store-api-key": apiKey,
      ...(slug ? { "x-store-slug": slug } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  };

  const bases = apiBaseUrls();
  let lastError: unknown = new Error("Não foi possível concluir a operação.");

  for (const base of bases) {
    let response: Response;
    try {
      response = await fetch(`${base}/api/public/v1${path}`, requestInit);
    } catch (error) {
      lastError = error;
      continue; // base inacessível (DNS/rede) — tenta a próxima
    }

    const payload = (await response.json().catch(() => null)) as
      | { data?: T; error?: { code?: string; message?: string } }
      | null;

    if (response.ok && payload?.data !== undefined) return payload.data;

    lastError = new Error(
      payload?.error?.message ?? "Não foi possível concluir a operação.",
    );

    // Falha de credencial/escopo pode ser específica de um deploy (segredo
    // desatualizado naquela base): vale tentar a próxima base.
    const authFailure =
      response.status === 401 ||
      response.status === 403 ||
      payload?.error?.code === "UNAUTHORIZED" ||
      payload?.error?.code === "FORBIDDEN";
    if (authFailure) continue;

    // Resposta válida da API (erro de negócio) — não adianta tentar outra base.
    if (payload?.error?.message) break;
  }


  throw lastError instanceof Error
    ? lastError
    : new Error("Não foi possível concluir a operação.");

}
