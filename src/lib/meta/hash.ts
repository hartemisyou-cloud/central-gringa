/**
 * Normalização + hashing SHA-256 exigidos pela Meta para Advanced Matching.
 * Nenhum dado pessoal é enviado em texto puro nem registrado em log.
 */

const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** email: minúsculo, sem espaços. */
export async function hashEmail(value: string | null | undefined): Promise<string | undefined> {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return undefined;
  return sha256(normalized);
}

/** telefone: somente dígitos, com código do país quando disponível. */
export async function hashPhone(
  value: string | null | undefined,
  defaultCountryCode = "55",
): Promise<string | undefined> {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return undefined;
  const full = digits.length <= 11 ? `${defaultCountryCode}${digits}` : digits;
  return sha256(full);
}

/** nomes: minúsculo, sem acento e sem pontuação. */
export async function hashName(value: string | null | undefined): Promise<string | undefined> {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
  if (!normalized) return undefined;
  return sha256(normalized);
}

/** CEP/ZIP: somente dígitos (ou minúsculo alfanumérico), sem espaços. */
export async function hashZip(value: string | null | undefined): Promise<string | undefined> {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return undefined;
  return sha256(normalized);
}

/** País: código ISO-2 minúsculo. */
export async function hashCountry(value: string | null | undefined): Promise<string | undefined> {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return undefined;
  return sha256(normalized);
}
