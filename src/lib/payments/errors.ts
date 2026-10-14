/**
 * Erros de domínio da API central de pagamentos.
 * Mensagens são seguras para retornar ao cliente (nunca contêm segredos).
 */
export type PaymentErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  // Usado somente pelo Checkout V2 (bootstrap por SKU). Não altera o V1.
  | "SKU_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "OUT_OF_STOCK"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "CONFIG_ERROR";

const STATUS_BY_CODE: Record<PaymentErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SKU_NOT_FOUND: 404,
  PRODUCT_INACTIVE: 409,
  OUT_OF_STOCK: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  CONFIG_ERROR: 500,
};

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: PaymentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function toErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof PaymentError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details ?? null } },
    };
  }
  console.error("[payments] unexpected error", error instanceof Error ? error.message : error);
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Internal error while processing the request." } },
  };
}
