import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Share2 } from "lucide-react";

import {
  adminFindLatestPaidOrder,
  adminInspectOrderForMetaDiagnostics,
  adminListOrdersForMetaDiagnostics,
  adminSendDiagnosticMetaTestPurchase,
  adminFindPaidOrderWithAttribution,
  adminSendTestMetaPurchaseAttributed,
  adminListMetaSettings,
  adminRetryMetaEvents,
  adminSaveMetaSettings,
  adminSendTestMetaPurchase,
  adminSendTestMetaPurchaseForOrder,
  adminTestMetaConnection,
} from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Settings → Tracking → Meta.
 * O Access Token é write-only: o painel envia um novo valor, mas nunca recebe
 * o token de volta — apenas o estado da conexão e os 4 últimos caracteres.
 */
type Draft = { pixelId: string; accessToken: string; testEventCode: string; enabled: boolean };

const STATUS_LABEL: Record<string, string> = {
  DISABLED: "Disabled",
  NOT_CONFIGURED: "Not configured",
  CONFIGURED: "Configured",
  CONNECTED: "Connected",
  ERROR: "Error",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-US") : "—";
}

export function MetaTrackingSection() {
  const queryClient = useQueryClient();
  const save = useServerFn(adminSaveMetaSettings);
  const test = useServerFn(adminTestMetaConnection);
  const retry = useServerFn(adminRetryMetaEvents);
  const sendTest = useServerFn(adminSendTestMetaPurchase);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingStore, setTestingStore] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ["admin", "meta"],
    queryFn: () => adminListMetaSettings(),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { storeId: string } & Draft) =>
      save({
        data: {
          storeId: input.storeId,
          pixelId: input.pixelId,
          ...(input.accessToken ? { accessToken: input.accessToken } : {}),
          testEventCode: input.testEventCode,
          enabled: input.enabled,
        },
      }),
    onSuccess: async (_result, input) => {
      setDrafts((current) => ({
        ...current,
        [input.storeId]: { ...input, accessToken: "" },
      }));
      await queryClient.invalidateQueries({ queryKey: ["admin", "meta"] });
      toast.success("Meta configuration saved.");
    },
    onError: () => toast.error("Could not save configuration."),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Share2 className="size-4 text-primary" />
          <CardTitle>Tracking · Meta</CardTitle>
        </div>
        <CardDescription>
          Pixel + Conversions API per store. The Access Token stays on the server, encrypted, and
          is never displayed or sent to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {(settings.data ?? []).map((store) => {
          const draft: Draft = drafts[store.storeId] ?? {
            pixelId: store.pixelId ?? "",
            accessToken: "",
            testEventCode: store.testEventCode ?? "",
            enabled: store.enabled,
          };
          const update = (patch: Partial<Draft>) =>
            setDrafts((current) => ({ ...current, [store.storeId]: { ...draft, ...patch } }));

          return (
            <div key={store.storeId} className="space-y-4 rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{store.storeName}</p>
                  <p className="text-sm text-muted-foreground">/{store.storeSlug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      store.status === "CONNECTED"
                        ? "default"
                        : store.status === "ERROR"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {STATUS_LABEL[store.status] ?? store.status}
                  </Badge>
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(value) => update({ enabled: value })}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Meta Pixel ID</Label>
                  <Input
                    value={draft.pixelId}
                    onChange={(event) => update({ pixelId: event.target.value })}
                    placeholder="123456789012345"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Access Token (CAPI)</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={draft.accessToken}
                    onChange={(event) => update({ accessToken: event.target.value })}
                    placeholder={
                      store.hasAccessToken
                        ? `configured ••••${store.accessTokenLast4 ?? ""}`
                        : "not configured"
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Test Event Code (opcional)</Label>
                  <Input
                    value={draft.testEventCode}
                    onChange={(event) => update({ testEventCode: event.target.value })}
                    placeholder="TEST12345"
                  />
                </div>
              </div>

              <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <p>Last successful event: {formatDate(store.lastSuccessAt)}</p>
                <p>Last Purchase sent: {formatDate(store.lastPurchaseAt)}</p>
                <p>Events sent: {store.eventCount}</p>
                <p className="truncate">Last error: {store.lastError ?? "—"}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ storeId: store.storeId, ...draft })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const result = await test({ data: { storeId: store.storeId } });
                    if (result.ok) toast.success(result.message);
                    else toast.error(result.message);
                    await queryClient.invalidateQueries({ queryKey: ["admin", "meta"] });
                  }}
                >
                  Test connection
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const result = await retry({ data: { storeId: store.storeId } });
                    toast.success(`${result.retried} event(s) reprocessed.`);
                    await queryClient.invalidateQueries({ queryKey: ["admin", "meta"] });
                  }}
                >
                  <RefreshCw className="size-4" /> Reprocess pending
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={testingStore === store.storeId}
                  onClick={async () => {
                    setTestingStore(store.storeId);
                    try {
                      const result = await sendTest({ data: { storeId: store.storeId } });
                      const line = `HTTP ${result.httpStatus ?? "—"} · event_id ${result.eventId}${
                        result.testEventCode ? ` · test_event_code ${result.testEventCode}` : ""
                      } · ${result.message}`;
                      setTestResults((current) => ({ ...current, [store.storeId]: line }));
                      if (result.ok) toast.success("Test Purchase sent to Meta.");
                      else toast.error(result.message);
                    } catch {
                      setTestResults((current) => ({
                        ...current,
                        [store.storeId]: "Failed to contact Meta.",
                      }));
                      toast.error("Failed to send test event.");
                    } finally {
                      setTestingStore(null);
                    }
                  }}
                >
                  {testingStore === store.storeId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Send test Purchase to Meta"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Test event: USD 20.00, sent server-side only with the store's Test Event Code. No
                order, charge, PaymentIntent or UTMify send is created — no financial impact.
              </p>
              {testResults[store.storeId] ? (
                <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">
                  {testResults[store.storeId]}
                </p>
              ) : null}

              <PaidOrderTest storeId={store.storeId} />

              <AttributedPaidOrderTest storeId={store.storeId} />

              <OrderDiagnosticsTest storeId={store.storeId} />




              {draft.testEventCode ? (
                <p className="text-xs text-amber-600">
                  Test Event Code active — remove before operating in production.
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

type FoundOrder = {
  found: boolean;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  maskedToken: string | null;
  paidAt: string | null;
};

type TestResult = Awaited<ReturnType<typeof adminSendTestMetaPurchaseForOrder>>;

const yesNo = (value: unknown) => (value ? "✓" : "✗");

/**
 * Teste do Meta CAPI com um pedido PAID real como referência.
 * Somente leitura no pedido: nada é gravado, o pedido não muda de status,
 * não há PaymentIntent, cobrança, webhook, UTMify nem registro em
 * meta_conversion_events. O test_event_code é usado apenas aqui.
 */
function PaidOrderTest({ storeId }: { storeId: string }) {
  const findOrder = useServerFn(adminFindLatestPaidOrder);
  const sendOrderTest = useServerFn(adminSendTestMetaPurchaseForOrder);
  const [order, setOrder] = useState<FoundOrder | null>(null);
  const [manual, setManual] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [phase, setPhase] = useState<"idle" | "searching" | "sending">("idle");
  const [result, setResult] = useState<TestResult | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function runTest(orderRef: string) {
    setPhase("sending");
    setResult(null);
    try {
      const response = await sendOrderTest({ data: { storeId, orderRef } });
      setResult(response);
      if (response.ok) toast.success("Test Purchase sent to Meta.");
      else toast.error(response.message);
    } catch {
      toast.error("Failed to execute flow test.");
    } finally {
      setPhase("idle");
    }
  }

  async function autoTest() {
    setPhase("searching");
    setResult(null);
    setNotFound(false);
    setOrder(null);
    try {
      const found = (await findOrder({ data: { storeId } })) as FoundOrder;
      if (!found.found || !found.orderId) {
        setNotFound(true);
        setPhase("idle");
        return;
      }
      setOrder(found);
      await runTest(found.orderId);
    } catch {
      toast.error("Failed to find PAID order.");
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <Label>Purchase test with real order</Label>
      <p className="text-xs text-muted-foreground">
        Uses a PAID order only as a reference to build the SAME payload production would
        send (fbp, fbc, IP, User-Agent, hashed email/phone, event_source_url, UTMs and
        order_id), adding only the Test Event Code. The order is not changed: no
        PaymentIntent, no charge, no webhook, no UTMify and no write to
        meta_conversion_events.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={phase !== "idle"} onClick={autoTest}>
          {phase !== "idle" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Find PAID order and test Purchase"
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setManual((value) => !value)}>
          {manual ? "Use most recent order" : "Choose another order"}
        </Button>
      </div>

      {manual ? (
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            value={manualRef}
            onChange={(event) => setManualRef(event.target.value)}
            placeholder="ORD-000123 or public token"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={phase !== "idle" || !manualRef.trim()}
            onClick={() => {
              setOrder(null);
              setNotFound(false);
              void runTest(manualRef.trim());
            }}
          >
            Test this order
          </Button>
        </div>
      ) : null}

      {notFound ? (
        <p className="text-sm text-muted-foreground">
          No PAID order available for this store.
        </p>


      ) : null}

      {order?.found ? (
        <div className="rounded-md bg-muted p-2 text-xs">
          <p>
            Order found: <span className="font-mono">#{order.orderNumber}</span>
          </p>
          <p>
            Status: <span className="font-mono">{order.status}</span>
          </p>
          <p>
            Public token: <span className="font-mono">{order.maskedToken ?? "—"}</span>
          </p>
        </div>
      ) : null}

      {phase === "searching" ? (
        <p className="text-xs text-muted-foreground">Finding PAID order…</p>
      ) : null}
      {phase === "sending" ? (
        <p className="text-xs text-muted-foreground">Sending test Purchase…</p>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p className={result.ok ? "text-emerald-600" : "text-destructive"}>
            {result.ok ? "✓ Test Purchase sent" : `✗ ${result.message}`}
          </p>
          <p className="break-all">Event ID: {result.eventId || "—"}</p>
          <p>HTTP: {result.httpStatus ?? "—"}</p>
          <p>Test Event Code: {result.testEventCode ?? "—"}</p>
          <p>
            Order: #{result.orderNumber ?? "—"} ({result.orderStatus ?? "—"})
          </p>
          <p>Value: {String(result.fields["value"] ?? "—")}</p>
          <p>Currency: {String(result.fields["currency"] ?? "—")}</p>
          <p>fbp: {yesNo(result.fields["fbp"])}</p>
          <p>fbc: {yesNo(result.fields["fbc"])}</p>
          <p>IP: {yesNo(result.fields["client_ip_address"])}</p>
          <p>User-Agent: {yesNo(result.fields["client_user_agent"])}</p>
          <p>Email: {yesNo(result.fields["em"])}</p>
          <p>Phone: {yesNo(result.fields["ph"])}</p>
          <p className="break-all">
            Event Source URL: {String(result.fields["event_source_url"] ?? "—")}
          </p>
          <p className="break-all">
            UTMs: source={String(result.fields["utm_source"] ?? "—")} · campaign=
            {String(result.fields["utm_campaign"] ?? "—")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

type AttributedOrder = Awaited<ReturnType<typeof adminFindPaidOrderWithAttribution>>;
type AttributedResult = Awaited<ReturnType<typeof adminSendTestMetaPurchaseAttributed>>;

const NONE = "No PAID order with attribution data available for testing.";
const show = (value: string | null | undefined) => (value && value.length > 0 ? value : "—");

/**
 * Diagnóstico: valida a atribuição Meta com um pedido PAID real já existente.
 * Somente leitura no pedido — nenhum PaymentIntent, cobrança, webhook, UTMify,
 * mudança de status/paid_at ou gravação de evento de produção.
 */
function AttributedPaidOrderTest({ storeId }: { storeId: string }) {
  const findOrder = useServerFn(adminFindPaidOrderWithAttribution);
  const sendTest = useServerFn(adminSendTestMetaPurchaseAttributed);
  const [order, setOrder] = useState<AttributedOrder | null>(null);
  const [result, setResult] = useState<AttributedResult | null>(null);
  const [empty, setEmpty] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "sending">("idle");

  async function preview() {
    setPhase("loading");
    setResult(null);
    setEmpty(false);
    setOrder(null);
    try {
      const found = await findOrder({ data: { storeId } });
      if (!found.found) setEmpty(true);
      else setOrder(found);
    } catch {
      toast.error("Failed to find PAID order with attribution.");
    } finally {
      setPhase("idle");
    }
  }

  async function send() {
    setPhase("sending");
    setResult(null);
    try {
      const response = await sendTest({ data: { storeId } });
      setResult(response);
      if (response.order) setOrder(response.order);
      if (response.message === NONE) setEmpty(true);
      if (response.ok) toast.success("Test Event sent to Meta.");
      else toast.error(response.message);
    } catch {
      toast.error("Failed to send Test Event.");
    } finally {
      setPhase("idle");
    }
  }

  const attribution = order?.attribution;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <Label>Test Purchase with PAID order</Label>
      <p className="text-xs text-muted-foreground">
        Uses the most recent PAID order from this store that has an attribution record, sending the
        Purchase only as a Test Event (the store's test_event_code) with the data exactly as
        they are stored. The order is not changed and nothing in production is triggered.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={phase !== "idle"} onClick={preview}>
          {phase === "loading" ? <Loader2 className="size-4 animate-spin" /> : "Preview data"}
        </Button>
        <Button size="sm" variant="secondary" disabled={phase !== "idle"} onClick={send}>
          {phase === "sending" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Test Purchase with PAID order"
          )}
        </Button>
      </div>

      {empty ? <p className="text-sm text-muted-foreground">{NONE}</p> : null}

      {order?.found && attribution ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p>order_number: #{show(order.orderNumber)}</p>
          <p>status: {show(order.status)}</p>
          <p className="break-all">fbc: {show(attribution.fbc)}</p>
          <p className="break-all">fbp: {show(attribution.fbp)}</p>
          <p>client_ip: {show(attribution.client_ip)}</p>
          <p className="break-all">client_user_agent: {show(attribution.client_user_agent)}</p>
          <p className="break-all">event_source_url: {show(attribution.event_source_url)}</p>
          <p>utm_source: {show(attribution.utm_source)}</p>
          <p>utm_medium: {show(attribution.utm_medium)}</p>
          <p>utm_campaign: {show(attribution.utm_campaign)}</p>
          <p>utm_content: {show(attribution.utm_content)}</p>
          <p>utm_term: {show(attribution.utm_term)}</p>
        </div>
      ) : null}

      {result && result.message !== NONE ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p className={result.ok ? "text-emerald-600" : "text-destructive"}>
            {result.ok ? "✓ Test Event sent" : `✗ ${result.message}`}
          </p>
          <p>HTTP: {result.httpStatus ?? "—"}</p>
          <p className="break-all">event_id: {show(result.eventId)}</p>
          <p>value: {result.value ?? "—"}</p>
          <p>currency: {show(result.currency)}</p>
          <p className="pt-1">Attribution sent:</p>
          {Object.entries(result.sentAttribution).map(([key, value]) => (
            <p key={key} className="break-all">
              {key}: {show(value)}
            </p>
          ))}
          <p className="break-all pt-1">Meta response: {show(result.metaResponse)}</p>
        </div>
      ) : null}
    </div>
  );
}

type DiagOrders = Awaited<ReturnType<typeof adminListOrdersForMetaDiagnostics>>;
type DiagDetail = Awaited<ReturnType<typeof adminInspectOrderForMetaDiagnostics>>;
type DiagResult = Awaited<ReturnType<typeof adminSendDiagnosticMetaTestPurchase>>;

/**
 * Ferramenta ADMIN de diagnóstico (somente leitura no pedido).
 * Permite escolher qualquer pedido da loja, inspecionar os dados armazenados e
 * — após confirmação — enviar o Purchase SOMENTE como Test Event (TEST2904).
 * Não altera status, não cria PaymentIntent/cobrança, não envia UTMify e não
 * grava em meta_conversion_events.
 */
function OrderDiagnosticsTest({ storeId }: { storeId: string }) {
  const listOrders = useServerFn(adminListOrdersForMetaDiagnostics);
  const inspect = useServerFn(adminInspectOrderForMetaDiagnostics);
  const sendDiag = useServerFn(adminSendDiagnosticMetaTestPurchase);

  const [orders, setOrders] = useState<DiagOrders | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<DiagDetail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DiagResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "orders" | "detail" | "sending">("idle");

  async function loadOrders() {
    setPhase("orders");
    try {
      setOrders(await listOrders({ data: { storeId } }));
    } catch {
      toast.error("Failed to load store orders.");
    } finally {
      setPhase("idle");
    }
  }

  async function loadDetail(orderId: string) {
    setSelected(orderId);
    setDetail(null);
    setResult(null);
    setConfirming(false);
    if (!orderId) return;
    setPhase("detail");
    try {
      setDetail(await inspect({ data: { storeId, orderId } }));
    } catch {
      toast.error("Failed to load order data.");
    } finally {
      setPhase("idle");
    }
  }

  async function send() {
    setPhase("sending");
    setResult(null);
    try {
      const response = await sendDiag({ data: { storeId, orderId: selected } });
      setResult(response);
      setConfirming(false);
      if (response.ok) toast.success("TEST EVENT sent to Meta (not a real sale).");
      else toast.error(response.message);
    } catch {
      toast.error("Failure ao enviar o TEST EVENT.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <Label>Order diagnostic (TEST EVENT — not a real sale)</Label>
      <p className="text-xs text-muted-foreground">
        Select any order from this store to inspect the stored data (amount, currency,
        fbc, fbp, IP, User-Agent, event_source_url and UTMs). Meta only receives it as a
        Test Event with code <span className="font-mono">TEST2904</span> and a test-only event_id.
        Nothing changes: no status change, no PaymentIntent, no charge, no UTMify and
        no write to meta_conversion_events.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={phase !== "idle"} onClick={loadOrders}>
          {phase === "orders" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Load recent orders"
          )}
        </Button>
        {orders ? (
          <select
            className="h-9 min-w-[18rem] rounded-md border bg-background px-2 text-sm"
            value={selected}
            onChange={(event) => void loadDetail(event.target.value)}
          >
            <option value="">Select an order…</option>
            {orders.map((order) => (
              <option key={order.orderId} value={order.orderId}>
                #{order.orderNumber} · {order.status} ·{" "}
                {(order.totalCents / 100).toFixed(2)} {order.currency}
                {order.hasAttribution ? " · with attribution" : " · without attribution"}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {orders && orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders found for this store.</p>
      ) : null}

      {phase === "detail" ? (
        <p className="text-xs text-muted-foreground">Loading order data…</p>
      ) : null}

      {detail?.found ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p>order_number: #{show(detail.orderNumber)}</p>
          <p>status: {show(detail.status)}</p>
          <p>
            value: {detail.value ?? "—"} · currency: {show(detail.currency)}
          </p>
          <p className="break-all">fbc: {show(detail.attribution.fbc)}</p>
          <p className="break-all">fbp: {show(detail.attribution.fbp)}</p>
          <p>client_ip: {show(detail.attribution.client_ip)}</p>
          <p className="break-all">
            client_user_agent: {show(detail.attribution.client_user_agent)}
          </p>
          <p className="break-all">
            event_source_url: {show(detail.attribution.event_source_url)}
          </p>
          <p>utm_source: {show(detail.attribution.utm_source)}</p>
          <p>utm_medium: {show(detail.attribution.utm_medium)}</p>
          <p>utm_campaign: {show(detail.attribution.utm_campaign)}</p>
          <p>utm_content: {show(detail.attribution.utm_content)}</p>
          <p>utm_term: {show(detail.attribution.utm_term)}</p>
          {!detail.hasAttribution ? (
            <p className="text-amber-600">
              This order has no record in order_attribution — the fields above will be empty.
            </p>
          ) : null}
        </div>
      ) : null}

      {detail?.found ? (
        confirming ? (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="text-xs">
              Send the Purchase for order #{show(detail.orderNumber)} to Meta as{" "}
              <strong>TEST EVENT (TEST2904)</strong>? This does NOT record a sale, does not change the order and
              uses exactly the data shown above.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={phase !== "idle"} onClick={send}>
                {phase === "sending" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Confirm TEST sending"
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={phase !== "idle"}
            onClick={() => setConfirming(true)}
          >
            Send Purchase as TEST EVENT (TEST2904)
          </Button>
        )
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p className={result.ok ? "text-emerald-600" : "text-destructive"}>
            {result.ok ? "✓ TEST EVENT sent (not a real sale)" : `✗ ${result.message}`}
          </p>
          <p>HTTP: {result.httpStatus ?? "—"}</p>
          <p className="break-all">event_id: {show(result.eventId)}</p>
          <p>test_event_code: {result.testEventCode}</p>
          <p>
            order: #{show(result.orderNumber)} ({show(result.orderStatus)})
          </p>
          <p>
            value: {result.value ?? "—"} · currency: {show(result.currency)}
          </p>
          {Object.entries(result.sentAttribution).map(([key, value]) => (
            <p key={key} className="break-all">
              {key}: {show(value)}
            </p>
          ))}
          <p className="break-all pt-1">Meta response: {show(result.metaResponse)}</p>
        </div>
      ) : null}
    </div>
  );
}
