import { useCallback, useEffect, useRef } from "react";

import { startPresence, type PresenceEvent, type PresenceHandle } from "@/lib/analytics/presence";

/**
 * Hook de presença em tempo real. Mantém o heartbeat enquanto a página estiver
 * aberta e devolve um `send` para marcar transições (carrinho, checkout, pago).
 */
export function usePresence(options: { state?: PresenceEvent; storeSlug?: string } = {}) {
  const handle = useRef<PresenceHandle | null>(null);
  const state = options.state ?? "SESSION_ACTIVE";
  const storeSlug = options.storeSlug;

  useEffect(() => {
    const started = startPresence({ state, storeSlug });
    handle.current = started;
    return () => {
      started.dispose();
      handle.current = null;
    };
  }, [state, storeSlug]);

  const send = useCallback((event: PresenceEvent) => {
    handle.current?.send(event);
  }, []);

  return { send };
}
