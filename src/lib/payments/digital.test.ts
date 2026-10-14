import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { buildTotals, priceItems, type PriceableProduct } from "./pricing";
import { HHB_PRODUCTS, HHB_WORKS, worksForSkus } from "@/lib/catalog/hhb";
import { deliverableWorks } from "./fulfillment.server";
import { shouldReprocess } from "./webhooks.server";

const asProduct = (p: (typeof HHB_PRODUCTS)[number]): PriceableProduct => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  price_cents: p.priceCents,
  currency: "USD",
  stock: 1000000,
  reserved_stock: 0,
  active: true,
  weight_grams: 0,
});

describe("Hope Human Books catalog", () => {
  it("has the 11 expected prices", () => {
    expect(HHB_PRODUCTS.map((p) => p.priceCents / 100)).toEqual([5, 10, 15, 20, 30, 50, 75, 100, 150, 250, 500]);
  });
  it("maps every bundle member to a real file", () => {
    const ids = new Set(HHB_WORKS.map((w) => w.workId));
    for (const p of HHB_PRODUCTS) for (const id of p.workIds) expect(ids.has(id)).toBe(true);
    expect(HHB_PRODUCTS.find((p) => p.sku === "HHB-COL-250")!.workIds).toHaveLength(6);
    expect(HHB_PRODUCTS.find((p) => p.sku === "HHB-LIB-500")!.workIds).toHaveLength(10);
  });
  it("dedupes overlapping bundle works", () => {
    expect(worksForSkus(["HHB-COL-250", "HHB-EB-100", "HHB-LIB-500"])).toHaveLength(10);
  });
});

describe("digital order pricing", () => {
  it("prices server-side with zero weight and no shipping", () => {
    const products = HHB_PRODUCTS.map(asProduct);
    const priced = priceItems(
      [
        { productId: products[0]!.id, quantity: 1 },
        { productId: products[9]!.id, quantity: 1 },
      ],
      products,
    );
    expect(priced.totalWeightGrams).toBe(0);
    const totals = buildTotals({ ...priced, shippingCents: 0 });
    expect(totals.totalCents).toBe(25500);
    expect(totals.currency).toBe("USD");
  });
});

describe("paid fulfillment gating", () => {
  it("delivers nothing until PAID", () => {
    for (const s of ["PENDING_PAYMENT", "PAYMENT_PROCESSING", "PAYMENT_FAILED", "CANCELLED", "REFUNDED"]) {
      expect(deliverableWorks(s, ["HHB-LIB-500"])).toEqual([]);
    }
  });
  it("delivers exactly the bundle's works when PAID", () => {
    expect(deliverableWorks("PAID", ["HHB-COL-250"]).map((w) => w.workId).sort()).toEqual(
      HHB_PRODUCTS.find((p) => p.sku === "HHB-COL-250")!.workIds.slice().sort(),
    );
  });
});

describe("webhook retry decision", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("retries failed events", () => {
    expect(shouldReprocess({ processing_status: "FAILED", received_at: "2026-10-14T11:59:59Z" }, now)).toBe(true);
  });
  it("skips processed duplicates", () => {
    expect(shouldReprocess({ processing_status: "PROCESSED", received_at: "2026-10-14T11:00:00Z" }, now)).toBe(false);
  });
  it("retries only stuck in-flight events", () => {
    expect(shouldReprocess({ processing_status: "RECEIVED", received_at: "2026-10-14T11:59:30Z" }, now)).toBe(false);
    expect(shouldReprocess({ processing_status: "RECEIVED", received_at: "2026-10-14T11:50:00Z" }, now)).toBe(true);
  });
});
