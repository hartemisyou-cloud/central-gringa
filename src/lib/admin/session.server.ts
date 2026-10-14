import { useSession } from "@tanstack/react-start/server";
import { PaymentError } from "@/lib/payments/errors";

/**
 * Portão de acesso do painel administrativo.
 * A senha vive apenas no ambiente do servidor (`ADMIN_PANEL_PASSWORD`)
 * e a sessão é um cookie httpOnly cifrado (`ADMIN_SESSION_SECRET`).
 */

export type AdminSession = { unlocked?: boolean; since?: number };

function sessionConfig() {
  const password = process.env["ADMIN_SESSION_SECRET"];
  if (!password || password.length < 32) {
    throw new PaymentError("CONFIG_ERROR", "Admin session not configured on the server.");
  }
  return {
    password,
    name: "admin-gate",
    maxAge: 60 * 60 * 8,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** Comparação em tempo constante sobre digests de tamanho fixo. */
export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env["ADMIN_PANEL_PASSWORD"];
  if (!expected) {
    throw new PaymentError("CONFIG_ERROR", "Admin password not configured on the server.");
  }
  const [a, b] = await Promise.all([digest(input), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function getAdminSession() {
  return useSession<AdminSession>(sessionConfig());
}

export async function isUnlocked(): Promise<boolean> {
  const session = await getAdminSession();
  return session.data.unlocked === true;
}

/** Guarda de segurança usada por TODA operação sensível do painel. */
export async function requireAdmin(): Promise<void> {
  if (!(await isUnlocked())) {
    throw new PaymentError("UNAUTHORIZED", "Admin session expired. Please sign in again.");
  }
}
