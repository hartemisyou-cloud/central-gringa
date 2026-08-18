export function formatMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  PAYMENT_PROCESSING: "Pagamento em processamento",
  PAID: "Pagamento confirmado",
  PAYMENT_FAILED: "Pagamento recusado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reembolsado parcialmente",
};
