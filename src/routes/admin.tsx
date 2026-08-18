import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";

import {
  adminCreateApiKey,
  adminListApiKeys,
  adminListStores,
  adminLogin,
  adminLogout,
  adminRevokeApiKey,
  adminStatus,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Painel administrativo — Credenciais de API" },
      {
        name: "description",
        content:
          "Painel interno para geração, listagem e revogação de credenciais de API das lojas integradas.",
      },
      { property: "og:title", content: "Painel administrativo — Credenciais de API" },
      {
        property: "og:description",
        content: "Gestão interna de credenciais de API das lojas integradas.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const status = useQuery({ queryKey: ["admin", "status"], queryFn: () => adminStatus() });

  if (status.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return status.data?.unlocked ? <AdminDashboard /> : <AdminLogin />;
}

function AdminLogin() {
  const queryClient = useQueryClient();
  const login = useServerFn(adminLogin);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await login({ data: { password } });
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["admin"] });
      } else {
        toast.error("Senha incorreta.");
      }
    } catch {
      toast.error("Não foi possível entrar. Tente novamente.");
    } finally {
      setPending(false);
      setPassword("");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <CardTitle>Painel administrativo</CardTitle>
          <CardDescription>Área restrita. Informe a senha de acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const logout = useServerFn(adminLogout);
  const createKey = useServerFn(adminCreateApiKey);
  const revokeKey = useServerFn(adminRevokeApiKey);

  const stores = useQuery({ queryKey: ["admin", "stores"], queryFn: () => adminListStores() });
  const keys = useQuery({ queryKey: ["admin", "keys"], queryFn: () => adminListApiKeys() });

  const [storeId, setStoreId] = useState<string>("");
  const [label, setLabel] = useState("default");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createKey({ data: { storeId, label } }),
    onSuccess: async (result) => {
      setFreshKey(result.fullKey);
      setLabel("default");
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Credencial gerada. Copie agora — ela não será exibida novamente.");
    },
    onError: () => toast.error("Não foi possível gerar a credencial."),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeKey({ data: { keyId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Credencial revogada.");
    },
    onError: () => toast.error("Não foi possível revogar a credencial."),
  });

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">Painel administrativo</h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              queryClient.clear();
              await queryClient.invalidateQueries({ queryKey: ["admin"] });
            }}
          >
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Lojas integradas</CardTitle>
            <CardDescription>Ambiente e credenciais ativas por loja.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(stores.data ?? []).map((store) => (
              <div key={store.id} className="rounded-lg border bg-background p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{store.name}</p>
                  <Badge variant={store.environment === "live" ? "default" : "secondary"}>
                    {store.environment}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">/{store.slug}</p>
                <p className="mt-2 text-sm">
                  {store.activeKeys} credencial(is) ativa(s) · status {store.status}
                </p>
              </div>
            ))}
            {stores.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gerar nova credencial</CardTitle>
            <CardDescription>
              O valor completo aparece uma única vez. O banco guarda apenas o hash.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label>Loja</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a loja" />
                  </SelectTrigger>
                  <SelectContent>
                    {(stores.data ?? []).map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Identificação</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="ex.: bff-produção"
                />
              </div>
              <Button
                disabled={!storeId || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Gerar chave"
                )}
              </Button>
            </div>

            {freshKey && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  Copie e guarde agora — não será exibida novamente.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
                    {freshKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(freshKey);
                      toast.success("Credencial copiada.");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credenciais</CardTitle>
            <CardDescription>Somente o prefixo público é armazenado em claro.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Identificação</TableHead>
                  <TableHead>Prefixo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(keys.data ?? []).map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>{key.storeName}</TableCell>
                    <TableCell>{key.label}</TableCell>
                    <TableCell className="font-mono text-xs">{key.keyPrefix}…</TableCell>
                    <TableCell>
                      <Badge variant={key.status === "ACTIVE" ? "default" : "secondary"}>
                        {key.status === "ACTIVE" ? "ativa" : "revogada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.status === "ACTIVE" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(key.id)}
                        >
                          <Trash2 className="size-4" /> Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!keys.isLoading && (keys.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma credencial cadastrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <IntegrationDocs stores={(stores.data ?? []).map((s) => ({ name: s.name, slug: s.slug }))} />
      </div>

    </main>
  );
}

const API_BASE = "https://central-spark-pay.lovable.app/api/public/v1";

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-background p-4 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
      <Button
        variant="outline"
        size="sm"
        className="absolute right-2 top-2"
        onClick={() => {
          navigator.clipboard.writeText(children);
          toast.success("Copiado.");
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function IntegrationDocs({ stores }: { stores: Array<{ name: string; slug: string }> }) {
  const [slug, setSlug] = useState(stores[0]?.slug ?? "loja-1");
  const store = stores.find((s) => s.slug === slug) ?? stores[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentação de conexão</CardTitle>
        <CardDescription>
          Como conectar a loja {store?.name ?? ""} à central de pagamentos. A credencial só pode ser
          usada no servidor (BFF) — nunca no navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {stores.length > 1 && (
          <div className="max-w-xs space-y-2">
            <Label>Loja</Label>
            <Select value={slug} onValueChange={setSlug}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.slug} value={s.slug}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <section className="space-y-2">
          <h3 className="font-medium">1. Guardar a credencial na loja</h3>
          <p className="text-sm text-muted-foreground">
            No projeto da loja, salve a chave gerada aqui como segredo do backend com o nome{" "}
            <code className="rounded bg-muted px-1">STORE_API_KEY</code>. Ela nunca deve aparecer no
            código do frontend.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">2. Endpoints da central</h3>
          <CodeBlock>{`Base: ${API_BASE}
Header obrigatório: x-store-api-key: <STORE_API_KEY>
Header opcional:    x-store-slug: <slug da loja>   (chave unificada multi-loja)

GET  /products                         lista o catálogo e o estoque disponível
POST /quote                            calcula subtotal, frete e total
POST /orders                           cria o pedido e reserva o estoque
POST /orders/:orderId/payment          cria o pagamento (retorna clientSecret Stripe)
GET  /orders/status/:publicToken       consulta o status do pedido`}</CodeBlock>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">3. Exemplo de chamada (servidor)</h3>
          <CodeBlock>{`const res = await fetch("${API_BASE}/quote", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-store-api-key": process.env.STORE_API_KEY,
    "x-store-slug": "${store?.slug ?? "loja-2"}",
  },
  body: JSON.stringify({
    items: [{ sku: "SKU-001", quantity: 1 }],
    postalCode: "01310-100",
  }),
});
const { data, error } = await res.json();`}</CodeBlock>
        </section>


        <section className="space-y-2">
          <h3 className="font-medium">4. Fluxo de pagamento</h3>
          <CodeBlock>{`1. POST /orders  -> { orderId, orderNumber, publicToken, totals }
2. POST /orders/{orderId}/payment -> { clientSecret, publishableKey, amountCents }
3. No navegador: Stripe Elements com publishableKey + clientSecret
   npm i @stripe/stripe-js @stripe/react-stripe-js
   stripe.confirmPayment({ elements, confirmParams: { return_url } })
4. A central recebe o webhook da Stripe, confirma o pagamento e baixa o estoque
5. GET /orders/status/{publicToken} -> acompanha PENDING_PAYMENT -> PAID`}</CodeBlock>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">5. Erros</h3>
          <CodeBlock>{`{ "error": { "code": "UNAUTHORIZED" | "VALIDATION_ERROR" | "OUT_OF_STOCK"
              | "RATE_LIMITED" | "NOT_FOUND" | "CONFIG_ERROR", "message": "..." } }

Limites: 20 pedidos/min e 20 pagamentos/min por loja.`}</CodeBlock>
        </section>

        {store?.slug === "coracoes-unidos" && <DonationTiersDocs />}
      </CardContent>
    </Card>
  );
}

const DONATION_TIERS = [
  { usd: 20, sku: "CU-DON-020" },
  { usd: 30, sku: "CU-DON-030" },
  { usd: 50, sku: "CU-DON-050" },
  { usd: 100, sku: "CU-DON-100" },
  { usd: 250, sku: "CU-DON-250" },
  { usd: 500, sku: "CU-DON-500" },
];

function DonationTiersDocs() {
  return (
    <section className="space-y-4 rounded-lg border bg-background p-4">
      <div className="space-y-1">
        <h3 className="font-medium">6. Doações por valor (US$)</h3>
        <p className="text-sm text-muted-foreground">
          Uma única credencial atende todos os valores. Guarde-a no backend da loja como{" "}
          <code className="rounded bg-muted px-1">STORE_API_KEY</code>. O que define o valor cobrado
          é o SKU enviado no pedido, conforme o ticket escolhido pelo doador.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticket</TableHead>
            <TableHead>SKU enviado no pedido</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {DONATION_TIERS.map((tier) => (
            <TableRow key={tier.sku}>
              <TableCell>US$ {tier.usd}</TableCell>
              <TableCell className="font-mono text-xs">{tier.sku}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CodeBlock>{`// backend da loja — uma única chave para todos os tickets
const SKUS = { 20: "CU-DON-020", 30: "CU-DON-030", 50: "CU-DON-050",
               100: "CU-DON-100", 250: "CU-DON-250", 500: "CU-DON-500" };

async function criarDoacao(valorUsd, doador) {
  const headers = {
    "content-type": "application/json",
    "x-store-api-key": process.env.STORE_API_KEY,
  };

  const order = await fetch("${API_BASE}/orders", {
    method: "POST", headers,
    body: JSON.stringify({
      items: [{ sku: SKUS[valorUsd], quantity: 1 }],
      customer: { email: doador.email, firstName: doador.nome },
      shippingAddress: doador.endereco, // exigido pela central
    }),
  }).then((r) => r.json());

  const pay = await fetch(\`${API_BASE}/orders/\${order.data.orderId}/payment\`, {
    method: "POST", headers,
  }).then((r) => r.json());

  return { publicToken: order.data.publicToken, ...pay.data }; // clientSecret p/ Stripe Elements
}`}</CodeBlock>
    </section>
  );
}


