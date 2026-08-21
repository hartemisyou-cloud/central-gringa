import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2, RefreshCw } from "lucide-react";

import {
  adminListUtmifySettings,
  adminResendUtmifyOrder,
  adminRetryUtmifyEvents,
  adminSaveUtmifySettings,
  adminTestUtmifyConnection,
} from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Settings → Tracking → UTMify.
 * O API Token é write-only: enviado ao servidor, cifrado em repouso e jamais
 * devolvido ao navegador. A interface mostra apenas "Configurado" ou não.
 */
type Draft = { webhookId: string; apiToken: string; enabled: boolean; isTest: boolean };

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

export function UtmifySection() {
  const queryClient = useQueryClient();
  const save = useServerFn(adminSaveUtmifySettings);
  const test = useServerFn(adminTestUtmifyConnection);
  const retry = useServerFn(adminRetryUtmifyEvents);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const settings = useQuery({
    queryKey: ["admin", "utmify"],
    queryFn: () => adminListUtmifySettings(),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { storeId: string } & Draft) =>
      save({
        data: {
          storeId: input.storeId,
          webhookId: input.webhookId,
          ...(input.apiToken ? { apiToken: input.apiToken } : {}),
          enabled: input.enabled,
          isTest: input.isTest,
        },
      }),
    onSuccess: async (_result, input) => {
      setDrafts((current) => ({ ...current, [input.storeId]: { ...input, apiToken: "" } }));
      await queryClient.invalidateQueries({ queryKey: ["admin", "utmify"] });
      toast.success("Configuração UTMify salva.");
    },
    onError: () => toast.error("Não foi possível salvar a configuração."),
  });

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <CardTitle>Tracking · UTMify</CardTitle>
        </div>
        <CardDescription>
          Envio server-side da venda aprovada para a API da UTMify, por loja. O API Token fica
          cifrado no servidor e nunca é exibido novamente. O webhook Stripe → UTMify existente
          continua ativo — o envio direto é idempotente por pedido e não duplica vendas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {(settings.data ?? []).map((store) => {
          const draft: Draft = drafts[store.storeId] ?? {
            webhookId: store.webhookId ?? "",
            apiToken: "",
            enabled: store.enabled,
            isTest: store.isTest,
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
                  <Badge variant={store.hasApiToken ? "outline" : "secondary"}>
                    {store.hasApiToken ? "Token configurado" : "Token não configurado"}
                  </Badge>
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>UTMify API Token</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={draft.apiToken}
                    onChange={(event) => update({ apiToken: event.target.value })}
                    placeholder={store.hasApiToken ? "Configurado" : "Não configurado"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>UTMify Webhook ID</Label>
                  <Input
                    value={draft.webhookId}
                    onChange={(event) => update({ webhookId: event.target.value })}
                    placeholder="6a86c222454e7a1f5a3d26f9"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id={`utmify-test-${store.storeId}`}
                  checked={draft.isTest}
                  onCheckedChange={(value) => update({ isTest: value })}
                />
                <Label htmlFor={`utmify-test-${store.storeId}`} className="text-sm font-normal">
                  Marcar vendas como teste (isTest)
                </Label>
              </div>

              <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <p>Último evento enviado: {formatDate(store.lastSentAt ?? store.lastSuccessAt)}</p>
                <p>Última venda: {store.lastOrderNumber ?? "—"}</p>
                <p>Vendas enviadas: {store.sentCount}</p>
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
                    await queryClient.invalidateQueries({ queryKey: ["admin", "utmify"] });
                  }}
                >
                  Testar conexão UTMify
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const result = await retry({ data: { storeId: store.storeId } });
                    toast.success(`${result.retried} envio(s) reprocessado(s).`);
                    await queryClient.invalidateQueries({ queryKey: ["admin", "utmify"] });
                  }}
                >
                  <RefreshCw className="size-4" /> Reprocessar pendentes
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
    <SingleOrderResend />
    </div>
  );
}

/**
 * Ação temporária de validação: reenvia à UTMify UMA única ordem informada.
 * Nenhum pedido/cobrança é criado e o status financeiro não é alterado.
 */
const TARGET_ORDER = "ORD-20260821-QQJUZZ";

function SingleOrderResend() {
  const resend = useServerFn(adminResendUtmifyOrder);
  const [orderNumber, setOrderNumber] = useState(TARGET_ORDER);
  const [result, setResult] = useState<Awaited<ReturnType<typeof resend>> | null>(null);

  const mutation = useMutation({
    mutationFn: () => resend({ data: { orderNumber: orderNumber.trim() } }),
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
    },
    onError: () => toast.error("Falha ao executar o reenvio."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reenvio pontual à UTMify (diagnóstico)</CardTitle>
        <CardDescription>
          Reenvia somente a ordem informada, usando `order_attribution.client_ip` em
          `customer.ip`. Não cria pedido, PaymentIntent ou cobrança, não altera o status
          financeiro e não dispara Meta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="utmify-single-order">Número do pedido</Label>
            <Input
              id="utmify-single-order"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              className="w-64 font-mono text-sm"
            />
          </div>
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Reenviar à UTMify"}
          </Button>
        </div>

        {result && (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
            <p>Pedido: <span className="font-mono">{result.orderNumber}</span> · status {result.orderStatus ?? "—"}</p>
            <p>customer.ip usado: <span className="font-mono">{result.clientIpMasked ?? "—"}</span></p>
            <p>HTTP status: <span className="font-mono">{result.httpStatus ?? "—"}</span></p>
            <p className="break-all">Resposta UTMify: <span className="font-mono">{result.responseBody ?? "—"}</span></p>
            <p>
              utmify_events: <Badge variant={result.eventStatus === "SENT" ? "default" : "destructive"}>{result.eventStatus ?? "—"}</Badge>{" "}
              · tentativas: {result.attemptCount ?? "—"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
