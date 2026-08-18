import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FORBIDDEN_KEYS = [
  "secret",
  "secret_key",
  "sk_",
  "rk_",
  "api_key",
  "apikey",
  "client_secret",
  "webhook_secret",
  "password",
  "token",
];

/** Remove qualquer valor potencialmente sensível antes de persistir/logar. */
export function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.some((needle) => lower.includes(needle))) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string" && /(sk|rk)_(test|live)_[A-Za-z0-9]+/.test(value)) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeMetadata(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function recordAudit(entry: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_id: entry.actorId ?? null,
    actor_email: entry.actorEmail ?? null,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    metadata: sanitizeMetadata(entry.metadata ?? {}) as never,
    ip: entry.ip ?? null,
  });
  if (error) console.error("[audit] failed to record entry", error.message);
}
