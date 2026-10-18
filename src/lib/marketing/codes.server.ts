import { randomInt } from "node:crypto";
import { sql, rows, one, exec } from "@/lib/db/client.server";

/**
 * Marketing codes: a random 8-digit number is the only value that travels in
 * /comprar/{slug}?ref=<code>. The campaign name lives exclusively here and is
 * resolved server-side; it never reaches a URL or any Stripe field.
 */
export interface MarketingCode {
  code: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  active: boolean;
  created_at: string;
}

export interface MarketingCodeInput {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

export const MARKETING_CODE_PATTERN = /^\d{8}$/;

export function generateMarketingCode(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

export async function createMarketingCode(input: MarketingCodeInput): Promise<MarketingCode> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateMarketingCode();
    const { data, error } = await one<MarketingCode>(sql`
      insert into public.marketing_codes (code, utm_source, utm_medium, utm_campaign)
      values (${code}, ${input.utmSource}, ${input.utmMedium}, ${input.utmCampaign})
      on conflict (code) do nothing
      returning code, utm_source, utm_medium, utm_campaign, active, created_at
    `, true);
    if (error) throw new Error(error.message);
    if (data) return data;
  }
  throw new Error("Could not allocate a unique marketing code.");
}

export async function listActiveMarketingCodes(): Promise<MarketingCode[]> {
  const { data, error } = await rows<MarketingCode>(sql`
    select code, utm_source, utm_medium, utm_campaign, active, created_at
    from public.marketing_codes where active = true order by created_at desc
  `);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function deactivateMarketingCode(code: string): Promise<void> {
  const { error } = await exec(sql`update public.marketing_codes set active = false where code = ${code}`);
  if (error) throw new Error(error.message);
}

/** Active code → UTM triple, or null. Unknown/inactive/malformed codes resolve to null. */
export async function resolveMarketingCode(
  code: string,
): Promise<{ utm_source: string; utm_medium: string; utm_campaign: string } | null> {
  if (!MARKETING_CODE_PATTERN.test(code)) return null;
  const { data, error } = await one<{ utm_source: string; utm_medium: string; utm_campaign: string }>(sql`
    select utm_source, utm_medium, utm_campaign from public.marketing_codes
    where code = ${code} and active = true
  `, true);
  if (error) throw new Error(error.message);
  return data;
}
