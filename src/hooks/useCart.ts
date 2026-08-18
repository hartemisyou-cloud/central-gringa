import { useCallback, useEffect, useState } from "react";

export interface CartLine {
  productId: string;
  quantity: number;
}

const STORAGE_KEY = "loja1.cart.v1";

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l?.productId && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLines(read());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const current = read();
      const next = current.filter((line) => line.productId !== productId);
      if (quantity > 0) next.push({ productId, quantity: Math.min(quantity, 20) });
      persist(next);
    },
    [persist],
  );

  const add = useCallback(
    (productId: string, quantity = 1) => {
      const current = read();
      const existing = current.find((line) => line.productId === productId);
      setQuantity(productId, Math.min((existing?.quantity ?? 0) + quantity, 20));
    },
    [setQuantity],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { lines, hydrated, add, setQuantity, clear };
}
