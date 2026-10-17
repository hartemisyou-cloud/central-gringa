import { describe, expect, it } from "vitest";
import { HHB_STORE_ID } from "@/lib/catalog/hhb";
import { buildEbookCheckoutSessionParams, checkoutIdempotencyKey, validateEbookCheckoutSession } from "./checkout-session.server";
import { purchaseEntryProduct } from "./purchase-entry";

function fixture() {
  const p = purchaseEntryProduct("the-adventures-of-tom-sawyer")!;
  return {
    order: { id: "order-123", store_id: HHB_STORE_ID, order_number: "ORD-20261016-BOOK20", public_token: "public-token", environment: "test" as const, customer_id: null, total_cents: 2199, currency: "USD" },
    items: [{ product_id: p.id, product_name: p.name, sku: p.sku, quantity: 1, unit_price_cents: 2199, total_cents: 2199 }],
    products: [{ id: p.id, category: p.category, weight_grams: 0 }],
    slug: p.slug,
    origin: "https://hopehumanbooks.com",
    createdAt: "2026-10-16T12:00:00.999Z",
  };
}

describe("hosted digital checkout parameter builder", () => {
  it("uses the exact database snapshot, visible product identity, receipt and cancel URLs", () => {
    const params = buildEbookCheckoutSessionParams(fixture());
    expect(params).toEqual({
      mode: "payment", submit_type: "pay", success_url: "https://hopehumanbooks.com/order/public-token",
      cancel_url: "https://hopehumanbooks.com/comprar/the-adventures-of-tom-sawyer",
      expires_at: Math.floor(Date.parse("2026-10-16T12:00:00.999Z") / 1000) + 1860,
      metadata: expect.any(Object),
      payment_intent_data: { description: "Order ORD-20261016-BOOK20", metadata: expect.any(Object) },
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 2199, product_data: {
        name: "The Adventures of Tom Sawyer — Mark Twain", description: "Order ORD-20261016-BOOK20 · Digital delivery, no shipping",
      } } }],
    });
    expect(params).not.toHaveProperty("customer_email");
    expect(params).not.toHaveProperty("customer");
    expect(params).not.toHaveProperty("client_reference_id");
    expect(params).not.toHaveProperty("shipping_address_collection");
    expect(params).not.toHaveProperty("billing_address_collection");
  });
  it("sends exactly the same operational allowlist on the Session and PaymentIntent", () => {
    const input = fixture();
    Object.assign(input.order, { campaign: "ignored", referrer: "ignored", utm_source: "ignored" });
    Object.assign(input.items[0]!, { tracking: "ignored", foundation: "ignored" });
    const params = buildEbookCheckoutSessionParams(input);
    expect(params.metadata).toEqual({
      environment: "test", store_id: HHB_STORE_ID, order_id: "order-123", order_number: "ORD-20261016-BOOK20",
      item_count: "1", product_type: "ebook", delivery_type: "digital", sku: "HHB-EB-020",
      product_name: "The Adventures of Tom Sawyer — Mark Twain", quantity: "1", category: "ebook",
    });
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(JSON.stringify(params)).not.toMatch(/via|hhf|foundation|campaign|utm_|referrer|tracking/);
  });
  it("changes only the success URL when the Foundation return destination is requested", () => {
    const input = fixture();
    const base = buildEbookCheckoutSessionParams(input);
    const routed = buildEbookCheckoutSessionParams({ ...input, successUrl: "https://www.hopehumanfoundation.org/thank-you?amount=22" });
    expect(routed.success_url).toBe("https://www.hopehumanfoundation.org/thank-you?amount=22");
    expect({ ...routed, success_url: null }).toEqual({ ...base, success_url: null });
  });
    it("presents Foundation-origin sessions with the ticket value only while keeping ebook records", () => {
    const input = fixture();
    Object.assign(input.order, { total_cents: 3000, order_number: "ORD-20261016-BOOK30" });
    Object.assign(input.items[0]!, { unit_price_cents: 3000, total_cents: 3000 });
    const base = buildEbookCheckoutSessionParams(input);
    const routed = buildEbookCheckoutSessionParams({ ...input, hhf: true, successUrl: "https://www.hopehumanfoundation.org/thank-you?amount=30" });
    const routedData = routed.line_items[0]!.price_data.product_data;
    const baseData = base.line_items[0]!.price_data.product_data;
    expect(routedData.name).toBe("$30");
    expect(routedData.description).toBeUndefined();
    expect(routed.success_url).toBe("https://www.hopehumanfoundation.org/thank-you?amount=30");
    // Records unchanged vs the non-hhf mirror; ebook identity stays in the record.
    expect(routed.metadata).toEqual(base.metadata);
    expect(routed.payment_intent_data.metadata).toEqual(routed.metadata);
    expect(routed.payment_intent_data.description).toBe(base.payment_intent_data.description);
    expect(routed.metadata).toMatchObject({ product_name: "The Adventures of Tom Sawyer — Mark Twain", sku: "HHB-EB-020", category: "ebook" });
    // Non-hhf mirror keeps the published visible identity.
    expect(baseData.name).toBe("The Adventures of Tom Sawyer — Mark Twain");
    expect(baseData.description).toBe("Order ORD-20261016-BOOK30 · Digital delivery, no shipping");
  });
  it.each([
    "https://example.com/thank-you?amount=22",
    "http://www.hopehumanfoundation.org/thank-you?amount=22",
    "https://www.hopehumanfoundation.org/thank-you",
    "https://www.hopehumanfoundation.org/thank-you?amount=0",
    "https://www.hopehumanfoundation.org/thank-you?amount=22&extra=1",
  ])("rejects invalid return destination %s", (successUrl) => {
    expect(() => buildEbookCheckoutSessionParams({ ...fixture(), successUrl })).toThrow();
  });
  it("keeps the request-derived origin and stable creation-time expiry", () => {
    const input = { ...fixture(), origin: "https://preview.example.test", createdAt: new Date("2026-10-16T12:00:00Z") };
    expect(buildEbookCheckoutSessionParams(input).success_url).toBe("https://preview.example.test/order/public-token");
    expect(buildEbookCheckoutSessionParams(input).expires_at).toBe(1792153860);
  });
  it("uses one stable checkout key per persisted order attempt", () => {
    expect(checkoutIdempotencyKey("order-123", 1)).toBe("checkout:create:order-123:1");
    expect(checkoutIdempotencyKey("order-123", 2)).toBe("checkout:create:order-123:2");
    expect(() => checkoutIdempotencyKey("order-123", 0)).toThrow();
  });
  it.each(["quantity", "price", "currency", "product", "digital", "origin"])("rejects invalid %s instead of creating a differently scoped Session", (kind) => {
    const input = fixture();
    if (kind === "quantity") input.items[0]!.quantity = 2;
    if (kind === "price") input.order.total_cents = 1;
    if (kind === "currency") input.order.currency = "BRL";
    if (kind === "product") input.slug = "unknown";
    if (kind === "digital") input.products[0]!.weight_grams = 100;
    if (kind === "origin") input.origin = "https://hopehumanbooks.com/path?via=hhf";
    expect(() => buildEbookCheckoutSessionParams(input)).toThrow();
  });
  it("checks the full operational binding and Stripe destination before redirect", () => {
    const input = fixture();
    const metadata = buildEbookCheckoutSessionParams(input).metadata;
    const session = { id: "cs_test_Fixture", status: "open", mode: "payment", livemode: false, amount_total: 2199, currency: "usd", metadata, url: "https://checkout.stripe.com/c/pay/cs_test_Fixture" };
    expect(validateEbookCheckoutSession(session, input.order, metadata)).toBe(session.url);
    expect(() => validateEbookCheckoutSession({ ...session, metadata: { ...metadata, campaign: "unexpected" } }, input.order, metadata)).toThrow();
    expect(() => validateEbookCheckoutSession({ ...session, livemode: true }, input.order, metadata)).toThrow();
    expect(() => validateEbookCheckoutSession({ ...session, url: "https://checkout.stripe.com.evil.example/" }, input.order, metadata)).toThrow();
  });
});
