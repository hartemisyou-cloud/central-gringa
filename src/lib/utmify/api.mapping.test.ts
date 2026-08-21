import { describe, expect, it } from "vitest";
import { buildSalePayload, mapPaymentMethod, type OrderContext } from "./api.server";

function order(overrides: Partial<OrderContext> = {}): OrderContext {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    storeId: "22222222-2222-2222-2222-222222222222",
    orderNumber: "ORD-20260821-ABC123",
    currency: "USD",
    totalCents: 2000,
    status: "PAID",
    createdAt: "2026-08-21T04:00:00.000Z",
    paidAt: "2026-08-21T04:01:02.000Z",
    customerName: "Ana Souza",
    email: "ana@example.com",
    phone: "+5511999999999",
    document: null,
    country: "US",
    paymentMethod: "card",
    items: [{ id: "prod-1", name: "Bíblia de Estudo", quantity: 1, priceInCents: 2000 }],
    ...overrides,
  };
}

const opts = { isTest: false };

describe("mapPaymentMethod", () => {
  it("mapeia card, Apple Pay e Google Pay para credit_card", () => {
    expect(mapPaymentMethod("card")).toBe("credit_card");
    expect(mapPaymentMethod("apple_pay")).toBe("credit_card");
    expect(mapPaymentMethod("google_pay")).toBe("credit_card");
    expect(mapPaymentMethod("link")).toBe("credit_card");
  });
});

describe("buildSalePayload", () => {
  it("Teste 1 — venda de $20 preserva valor e moeda reais", () => {
    const payload = buildSalePayload(order(), {}, opts);
    expect(payload.commission.totalPriceInCents).toBe(2000);
    expect(payload.commission.currency).toBe("USD");
    expect(payload.status).toBe("paid");
    expect(payload.approvedDate).toBe("2026-08-21 04:01:02");
  });

  it("Teste 2 — venda de $100 usa o valor real do pedido", () => {
    const payload = buildSalePayload(
      order({ totalCents: 10000, items: [{ id: "p", name: "Kit", quantity: 1, priceInCents: 10000 }] }),
      {},
      opts,
    );
    expect(payload.commission.totalPriceInCents).toBe(10000);
    expect(payload.products[0]?.priceInCents).toBe(10000);
  });

  it("Teste 5 — UTMs de order_attribution chegam em trackingParameters", () => {
    const payload = buildSalePayload(
      order(),
      {
        utm_source: "facebook",
        utm_medium: "paid",
        utm_campaign: "test_campaign",
        utm_content: "test_ad",
        utm_term: "test_term",
        fbclid: "fb.1.abc",
      },
      opts,
    );
    expect(payload.trackingParameters).toMatchObject({
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "test_campaign",
      utm_content: "test_ad",
      utm_term: "test_term",
      fbclid: "fb.1.abc",
    });
  });

  it("não inventa UTMs quando não há atribuição", () => {
    const payload = buildSalePayload(order(), {}, opts);
    expect(payload.trackingParameters['utm_source']).toBeNull();
    expect(payload.trackingParameters['utm_campaign']).toBeNull();
  });

  it("não vaza dados sensíveis e preserva moedas não-BRL", () => {
    const payload = buildSalePayload(order({ currency: "EUR" }), {}, opts);
    const serialized = JSON.stringify(payload);
    expect(payload.commission.currency).toBe("EUR");
    expect(serialized).not.toMatch(/client_secret|cvc|cvv|sk_live|x-api-token/i);
  });
});
