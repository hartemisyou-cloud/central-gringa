import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Share2 } from "lucide-react";

import {
  adminFindLatestPaidOrder,
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
  DISABLED: "Desativado",
  NOT_CONFIGURED: "Não configurado",
  CONFIGURED: "Configurado",
  CONNECTED: "Conectado",
  ERROR: "Erro",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
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
      toast.success("Configuração Meta salva.");
    },
    onError: () => toast.error("Não foi possível salvar a configuração."),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Share2 className="size-4 text-primary" />
          <CardTitle>Tracking · Meta</CardTitle>
        </div>
        <CardDescription>
          Pixel + Conversions API por loja. O Access Token fica somente no servidor, cifrado, e
          nunca é exibido nem enviado ao navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
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
                        ? `configurado ••••${store.accessTokenLast4 ?? ""}`
                        : "não configurado"
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
                <p>Último evento com sucesso: {formatDate(store.lastSuccessAt)}</p>
                <p>Último Purchase enviado: {formatDate(store.lastPurchaseAt)}</p>
                <p>Eventos enviados: {store.eventCount}</p>
                <p className="truncate">Último erro: {store.lastError ?? "—"}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ storeId: store.storeId, ...draft })}
                >
                  {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
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
                  Testar conexão
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const result = await retry({ data: { storeId: store.storeId } });
                    toast.success(`${result.retried} evento(s) reprocessado(s).`);
                    await queryClient.invalidateQueries({ queryKey: ["admin", "meta"] });
                  }}
                >
                  <RefreshCw className="size-4" /> Reprocessar pendentes
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
                      if (result.ok) toast.success("Purchase de teste enviado à Meta.");
                      else toast.error(result.message);
                    } catch {
                      setTestResults((current) => ({
                        ...current,
                        [store.storeId]: "Falha ao contatar a Meta.",
                      }));
                      toast.error("Falha ao enviar o evento de teste.");
                    } finally {
                      setTestingStore(null);
                    }
                  }}
                >
                  {testingStore === store.storeId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Enviar Purchase de teste para Meta"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Evento de teste: USD 20,00, enviado apenas server-side com o Test Event Code da
                loja. Não cria pedido, cobrança, PaymentIntent nem envio à UTMify — sem impacto
                financeiro.
              </p>
              {testResults[store.storeId] ? (
                <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">
                  {testResults[store.storeId]}
                </p>
              ) : null}

              <PaidOrderTest storeId={store.storeId} />

              <AttributedPaidOrderTest storeId={store.storeId} />


              {draft.testEventCode ? (
                <p className="text-xs text-amber-600">
                  Test Event Code ativo — remova antes de operar em produção.
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
      if (response.ok) toast.success("Purchase de teste enviado à Meta.");
      else toast.error(response.message);
    } catch {
      toast.error("Falha ao executar o teste de fluxo.");
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
      toast.error("Falha ao buscar o pedido PAID.");
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <Label>Teste do Purchase com pedido real</Label>
      <p className="text-xs text-muted-foreground">
        Usamos um pedido PAID apenas como referência para montar o MESMO payload que a produção
        enviaria (fbp, fbc, IP, User-Agent, e-mail/telefone hashados, event_source_url, UTMs e
        order_id), acrescentando somente o Test Event Code. O pedido não é alterado: sem
        PaymentIntent, sem cobrança, sem webhook, sem UTMify e sem gravar em
        meta_conversion_events.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={phase !== "idle"} onClick={autoTest}>
          {phase !== "idle" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Buscar pedido PAID e testar Purchase"
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setManual((value) => !value)}>
          {manual ? "Usar pedido mais recente" : "Escolher outro pedido"}
        </Button>
      </div>

      {manual ? (
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            value={manualRef}
            onChange={(event) => setManualRef(event.target.value)}
            placeholder="ORD-000123 ou token público"
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
            Testar este pedido
          </Button>
        </div>
      ) : null}

      {notFound ? (
        <p className="text-sm text-muted-foreground">
          Nenhum pedido PAID disponível para esta loja.
        </p>


      ) : null}

      {order?.found ? (
        <div className="rounded-md bg-muted p-2 text-xs">
          <p>
            Pedido encontrado: <span className="font-mono">#{order.orderNumber}</span>
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
        <p className="text-xs text-muted-foreground">Buscando pedido PAID…</p>
      ) : null}
      {phase === "sending" ? (
        <p className="text-xs text-muted-foreground">Enviando Purchase de teste…</p>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-md bg-muted p-3 font-mono text-xs">
          <p className={result.ok ? "text-emerald-600" : "text-destructive"}>
            {result.ok ? "✓ Purchase de teste enviado" : `✗ ${result.message}`}
          </p>
          <p className="break-all">Event ID: {result.eventId || "—"}</p>
          <p>HTTP: {result.httpStatus ?? "—"}</p>
          <p>Test Event Code: {result.testEventCode ?? "—"}</p>
          <p>
            Pedido: #{result.orderNumber ?? "—"} ({result.orderStatus ?? "—"})
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

const NONE = "Nenhum pedido PAID com dados de atribuição disponível para teste.";
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
      toast.error("Falha ao buscar pedido PAID com atribuição.");
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
      if (response.ok) toast.success("Test Event enviado à Meta.");
      else toast.error(response.message);
    } catch {
      toast.error("Falha ao enviar o Test Event.");
    } finally {
      setPhase("idle");
    }
  }

  const attribution = order?.attribution;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <Label>Testar Purchase com pedido PAID</Label>
      <p className="text-xs text-muted-foreground">
        Usa o pedido PAID mais recente desta loja que possua registro de atribuição, enviando o
        Purchase apenas como Test Event (test_event_code da loja) com os dados exatamente como
        estão armazenados. O pedido não é alterado e nada de produção é disparado.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={phase !== "idle"} onClick={preview}>
          {phase === "loading" ? <Loader2 className="size-4 animate-spin" /> : "Pré-visualizar dados"}
        </Button>
        <Button size="sm" variant="secondary" disabled={phase !== "idle"} onClick={send}>
          {phase === "sending" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Testar Purchase com pedido PAID"
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
            {result.ok ? "✓ Test Event enviado" : `✗ ${result.message}`}
          </p>
          <p>HTTP: {result.httpStatus ?? "—"}</p>
          <p className="break-all">event_id: {show(result.eventId)}</p>
          <p>value: {result.value ?? "—"}</p>
          <p>currency: {show(result.currency)}</p>
          <p className="pt-1">Atribuição enviada:</p>
          {Object.entries(result.sentAttribution).map(([key, value]) => (
            <p key={key} className="break-all">
              {key}: {show(value)}
            </p>
          ))}
          <p className="break-all pt-1">Resposta da Meta: {show(result.metaResponse)}</p>
        </div>
      ) : null}
    </div>
  );
}
