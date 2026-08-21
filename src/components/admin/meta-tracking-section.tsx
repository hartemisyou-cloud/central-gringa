import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Share2 } from "lucide-react";

import {
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
  const sendOrderTest = useServerFn(adminSendTestMetaPurchaseForOrder);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingStore, setTestingStore] = useState<string | null>(null);
  const [orderRefs, setOrderRefs] = useState<Record<string, string>>({});
  const [orderTesting, setOrderTesting] = useState<string | null>(null);

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
