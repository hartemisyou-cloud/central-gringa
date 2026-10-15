import { sql, one, exec } from "@/lib/db/client.server";
import type { Row } from "@/lib/db/types";
import {
  declineCategory,
  SERVER_ONLY_EVENTS,
  type AnalyticsEventType,
  type IngestPayload,
} from "./schema";

/**
 * Camada de ingestão de analytics.
 * Regras invioláveis:
 *  - nunca armazena PAN, CVC, client_secret, credenciais de wallet/Link ou chaves;
 *  - falha de analytics NUNCA propaga erro para o fluxo de pagamento;
 *  - dedupe por `event_id` (índice UNIQUE) — evento repetido não conta duas vezes.
 */

export interface ClientContext {
  userAgent: string | null;
  country: string | null;
  ip?: string | null;
}

export function parseUserAgent(ua: string | null): {
  browser: string | null;
  deviceType: string | null;
  operatingSystem: string | null;
} {
  if (!ua) return { browser: null, deviceType: null, operatingSystem: null };
  const s = ua.toLowerCase();

  const browser = s.includes("edg/")
    ? "Edge"
    : s.includes("opr/") || s.includes("opera")
      ? "Opera"
      : s.includes("chrome") || s.includes("crios")
        ? "Chrome"
        : s.includes("firefox") || s.includes("fxios")
          ? "Firefox"
          : s.includes("safari")
            ? "Safari"
            : "Other";

  const operatingSystem =
    s.includes("iphone") || s.includes("ipad") || s.includes("ios")
      ? "iOS"
      : s.includes("android")
        ? "Android"
        : s.includes("mac os")
          ? "macOS"
          : s.includes("windows")
            ? "Windows"
            : s.includes("linux")
              ? "Linux"
              : "Other";

  const deviceType =
    s.includes("ipad") || (s.includes("android") && !s.includes("mobile"))
      ? "tablet"
      : s.includes("mobi") || s.includes("iphone") || s.includes("android")
        ? "mobile"
        : "desktop";

  return { browser, deviceType, operatingSystem };
}

function safeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const blocked = /(card|pan|cvc|cvv|secret|token|password|credential|number)/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (blocked.test(key)) continue;
    if (typeof value === "string" && value.length > 120) continue;
    out[key] = value;
  }
  return out;
}

async function resolveScope(payload: IngestPayload) {
  if (payload.publicToken) {
    const { data: order } = await one<Row<"orders">>(
      sql`SELECT id, store_id, total_cents, currency, public_token FROM orders WHERE public_token = ${payload.publicToken}`,
      true,
    );
    if (order) {
      const { data: store } = await one<Row<"stores">>(
        sql`SELECT id, stripe_integration_id FROM stores WHERE id = ${order.store_id}`,
        true,
      );
      return {
        storeId: order.store_id,
        integrationId: store?.stripe_integration_id ?? null,
        orderId: order.id,
        publicToken: order.public_token,
        amountCents: order.total_cents,
        currency: order.currency,
      };
    }
  }
  if (payload.storeSlug) {
    const { data: store } = await one<Row<"stores">>(
      sql`SELECT id, currency, stripe_integration_id FROM stores WHERE slug = ${payload.storeSlug.toLowerCase()}`,
      true,
    );
    if (store) {
      return {
        storeId: store.id,
        integrationId: store.stripe_integration_id ?? null,
        orderId: null,
        publicToken: null,
        amountCents: null,
        currency: store.currency,
      };
    }
  }
  return {
    storeId: null,
    integrationId: null,
    orderId: null,
    publicToken: null,
    amountCents: null,
    currency: null,
  };
}

const SESSION_COLUMNS = [
  "checkout_session_id",
  "anonymous_session_id",
  "store_id",
  "integration_id",
  "order_id",
  "public_token",
  "currency",
  "amount_cents",
  "country",
  "browser",
  "device_type",
  "operating_system",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "last_seen_at",
  "viewed_at",
  "started_at",
  "attempted_at",
  "status",
] as const;

const STATUS_RANK: Record<string, number> = { VIEWED: 0, STARTED: 1, ATTEMPTED: 2, SUCCEEDED: 3 };

/** Ingestão de eventos vindos do checkout (UX). Idempotente por event_id. */
export async function ingestClientEvents(payload: IngestPayload, ctx: ClientContext) {
  const scope = await resolveScope(payload);
  const ua = parseUserAgent(ctx.userAgent);
  const now = new Date().toISOString();

  const rows = payload.events
    .filter((event) => !SERVER_ONLY_EVENTS.has(event.type))
    .map((event) => ({
      event_id: event.eventId,
      event_type: event.type,
      occurred_at: event.occurredAt ?? now,
      source: "client",
      store_id: scope.storeId,
      integration_id: scope.integrationId,
      order_id: scope.orderId,
      public_token: scope.publicToken,
      payment_method: event.paymentMethod ?? null,
      currency: scope.currency,
      amount_cents: scope.amountCents,
      country: ctx.country,
      browser: ua.browser,
      device_type: ua.deviceType,
      operating_system: ua.operatingSystem,
      referrer: payload.referrer ?? null,
      checkout_session_id: payload.checkoutSessionId,
      anonymous_session_id: payload.anonymousSessionId,
      decline_code: event.errorCode ?? null,
      decline_category: event.errorCode ? declineCategory(event.errorCode) : null,
      metadata: sql.json(safeMetadata(event.metadata) as never),
    }));

  if (rows.length === 0) return { accepted: 0 };

  // Dedupe: conflito em event_id é ignorado (evento já contabilizado).
  const { error } = await exec(sql`INSERT INTO analytics_events ${sql(
    rows,
    "event_id",
    "event_type",
    "occurred_at",
    "source",
    "store_id",
    "integration_id",
    "order_id",
    "public_token",
    "payment_method",
    "currency",
    "amount_cents",
    "country",
    "browser",
    "device_type",
    "operating_system",
    "referrer",
    "checkout_session_id",
    "anonymous_session_id",
    "decline_code",
    "decline_category",
    "metadata",
  )}
    ON CONFLICT (event_id) DO NOTHING`);
  if (error) console.error("[analytics] insert failed", error.message);

  await upsertSession(
    payload,
    scope,
    ua,
    ctx,
    rows.map((r) => r.event_type),
  );
  return { accepted: rows.length };
}

async function upsertSession(
  payload: IngestPayload,
  scope: Awaited<ReturnType<typeof resolveScope>>,
  ua: ReturnType<typeof parseUserAgent>,
  ctx: ClientContext,
  types: string[],
) {
  const now = new Date().toISOString();
  const { data: existing } = await one<Row<"checkout_sessions">>(
    sql`SELECT * FROM checkout_sessions WHERE checkout_session_id = ${payload.checkoutSessionId}`,
    true,
  );

  const next: Record<string, unknown> = {
    checkout_session_id: payload.checkoutSessionId,
    anonymous_session_id: payload.anonymousSessionId,
    store_id: scope.storeId,
    integration_id: scope.integrationId,
    order_id: scope.orderId,
    public_token: scope.publicToken,
    currency: scope.currency,
    amount_cents: scope.amountCents,
    country: ctx.country,
    browser: ua.browser,
    device_type: ua.deviceType,
    operating_system: ua.operatingSystem,
    referrer: payload.referrer ?? existing?.referrer ?? null,
    utm_source: payload.utm?.source ?? existing?.utm_source ?? null,
    utm_medium: payload.utm?.medium ?? existing?.utm_medium ?? null,
    utm_campaign: payload.utm?.campaign ?? existing?.utm_campaign ?? null,
    utm_term: payload.utm?.term ?? existing?.utm_term ?? null,
    utm_content: payload.utm?.content ?? existing?.utm_content ?? null,
    last_seen_at: now,
  };

  if (types.includes("checkout_viewed")) next["viewed_at"] = existing?.viewed_at ?? now;
  if (types.includes("checkout_started")) next["started_at"] = existing?.started_at ?? now;
  if (types.includes("payment_submitted")) next["attempted_at"] = existing?.attempted_at ?? now;

  const derived = types.includes("payment_submitted")
    ? "ATTEMPTED"
    : types.includes("checkout_started")
      ? "STARTED"
      : "VIEWED";
  const current = existing?.status ?? "VIEWED";
  next["status"] = (STATUS_RANK[derived] ?? 0) > (STATUS_RANK[current] ?? 0) ? derived : current;

  const columns = SESSION_COLUMNS.filter((column) => Object.hasOwn(next, column));
  const { error } = await exec(sql`INSERT INTO checkout_sessions ${sql(next, ...columns)}
    ON CONFLICT (checkout_session_id) DO UPDATE SET ${sql(next, ...columns)}`);
  if (error) console.error("[analytics] session upsert failed", error.message);
}

/** Eventos autoritativos gravados pelo servidor/webhook. Nunca lança. */
export async function recordServerEvent(input: {
  eventId: string;
  type: AnalyticsEventType;
  storeId?: string | null;
  integrationId?: string | null;
  orderId?: string | null;
  publicToken?: string | null;
  paymentIntentId?: string | null;
  paymentMethod?: string | null;
  currency?: string | null;
  amountCents?: number | null;
  declineCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const eventRow = {
      event_id: input.eventId,
      event_type: input.type,
      source: "server",
      store_id: input.storeId ?? null,
      integration_id: input.integrationId ?? null,
      order_id: input.orderId ?? null,
      public_token: input.publicToken ?? null,
      payment_intent_id: input.paymentIntentId ?? null,
      payment_method: input.paymentMethod ?? null,
      currency: input.currency ?? null,
      amount_cents: input.amountCents ?? null,
      decline_code: input.declineCode ?? null,
      decline_category: input.declineCode ? declineCategory(input.declineCode) : null,
      metadata: sql.json(safeMetadata(input.metadata) as never),
    };
    const { error } = await exec(
      sql`INSERT INTO analytics_events ${sql(
        eventRow,
        "event_id",
        "event_type",
        "source",
        "store_id",
        "integration_id",
        "order_id",
        "public_token",
        "payment_intent_id",
        "payment_method",
        "currency",
        "amount_cents",
        "decline_code",
        "decline_category",
        "metadata",
      )} ON CONFLICT (event_id) DO NOTHING`,
    );
    if (error) console.error("[analytics] server event failed", error.message);
    if (input.type === "payment_succeeded" && input.orderId) {
      await exec(
        sql`UPDATE checkout_sessions SET status = ${"SUCCEEDED"}, succeeded_at = ${new Date().toISOString()} WHERE order_id = ${input.orderId}`,
      );
    }
  } catch (error) {
    console.error("[analytics] server event exception", (error as Error).message);
  }
}
