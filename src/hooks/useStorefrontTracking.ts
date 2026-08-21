import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { getStorefrontTracking } from "@/lib/storefront-tracking.functions";
import { captureAttribution } from "@/lib/tracking/attribution-client";
import {
  initPixel,
  trackAddToCart,
  trackInitiateCheckout,
  trackPageView,
  trackViewContent,
  type CommerceEventInput,
} from "@/lib/meta/pixel";

/**
 * Tracking da vitrine (Meta Pixel) + captura de atribuição para a UTMify.
 * O Purchase continua sendo enviado só pela Conversions API quando o pedido
 * fica PAID — nada de compra é disparado pelo navegador.
 */
export function useStorefrontTracking() {
  const tracking = useQuery({
    queryKey: ["storefront", "tracking"],
    queryFn: () => getStorefrontTracking(),
    staleTime: 5 * 60 * 1000,
  });
  const pixelId = tracking.data?.pixelId ?? null;
  const ready = useRef(false);

  useEffect(() => {
    captureAttribution();
  }, []);

  useEffect(() => {
    if (!pixelId || ready.current) return;
    ready.current = true;
    initPixel(pixelId);
    trackPageView();
  }, [pixelId]);

  const viewContent = useCallback(
    (input: CommerceEventInput) => {
      if (pixelId) trackViewContent(input);
    },
    [pixelId],
  );

  const addToCart = useCallback(
    (input: CommerceEventInput) => {
      if (pixelId) trackAddToCart(input);
    },
    [pixelId],
  );

  const initiateCheckout = useCallback(
    (input: CommerceEventInput) => {
      if (pixelId) trackInitiateCheckout(input);
    },
    [pixelId],
  );

  return { pixelId, viewContent, addToCart, initiateCheckout };
}
