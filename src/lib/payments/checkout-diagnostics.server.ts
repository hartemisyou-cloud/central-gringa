import { PaymentError, type PaymentErrorCode } from "./errors";

export type CheckoutFailureStage =
  | "missing_env"
  | "db_unreachable"
  | "no_stripe_integration"
  | "decrypt_failed"
  | "stripe_error"
  | "bad_origin"
  | "rate_limit";

const codes: Record<CheckoutFailureStage, PaymentErrorCode> = {
  missing_env: "CONFIG_ERROR", db_unreachable: "CONFIG_ERROR",
  no_stripe_integration: "CONFIG_ERROR", decrypt_failed: "CONFIG_ERROR",
  stripe_error: "PROVIDER_ERROR", bad_origin: "FORBIDDEN", rate_limit: "RATE_LIMITED",
};

/** Carries an explicit server stage without changing the buyer-facing catch. */
export class CheckoutFailure extends PaymentError {
  constructor(
    readonly stage: CheckoutFailureStage,
    readonly operation: string,
    readonly technicalError?: unknown,
  ) {
    super(codes[stage], `Checkout failed during ${operation}.`, { stage, operation });
  }
}

export function classifyCheckoutFailure(
  error: unknown,
  fallback: CheckoutFailureStage = "db_unreachable",
): CheckoutFailureStage {
  if (error instanceof CheckoutFailure) return error.stage;
  if (error instanceof PaymentError) {
    if (error.code === "RATE_LIMITED") return "rate_limit";
    if (error.code === "PROVIDER_ERROR") return "stripe_error";
  }
  const message = error instanceof Error ? error.message : "";
  if (/Missing (?:Supabase |Stripe )?environment|Vault encryption key not configured/i.test(message)) return "missing_env";
  if (/Stored secret|decrypt/i.test(message) || (error instanceof Error && error.name === "OperationError")) return "decrypt_failed";
  return fallback;
}

/** Error text only: never log requests, headers, bodies, URLs, or error objects. */
export function safeCheckoutError(error: unknown): string {
  const underlying = error instanceof CheckoutFailure ? error.technicalError : error;
  let message = underlying instanceof Error ? underlying.message
    : underlying && typeof underlying === "object" && "message" in underlying && typeof underlying.message === "string"
      ? underlying.message : error instanceof Error ? error.message : "Unknown server error.";
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL/i.test(name) && value && value.length >= 8) {
      message = message.split(value).join("[redacted]");
    }
  }
  return message
    .replace(/\b(?:sk|rk|pk)_(?:test|live)_[^\s'"`,;]+/gi, "[redacted]")
    .replace(/\b(?:whsec_|sb_secret_|sb_publishable_)[^\s'"`,;]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s'"`,;]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bv1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s'"<>]+/gi, "[url redacted]")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 400);
}

const logged = new WeakSet<object>();
export function logCheckoutFailure(
  error: unknown,
  operation: string,
  fallback: CheckoutFailureStage = "db_unreachable",
): CheckoutFailureStage {
  const stage = classifyCheckoutFailure(error, fallback);
  if (error && typeof error === "object") {
    if (logged.has(error)) return stage;
    logged.add(error);
  }
  console.error(JSON.stringify({
    event: "checkout_failure", stage,
    operation: error instanceof CheckoutFailure ? error.operation : operation,
    detail: safeCheckoutError(error),
  }));
  return stage;
}
