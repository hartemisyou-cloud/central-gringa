/**
 * Meta Pixel (navegador).
 * Recebe SOMENTE o pixel_id público — o Access Token nunca chega aqui.
 * Todos os eventos usam valor/moeda reais do pedido; nada é fixo.
 */

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export function initPixel(pixelId: string): void {
  if (typeof window === "undefined" || !pixelId) return;
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      // eslint-disable-next-line prefer-spread
      (fbq.queue = fbq.queue ?? []).push(args);
    } as Fbq;
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  const existing = (window.fbq as Fbq & { _initialized?: Set<string> })._initialized;
  const initialized = existing ?? new Set<string>();
  (window.fbq as Fbq & { _initialized?: Set<string> })._initialized = initialized;
  if (initialized.has(pixelId)) return;
  initialized.add(pixelId);
  window.fbq("init", pixelId);
}

export function trackPageView(): void {
  window.fbq?.("track", "PageView");
}

export function trackInitiateCheckout(input: { value: number; currency: string }): void {
  window.fbq?.("track", "InitiateCheckout", {
    value: input.value,
    currency: input.currency.toUpperCase(),
  });
}

/**
 * Purchase do navegador.
 * `eventID` é SEMPRE o order_id — idêntico ao event_id enviado pela CAPI,
 * o que permite a deduplicação na Meta.
 */
export function trackPurchase(input: {
  orderId: string;
  value: number;
  currency: string;
  contents?: Array<{ id: string; quantity: number; item_price: number }>;
}): void {
  const payload: Record<string, unknown> = {
    value: input.value,
    currency: input.currency.toUpperCase(),
  };
  if (input.contents && input.contents.length > 0) {
    payload["contents"] = input.contents;
    payload["content_type"] = "product";
  }
  window.fbq?.("track", "Purchase", payload, { eventID: input.orderId });
}
