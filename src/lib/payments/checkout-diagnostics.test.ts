import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentError } from "./errors";
import { CheckoutFailure, classifyCheckoutFailure, logCheckoutFailure, safeCheckoutError, type CheckoutFailureStage } from "./checkout-diagnostics.server";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("checkout failure classification and redaction", () => {
  it.each<CheckoutFailureStage>(["missing_env", "db_unreachable", "no_stripe_integration", "decrypt_failed", "stripe_error", "bad_origin", "rate_limit"])("preserves the explicit %s stage", stage => {
    expect(classifyCheckoutFailure(new CheckoutFailure(stage, "test.operation"))).toBe(stage);
  });
  it("classifies existing provider, rate, vault and database failures", () => {
    expect(classifyCheckoutFailure(new PaymentError("PROVIDER_ERROR", "Declined"))).toBe("stripe_error");
    expect(classifyCheckoutFailure(new PaymentError("RATE_LIMITED", "Slow down"))).toBe("rate_limit");
    expect(classifyCheckoutFailure(new Error("Missing Supabase environment variable(s): SUPABASE_URL."))).toBe("missing_env");
    expect(classifyCheckoutFailure(new Error("Vault encryption key not configured on the server."))).toBe("missing_env");
    expect(classifyCheckoutFailure(new DOMException("The operation failed", "OperationError"))).toBe("decrypt_failed");
    expect(classifyCheckoutFailure(new Error("fetch failed"), "db_unreachable")).toBe("db_unreachable");
  });
  it("logs exactly one JSON line per propagated failure without secrets or URLs", () => {
    vi.stubEnv("PAYMENTS_ENCRYPTION_KEY", "a-private-encryption-value-for-tests");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new CheckoutFailure("stripe_error", "startPurchase.create_session", new Error("Invalid key sk_test_notARealKey; whsec_notReal; a-private-encryption-value-for-tests\nhttps://example.test/private?token=hidden"));
    logCheckoutFailure(error, "preparePurchase");
    logCheckoutFailure(error, "preparePurchase");
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toMatchObject({ event: "checkout_failure", stage: "stripe_error", operation: "startPurchase.create_session" });
    expect(line).not.toMatch(/sk_test|whsec_|private-encryption|example\.test|token=|\\n/);
  });
  it("redacts credentials embedded in database errors and serialized messages", () => {
    expect(safeCheckoutError({ message: "Bearer eyJabc.def.ghi sb_secret_notReal v1.YWJj.YWJj" })).toBe("Bearer [redacted] [redacted] [redacted]");
  });
});
