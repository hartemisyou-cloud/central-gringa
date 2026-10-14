import { PaymentError } from "./errors";

/**
 * Abstração de frete.
 *
 * NÃO existe integração real com transportadora neste momento.
 * A implementação padrão (`TableRateShippingService`) é uma tabela configurável
 * por região/peso, definida por variáveis de ambiente — NÃO é uma cotação real.
 *
 * Para plugar um provedor real (Correios, Melhor Envio, Frenet...),
 * implemente `ShippingService` e registre em `resolveShippingService()`.
 * Veja docs/payments/store-integration.md.
 */

export interface ShippingQuoteInput {
  postalCode: string;
  totalWeightGrams: number;
  subtotalCents: number;
  currency: string;
}

export interface ShippingOption {
  id: string;
  label: string;
  amountCents: number;
  estimatedDays: number;
  provider: string;
}

export interface ShippingService {
  readonly provider: string;
  quote(input: ShippingQuoteInput): Promise<ShippingOption[]>;
}

export function normalizePostalCode(postalCode: string): string {
  const digits = (postalCode ?? "").replace(/\D/g, "");
  if (digits.length !== 8) {
    throw new PaymentError("INVALID_INPUT", "Invalid postal code.");
  }
  return digits;
}

/** Região aproximada pelo primeiro dígito do CEP (usada apenas pela tabela configurável). */
export function brRegionFromPostalCode(postalCode: string): "SUDESTE" | "SUL" | "CENTRO_OESTE" | "NORDESTE" | "NORTE" {
  const first = Number(normalizePostalCode(postalCode)[0]);
  if (first <= 1) return "SUDESTE";
  if (first === 2 || first === 3) return "SUDESTE";
  if (first === 4 || first === 5) return "NORDESTE";
  if (first === 6) return "NORTE";
  if (first === 7) return "CENTRO_OESTE";
  if (first === 8 || first === 9) return "SUL";
  return "SUDESTE";
}

export interface TableRateConfig {
  baseCents: number;
  perKgCents: number;
  regionSurchargeCents: Record<string, number>;
  freeAboveCents: number | null;
  expressMultiplier: number;
}

export const DEFAULT_TABLE_RATE: TableRateConfig = {
  baseCents: 1990,
  perKgCents: 900,
  regionSurchargeCents: {
    SUDESTE: 0,
    SUL: 500,
    CENTRO_OESTE: 900,
    NORDESTE: 1200,
    NORTE: 1900,
  },
  freeAboveCents: 29900,
  expressMultiplier: 1.8,
};

export class TableRateShippingService implements ShippingService {
  readonly provider = "TABLE_RATE";
  private readonly config: TableRateConfig;

  constructor(config: TableRateConfig = DEFAULT_TABLE_RATE) {
    this.config = config;
  }

  async quote(input: ShippingQuoteInput): Promise<ShippingOption[]> {
    const region = brRegionFromPostalCode(input.postalCode);
    const kg = Math.max(1, Math.ceil(input.totalWeightGrams / 1000));
    const surcharge = this.config.regionSurchargeCents[region] ?? 0;
    let standard = this.config.baseCents + (kg - 1) * this.config.perKgCents + surcharge;
    const free =
      this.config.freeAboveCents !== null && input.subtotalCents >= this.config.freeAboveCents;
    if (free) standard = 0;

    const express = Math.round(
      (this.config.baseCents + (kg - 1) * this.config.perKgCents + surcharge) *
        this.config.expressMultiplier,
    );

    return [
      {
        id: "standard",
        label: free ? "Standard shipping (free)" : "Standard shipping",
        amountCents: standard,
        estimatedDays: region === "SUDESTE" ? 4 : 8,
        provider: this.provider,
      },
      {
        id: "express",
        label: "Entrega expressa",
        amountCents: express,
        estimatedDays: region === "SUDESTE" ? 2 : 4,
        provider: this.provider,
      },
    ];
  }
}

export function resolveShippingService(): ShippingService {
  // Ponto de extensão: quando um provedor real for configurado, retorne-o aqui.
  return new TableRateShippingService();
}
