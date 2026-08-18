import { PaymentError } from "./errors";

/**
 * Cofre de segredos da aplicação (equivalente ao AWS Secrets Manager nesta
 * infraestrutura). A chave mestra vive apenas no ambiente do servidor
 * (`PAYMENTS_ENCRYPTION_KEY`) e nunca é enviada ao browser.
 *
 * Segredos Stripe são guardados no banco SOMENTE cifrados (AES-256-GCM).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function masterKey(): Promise<CryptoKey> {
  const raw = process.env["PAYMENTS_ENCRYPTION_KEY"];
  if (!raw || raw.length < 32) {
    throw new PaymentError(
      "CONFIG_ERROR",
      "Chave de criptografia do cofre não configurada no servidor.",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)),
  );
  return `v1.${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [version, ivPart, cipherPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !cipherPart) {
    throw new PaymentError("CONFIG_ERROR", "Segredo armazenado em formato inválido.");
  }
  const key = await masterKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivPart) },
    key,
    fromBase64(cipherPart),
  );
  return decoder.decode(plain);
}

/** Mascara uma credencial para exibição no painel: ••••••••9AbC */
export function maskSecret(value: string): string {
  const last4 = value.slice(-4);
  return `${"•".repeat(12)}${last4}`;
}

export function lastFour(value: string): string {
  return value.slice(-4);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (evita timing attacks em credenciais). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";

export function randomToken(length = 40): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Gera a credencial da loja: prefixo público + segredo aleatório. */
export function generateStoreApiKey(environment: "test" | "live"): {
  keyId: string;
  secret: string;
  fullKey: string;
  prefix: string;
} {
  const keyId = `sk_${environment}_${randomToken(12)}`;
  const secret = randomToken(48);
  return { keyId, secret, fullKey: `${keyId}.${secret}`, prefix: keyId.slice(0, 14) };
}
