/**
 * Meta Pixel (navegador).
 * Recebe SOMENTE o pixel_id público — o Access Token nunca chega aqui.
 * Eventos de navegador: PageView, ViewContent e InitiateCheckout.
 * Purchase NÃO é disparado pelo navegador: ele é enviado exclusivamente
 * pela Conversions API quando orders.status = PAID.
 */

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export interface PixelContent {
  id: string;
  quantity: number;
  item_price: number;
}

export interface CommerceEventInput {
  value: number;
  currency: string;
  contents?: PixelContent[] | undefined;
  contentName?: string | null | undefined;
}

export function initPixel(pixelId: string): void {
  if (typeof window === "undefined" || !pixelId) return;
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      (fbq.queue = fbq.queue ?? []).push(args);
    } as Fbq;
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  const holder = window.fbq as Fbq & { _initialized?: Set<string> };
  const initialized = holder._initialized ?? new Set<string>();
  holder._initialized = initialized;
  if (initialized.has(pixelId)) return;
  initialized.add(pixelId);
  window.fbq("init", pixelId);
}

export function trackPageView(): void {
  window.fbq?.("track", "PageView");
}

/** Monta o payload padrão de e-commerce com dados reais (nunca valores fixos). */
function commercePayload(input: CommerceEventInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    value: input.value,
    currency: input.currency.toUpperCase(),
  };
  const contents = input.contents ?? [];
  if (contents.length > 0) {
    payload["content_ids"] = contents.map((item) => item.id);
    payload["contents"] = contents.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      item_price: item.item_price,
    }));
    payload["content_type"] = "product";
    payload["num_items"] = contents.reduce((total, item) => total + item.quantity, 0);
  }
  if (input.contentName) payload["content_name"] = input.contentName;
  return payload;
}

/** Visualização do checkout, com valor/moeda reais do pedido. */
export function trackViewContent(input: CommerceEventInput): void {
  window.fbq?.("track", "ViewContent", commercePayload(input));
}

/** Intenção real de pagamento (clique em pagar / carteira expressa). */
export function trackInitiateCheckout(input: CommerceEventInput): void {
  window.fbq?.("track", "InitiateCheckout", commercePayload(input));
}
