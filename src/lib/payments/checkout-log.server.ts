import { PaymentError, type PaymentErrorCode } from "./errors";

export type CheckoutFailureStage = "missing_env" | "db_unreachable" | "no_stripe_integration" | "decrypt_failed" | "blob_error" | "stripe_error";
const codes: Record<CheckoutFailureStage, PaymentErrorCode> = {
  missing_env: "CONFIG_ERROR", db_unreachable: "CONFIG_ERROR", no_stripe_integration: "CONFIG_ERROR",
  decrypt_failed: "CONFIG_ERROR", blob_error: "CONFIG_ERROR", stripe_error: "PROVIDER_ERROR",
};

/** Keep existing public messages/statuses while retaining a private diagnostic cause. */
export class CheckoutFailure extends PaymentError {
  constructor(
    readonly stage: CheckoutFailureStage,
    readonly operation: string,
    readonly technicalError?: unknown,
    options?: { code?: PaymentErrorCode; message?: string },
  ) {
    super(options?.code ?? codes[stage], options?.message ?? `Checkout failed during ${operation}.`,
      technicalError instanceof PaymentError ? technicalError.details : undefined);
  }
}

export function classifyCheckoutFailure(error: unknown, fallback: CheckoutFailureStage = "db_unreachable"): CheckoutFailureStage {
  if (error instanceof CheckoutFailure) return error.stage;
  if (error instanceof PaymentError && error.code === "PROVIDER_ERROR") return "stripe_error";
  const message = error instanceof Error ? error.message : "";
  if (/DATABASE_URL.*(?:required|must|Invalid)|Vault encryption key not configured/i.test(message)) return "missing_env";
  if (/Stored secret|decrypt/i.test(message) || (error instanceof Error && error.name === "OperationError")) return "decrypt_failed";
  return fallback;
}

export function safeCheckoutError(error: unknown): string {
  const inner = error instanceof CheckoutFailure ? error.technicalError : error;
  let message = inner instanceof Error ? inner.message
    : inner && typeof inner === "object" && "message" in inner && typeof inner.message === "string"
      ? inner.message : error instanceof Error ? error.message : "Unknown server error.";
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL/i.test(name) && value && value.length >= 8) message = message.split(value).join("[redacted]");
  }
  return message
    .replace(/\b(?:sk|rk|pk)_(?:test|live)_[^\s'"`,;]+/gi, "[redacted]")
    .replace(/\b(?:whsec_|vercel_blob_rw_|sb_secret_)[^\s'"`,;]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s'"`,;]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bv1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g, "[redacted]")
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s'"<>]+/gi, "[url redacted]")
    .replace(/[\r\n\t]/g, " ").slice(0, 400);
}

const logged = new WeakSet<object>();
export function logCheckoutFailure(error: unknown, operation: string, fallback: CheckoutFailureStage = "db_unreachable"): CheckoutFailureStage {
  const stage = classifyCheckoutFailure(error, fallback);
  if (error && typeof error === "object") {
    if (logged.has(error)) return stage;
    logged.add(error);
  }
  console.error(JSON.stringify({ event: "checkout_failure", stage,
    operation: error instanceof CheckoutFailure ? error.operation : operation, detail: safeCheckoutError(error) }));
  return stage;
}
