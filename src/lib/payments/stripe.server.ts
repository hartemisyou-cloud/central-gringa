import { PaymentError } from "./errors";

/**
 * StripeService — única camada que fala com a API da Stripe.
 * Nenhum outro módulo deve chamar api.stripe.com diretamente.
 *
 * Implementado sobre `fetch` (compatível com o runtime serverless usado pelo
 * backend) + verificação de assinatura de webhook via WebCrypto HMAC-SHA256.
 * Funciona tanto com secret keys quanto com restricted keys (rk_...) que
 * tenham permissão de escrita em PaymentIntents, Refunds e leitura de Charges.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

export type StripeParams = Record<string, unknown>;

function encodeForm(params: StripeParams, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      encodeForm(value as StripeParams, path, out);
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (typeof entry === "object" && entry !== null) {
          encodeForm(entry as StripeParams, `${path}[${index}]`, out);
        } else {
          out.append(`${path}[${index}]`, String(entry));
        }
      });
    } else {
      out.append(path, String(value));
    }
  }
  return out;
}

export interface StripePaymentIntent {
  id: string;
  client_secret?: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  livemode: boolean;
  latest_charge?: string | null;
  payment_method_types?: string[];
  metadata?: Record<string, string>;
  last_payment_error?: { message?: string } | null;
}

export interface StripeRefund {
  id: string;
  status: string;
  amount: number;
  currency: string;
  payment_intent?: string;
}

export interface StripeAccount {
  id: string;
  business_profile?: { name?: string | null } | null;
  country?: string;
  default_currency?: string;
  charges_enabled?: boolean;
}

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  data: { object: Record<string, unknown> };
}

export class StripeService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new PaymentError("CONFIG_ERROR", "Credencial Stripe ausente.");
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params?: StripeParams,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Stripe-Version": STRIPE_VERSION,
    };
    let url = `${STRIPE_API}${path}`;
    let body: string | undefined;

    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = encodeForm(params ?? {}).toString();
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    } else if (params) {
      const query = encodeForm(params).toString();
      if (query) url += `?${query}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }) });
    } catch {
      throw new PaymentError("PROVIDER_ERROR", "Não foi possível contatar o provedor de pagamento.");
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const err = (json["error"] ?? {}) as { message?: string; code?: string; type?: string };
      // Log sanitizado: nunca inclui a chave usada.
      console.error(`[stripe] ${method} ${path} -> ${response.status} ${err.code ?? err.type ?? ""}`);
      throw new PaymentError("PROVIDER_ERROR", err.message ?? "Falha na comunicação com a Stripe.", {
        providerCode: err.code ?? err.type ?? null,
      });
    }
    return json as T;
  }

  retrieveAccount(): Promise<StripeAccount> {
    return this.request<StripeAccount>("GET", "/account");
  }

  createPaymentIntent(
    params: {
      amount: number;
      currency: string;
      metadata: Record<string, string>;
      description?: string;
      receipt_email?: string;
      statement_descriptor_suffix?: string;
      shipping?: {
        name: string;
        phone?: string;
        address: {
          line1: string;
          line2?: string;
          city?: string;
          state?: string;
          postal_code?: string;
          country?: string;
        };
      };
    },
    idempotencyKey: string,
  ): Promise<StripePaymentIntent> {
    return this.request<StripePaymentIntent>(
      "POST",
      "/payment_intents",
      {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        description: params.description,
        receipt_email: params.receipt_email,
        statement_descriptor_suffix: params.statement_descriptor_suffix,
        shipping: params.shipping,
        metadata: params.metadata,
        // Usa os métodos habilitados no dashboard da conta Stripe:
        automatic_payment_methods: { enabled: true },
      },
      idempotencyKey,
    );
  }


  retrievePaymentIntent(id: string): Promise<StripePaymentIntent> {
    return this.request<StripePaymentIntent>("GET", `/payment_intents/${encodeURIComponent(id)}`);
  }

  cancelPaymentIntent(id: string): Promise<StripePaymentIntent> {
    return this.request<StripePaymentIntent>(
      "POST",
      `/payment_intents/${encodeURIComponent(id)}/cancel`,
    );
  }

  refundPayment(
    params: { paymentIntentId: string; amount?: number; reason?: string },
    idempotencyKey: string,
  ): Promise<StripeRefund> {
    return this.request<StripeRefund>(
      "POST",
      "/refunds",
      {
        payment_intent: params.paymentIntentId,
        amount: params.amount,
        ...(params.reason ? { metadata: { reason: params.reason } } : {}),
      },
      idempotencyKey,
    );
  }

  retrieveRefund(id: string): Promise<StripeRefund> {
    return this.request<StripeRefund>("GET", `/refunds/${encodeURIComponent(id)}`);
  }
}

/** Extrai t= e v1= do header Stripe-Signature. */
export function parseStripeSignature(header: string): { timestamp: number; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim());
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifica a assinatura do webhook sobre o corpo RAW (nunca parseado antes).
 * Rejeita eventos fora da janela de tolerância (replay protection).
 */
export async function constructStripeEvent(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<StripeEvent> {
  if (!signatureHeader) {
    throw new PaymentError("UNAUTHORIZED", "Assinatura do webhook ausente.");
  }
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    throw new PaymentError("UNAUTHORIZED", "Assinatura do webhook malformada.");
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new PaymentError("UNAUTHORIZED", "Assinatura do webhook expirada.");
  }
  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  const valid = signatures.some((candidate) => {
    if (candidate.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
  if (!valid) {
    throw new PaymentError("UNAUTHORIZED", "Assinatura do webhook inválida.");
  }
  return JSON.parse(rawBody) as StripeEvent;
}
