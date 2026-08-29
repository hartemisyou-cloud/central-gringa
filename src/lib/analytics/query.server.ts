import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Agregações de analytics de conversão. Toda consulta é obrigatoriamente
 * filtrável (e filtrada) por loja/integração para preservar o isolamento
 * multi-tenant da Central.
 */

export interface AnalyticsFilters {
  from: string;
  to: string;
  storeId?: string | null | undefined;
  integrationId?: string | null | undefined;
  currency?: string | null | undefined;
  country?: string | null | undefined;
  deviceType?: string | null | undefined;
  paymentMethod?: string | null | undefined;
  amountCents?: number | null | undefined;
}

type EventRow = {
  event_type: string;
  occurred_at: string;
  store_id: string | null;
  integration_id: string | null;
  order_id: string | null;
  payment_intent_id: string | null;
  payment_method: string | null;
  currency: string | null;
  amount_cents: number | null;
  country: string | null;
  browser: string | null;
  device_type: string | null;
  operating_system: string | null;
  referrer: string | null;
  checkout_session_id: string | null;
  decline_code: string | null;
  decline_category: string | null;
  source: string;
};

type SessionRow = {
  checkout_session_id: string;
  store_id: string | null;
  currency: string | null;
  amount_cents: number | null;
  country: string | null;
  device_type: string | null;
  browser: string | null;
  operating_system: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  viewed_at: string | null;
  started_at: string | null;
  attempted_at: string | null;
  succeeded_at: string | null;
};

const MIN_SAMPLE = 30;

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

async function fetchData(filters: AnalyticsFilters) {
  let events = supabaseAdmin
    .from("analytics_events")
    .select(
      "event_type, occurred_at, store_id, integration_id, order_id, payment_intent_id, payment_method, currency, amount_cents, country, browser, device_type, operating_system, referrer, checkout_session_id, decline_code, decline_category, source",
    )
    .gte("occurred_at", filters.from)
    .lte("occurred_at", filters.to)
    .order("occurred_at", { ascending: true })
    .limit(50000);

  let sessions = supabaseAdmin
    .from("checkout_sessions")
    .select(
      "checkout_session_id, store_id, currency, amount_cents, country, device_type, browser, operating_system, referrer, utm_source, utm_medium, utm_campaign, status, viewed_at, started_at, attempted_at, succeeded_at",
    )
    .gte("first_seen_at", filters.from)
    .lte("first_seen_at", filters.to)
    .limit(50000);

  if (filters.storeId) {
    events = events.eq("store_id", filters.storeId);
    sessions = sessions.eq("store_id", filters.storeId);
  }
  if (filters.integrationId) events = events.eq("integration_id", filters.integrationId);
  if (filters.currency) {
    events = events.eq("currency", filters.currency);
    sessions = sessions.eq("currency", filters.currency);
  }
  if (filters.country) {
    events = events.eq("country", filters.country);
    sessions = sessions.eq("country", filters.country);
  }
  if (filters.deviceType) {
    events = events.eq("device_type", filters.deviceType);
    sessions = sessions.eq("device_type", filters.deviceType);
  }
  if (filters.paymentMethod) events = events.eq("payment_method", filters.paymentMethod);
  if (filters.amountCents) {
    events = events.eq("amount_cents", filters.amountCents);
    sessions = sessions.eq("amount_cents", filters.amountCents);
  }

  const [{ data: eventRows }, { data: sessionRows }] = await Promise.all([events, sessions]);
  return {
    events: (eventRows ?? []) as EventRow[],
    sessions: (sessionRows ?? []) as SessionRow[],
  };
}

function distinctSessions(events: EventRow[], type: string): number {
  const set = new Set<string>();
  for (const e of events) {
    if (e.event_type === type) set.add(e.checkout_session_id ?? `${e.order_id}:${e.occurred_at}`);
  }
  return set.size;
}

function countByType(events: EventRow[], type: string): number {
  return events.filter((e) => e.event_type === type).length;
}

function walletBlock(events: EventRow[], prefix: string) {
  const available = distinctSessions(events, `${prefix}_available`);
  const selected = distinctSessions(events, `${prefix}_selected`);
  const success = countByType(events, `${prefix}_success`);
  const failed = countByType(events, `${prefix}_failed`);
  return {
    method: prefix,
    available,
    selected,
    success,
    failed,
    selectionRate: pct(selected, available),
    conversionAfterSelection: pct(success, selected),
    failureRate: pct(failed, selected),
  };
}

function group<T>(rows: T[], key: (row: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

function dimension(events: EventRow[], key: (e: EventRow) => string | null) {
  const map = group(events, key);
  return [...map.entries()]
    .map(([label, rows]) => {
      const views = distinctSessions(rows, "checkout_viewed");
      const attempts = distinctSessions(rows, "payment_submitted");
      const successes = countByType(rows, "payment_succeeded");
      const failures = countByType(rows, "payment_failed");
      return {
        label,
        views,
        attempts,
        successes,
        failures,
        conversionRate: pct(successes, views || attempts),
        declineRate: pct(failures, successes + failures),
      };
    })
    .sort((a, b) => b.views + b.attempts - (a.views + a.attempts));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function seconds(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  return diff >= 0 && diff < 60 * 60 * 6 ? diff : null;
}

export async function buildReport(filters: AnalyticsFilters) {
  const { events, sessions } = await fetchData(filters);

  const views = distinctSessions(events, "checkout_viewed");
  const started = distinctSessions(events, "checkout_started");
  const methodSelected = distinctSessions(events, "payment_method_selected");
  const attempted = distinctSessions(events, "payment_submitted");
  const authentication = distinctSessions(events, "payment_requires_action");
  const succeeded = countByType(events, "payment_succeeded");
  const failed = countByType(events, "payment_failed");
  const canceled = countByType(events, "payment_canceled");
  const abandoned = Math.max(views - attempted, 0);

  const paidAmounts = events
    .filter((e) => e.event_type === "payment_succeeded" && e.amount_cents)
    .map((e) => e.amount_cents ?? 0);
  const averageTicket = paidAmounts.length
    ? Math.round(paidAmounts.reduce((a, b) => a + b, 0) / paidAmounts.length)
    : 0;

  const funnel = [
    { stage: "CHECKOUT_VIEWED", count: views },
    { stage: "CHECKOUT_STARTED", count: started },
    { stage: "PAYMENT_METHOD_SELECTED", count: methodSelected },
    { stage: "PAYMENT_ATTEMPTED", count: attempted },
    { stage: "PAYMENT_AUTHENTICATION", count: authentication },
    { stage: "PAYMENT_SUCCEEDED", count: succeeded },
  ].map((stage, index, all) => {
    const previous = index === 0 ? stage.count : (all[index - 1]?.count ?? 0);
    return { ...stage, stepRate: pct(stage.count, previous), overallRate: pct(stage.count, views) };
  });

  const wallets = ["apple_pay", "google_pay", "link", "card"].map((prefix) => walletBlock(events, prefix));
  const cardSelected = distinctSessions(events, "card_selected");

  const declineRows = events.filter((e) => e.event_type === "payment_failed");
  const declines = {
    total: declineRows.length,
    byCode: [...group(declineRows, (e) => e.decline_code ?? "unknown").entries()]
      .map(([code, rows]) => ({ code, count: rows.length }))
      .sort((a, b) => b.count - a.count),
    byCategory: [...group(declineRows, (e) => e.decline_category ?? "other").entries()]
      .map(([category, rows]) => ({ category, count: rows.length }))
      .sort((a, b) => b.count - a.count),
  };

  const threeDs = {
    challenges: authentication,
    started: countByType(events, "authentication_started") || authentication,
    succeeded: countByType(events, "authentication_succeeded"),
    failed: countByType(events, "authentication_failed"),
    challengeRate: pct(authentication, attempted),
    successRate: pct(countByType(events, "authentication_succeeded"), authentication),
    failureRate: pct(countByType(events, "authentication_failed"), authentication),
  };

  const days = new Map<string, EventRow[]>();
  for (const event of events) {
    const day = event.occurred_at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  const timeseries = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rows]) => ({
      day,
      views: distinctSessions(rows, "checkout_viewed"),
      attempts: distinctSessions(rows, "payment_submitted"),
      successes: countByType(rows, "payment_succeeded"),
      failures: countByType(rows, "payment_failed"),
      conversionRate: pct(countByType(rows, "payment_succeeded"), distinctSessions(rows, "checkout_viewed")),
    }));

  const timings = {
    timeToCheckoutStartSec: median(
      sessions.map((s) => seconds(s.viewed_at, s.started_at)).filter((v): v is number => v !== null),
    ),
    timeToPaymentAttemptSec: median(
      sessions.map((s) => seconds(s.started_at, s.attempted_at)).filter((v): v is number => v !== null),
    ),
    timeToSuccessSec: median(
      sessions.map((s) => seconds(s.attempted_at, s.succeeded_at)).filter((v): v is number => v !== null),
    ),
    medianCompletionSec: median(
      sessions.map((s) => seconds(s.viewed_at, s.succeeded_at)).filter((v): v is number => v !== null),
    ),
    averageCompletionSec: (() => {
      const values = sessions
        .map((s) => seconds(s.viewed_at, s.succeeded_at))
        .filter((v): v is number => v !== null);
      return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    })(),
  };

  const sources = [...group(sessions, (s) => s.utm_source ?? sourceFromReferrer(s.referrer)).entries()]
    .map(([label, rows]) => {
      const attempts = rows.filter((r) => r.status === "ATTEMPTED" || r.status === "SUCCEEDED").length;
      const successes = rows.filter((r) => r.status === "SUCCEEDED").length;
      return {
        label,
        sessions: rows.length,
        attempts,
        successes,
        conversionRate: pct(successes, rows.length),
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  const devices = dimension(events, (e) => e.device_type);
  const browsers = dimension(events, (e) => e.browser);
  const operatingSystems = dimension(events, (e) => e.operating_system);
  const countries = dimension(events, (e) => e.country);
  const tickets = dimension(events, (e) => (e.amount_cents ? String(e.amount_cents) : null));
  const stores = dimension(events, (e) => e.store_id);

  const overall = pct(succeeded, views || attempted);
  const insights = buildInsights({ devices, wallets, declines, succeeded, views, threeDs });

  return {
    filters,
    overview: {
      totalCheckouts: views,
      checkoutStarted: started,
      paymentAttempts: attempted,
      successfulPayments: succeeded,
      failedPayments: failed,
      canceledPayments: canceled,
      abandoned,
      conversionRate: overall,
      viewToStartRate: pct(started, views),
      startToPaymentRate: pct(attempted, started),
      paymentToSuccessRate: pct(succeeded, attempted),
      declineRate: pct(failed, succeeded + failed),
      averageTicketCents: averageTicket,
      cardSelected,
      sampleSize: events.length,
    },
    funnel,
    wallets,
    declines,
    threeDs,
    timeseries,
    timings,
    devices,
    browsers,
    operatingSystems,
    countries,
    tickets,
    stores,
    sources,
    insights,
  };
}

function sourceFromReferrer(referrer: string | null): string {
  if (!referrer) return "direct";
  const value = referrer.toLowerCase();
  if (value.includes("facebook")) return "facebook";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("google")) return "google";
  if (value.includes("tiktok")) return "tiktok";
  return "other";
}

type Insight = { severity: "info" | "warning" | "critical"; title: string; detail: string };

function buildInsights(input: {
  devices: ReturnType<typeof dimension>;
  wallets: ReturnType<typeof walletBlock>[];
  declines: { total: number; byCategory: { category: string; count: number }[] };
  succeeded: number;
  views: number;
  threeDs: { challengeRate: number; failureRate: number; challenges: number };
}): Insight[] {
  const out: Insight[] = [];
  const mobile = input.devices.find((d) => d.label === "mobile");
  const desktop = input.devices.find((d) => d.label === "desktop");

  if (mobile && desktop && mobile.views >= MIN_SAMPLE && desktop.views >= MIN_SAMPLE) {
    const delta = Math.round((desktop.conversionRate - mobile.conversionRate) * 10) / 10;
    if (Math.abs(delta) >= 5) {
      out.push({
        severity: delta > 0 ? "warning" : "info",
        title: delta > 0 ? "Conversão no mobile abaixo do desktop" : "Conversão no mobile acima do desktop",
        detail: `Mobile ${mobile.conversionRate}% vs desktop ${desktop.conversionRate}% (${Math.abs(delta)} p.p.).`,
      });
    }
  }

  const apple = input.wallets.find((w) => w.method === "apple_pay");
  const card = input.wallets.find((w) => w.method === "card");
  if (apple && card && apple.selected >= MIN_SAMPLE && card.selected >= MIN_SAMPLE) {
    const delta = Math.round((apple.conversionAfterSelection - card.conversionAfterSelection) * 10) / 10;
    if (Math.abs(delta) >= 5) {
      out.push({
        severity: "info",
        title: "Diferença de conversão entre Apple Pay e cartão",
        detail: `Apple Pay converte ${delta > 0 ? "+" : ""}${delta} p.p. em relação ao cartão após a seleção.`,
      });
    }
  }

  const link = input.wallets.find((w) => w.method === "link");
  if (link && link.available === 0) {
    out.push({
      severity: "info",
      title: "Link indisponível nesta conta/período",
      detail: "Nenhum evento de disponibilidade do Link foi registrado — isto não é considerado erro.",
    });
  }

  if (input.declines.total >= MIN_SAMPLE) {
    const top = input.declines.byCategory[0];
    if (top) {
      out.push({
        severity: top.category === "hard_decline" ? "warning" : "info",
        title: `Categoria de recusa dominante: ${top.category}`,
        detail: `${top.count} de ${input.declines.total} recusas no período.`,
      });
    }
  }

  if (input.threeDs.challenges >= MIN_SAMPLE && input.threeDs.failureRate >= 20) {
    out.push({
      severity: "warning",
      title: "Falha de autenticação 3DS elevada",
      detail: `${input.threeDs.failureRate}% das autenticações falharam ou foram abandonadas.`,
    });
  }

  return out;
}

/** Exportação CSV respeitando os filtros atuais. Nunca inclui dados de cartão. */
export async function exportCsv(filters: AnalyticsFilters): Promise<string> {
  const { events } = await fetchData(filters);
  const headers = [
    "occurred_at",
    "event_type",
    "source",
    "store_id",
    "integration_id",
    "order_id",
    "payment_intent_id",
    "payment_method",
    "currency",
    "amount_cents",
    "country",
    "device_type",
    "browser",
    "operating_system",
    "decline_code",
    "decline_category",
    "checkout_session_id",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = events.map((event) =>
    headers.map((header) => escape((event as unknown as Record<string, unknown>)[header])).join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}
