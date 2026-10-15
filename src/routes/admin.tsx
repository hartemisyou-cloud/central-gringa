import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Copy,
  Eye,

  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  adminCreateApiKey,
  adminListApiKeys,
  adminListStores,
  adminLogin,
  adminLogout,
  adminRevokeApiKey,
  adminRotateApiKey,
  adminRevealApiKey,
  adminStatus,
} from "@/lib/admin.functions";
import { MetaTrackingSection } from "@/components/admin/meta-tracking-section";
import { UtmifySection } from "@/components/admin/utmify-section";
import { StripeSection } from "@/components/admin/stripe-section";
import { DonationsSection } from "@/components/admin/donations-section";
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
      { title: "Admin — API credentials" },
      {
        name: "description",
        content:
          "Internal panel to create, list and revoke store API credentials.",
      },
      { property: "og:title", content: "Admin — API credentials" },
      {
        property: "og:description",
        content: "Internal management of store API credentials.",
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
        toast.error("Wrong password.");
      }
    } catch {
      toast.error("Could not sign in. Please try again.");
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
          <CardTitle>Admin panel</CardTitle>
          <CardDescription>Restricted area. Enter the access password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
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
              {pending ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
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
  const rotateKey = useServerFn(adminRotateApiKey);
  const revealKey = useServerFn(adminRevealApiKey);

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
      toast.success("Credential created. Copy it now — it will not be shown again.");
    },
    onError: () => toast.error("Could not create the credential."),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeKey({ data: { keyId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Credential revoked.");
    },
    onError: () => toast.error("Could not revoke the credential."),
  });

  const revealMutation = useMutation({
    mutationFn: (keyId: string) => revealKey({ data: { keyId } }),
    onSuccess: (result) => {
      setFreshKey(result.fullKey);
      toast.success("Full key shown below.");
    },
    onError: () =>
      toast.error(
        "This credential predates encrypted storage. Rotate it to get a usable value.",
      ),
  });

  const rotateMutation = useMutation({
    mutationFn: (keyId: string) => rotateKey({ data: { keyId } }),
    onSuccess: async (result) => {
      setFreshKey(result.fullKey);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.success("New credential created. Copy it now — it will not be shown again.");
    },
    onError: () => toast.error("Could not rotate the credential."),
  });


  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">Hope Human Books — Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/analytics">
                <BarChart3 className="size-4" /> Analytics
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                queryClient.clear();
                await queryClient.invalidateQueries({ queryKey: ["admin"] });
              }}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>

        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Stores</CardTitle>
            <CardDescription>Environment and active credentials per store.</CardDescription>
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
                  {store.activeKeys} active credential(s) · status {store.status}
                </p>
              </div>
            ))}
            {stores.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create a store credential</CardTitle>
            <CardDescription>
              The full value is shown once. The database keeps only a hash and an encrypted copy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label>Store</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a store" />
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
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. checkout-production"
                />
              </div>
              <Button
                disabled={!storeId || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Create key"
                )}
              </Button>
            </div>

            {freshKey && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  Copy and store it now — it will not be shown again.
                </p>
                <textarea
                  readOnly
                  rows={3}
                  value={freshKey}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full resize-none break-all rounded bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(freshKey);
                      } catch {
                        const el = document.createElement("textarea");
                        el.value = freshKey;
                        document.body.appendChild(el);
                        el.select();
                        document.execCommand("copy");
                        el.remove();
                      }
                      toast.success(`Credential copied (${freshKey.length} characters).`);
                    }}
                  >
                    <Copy className="size-4" /> Copy full key
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {freshKey.length} characters
                  </span>
                </div>
              </div>
            )}

          </CardContent>
        </Card>

        <StripeSection />

        <DonationsSection />

        <MetaTrackingSection />

        <UtmifySection />

        <Card>
          <CardHeader>
            <CardTitle>Credentials</CardTitle>
            <CardDescription>
              Key id, public prefix and the stores each credential can serve. To get a new usable
              value, rotate the key (creates a new one with the same scopes and revokes the old one).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Key ID</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Stores served</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(keys.data ?? []).map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>{key.storeName}</TableCell>
                    <TableCell>{key.label}</TableCell>
                    <TableCell className="font-mono text-xs">{key.keyId}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-xs">{key.keyPrefix}…</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => {
                            navigator.clipboard.writeText(key.keyPrefix);
                            toast.success("Prefix copied.");
                          }}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.scopes.length ? key.scopes.join(", ") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.status === "ACTIVE" ? "default" : "secondary"}>
                        {key.status === "ACTIVE" ? "active" : "revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("en-US") : "—"}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      {key.status === "ACTIVE" && (
                        <>
                          {key.canReveal && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={revealMutation.isPending}
                              onClick={() => revealMutation.mutate(key.id)}
                            >
                              <Eye className="size-4" /> Show key
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={rotateMutation.isPending}
                            onClick={() => rotateMutation.mutate(key.id)}
                          >
                            <RefreshCw className="size-4" /> Rotate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={revokeMutation.isPending}
                            onClick={() => revokeMutation.mutate(key.id)}
                          >
                            <Trash2 className="size-4" /> Revoke
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!keys.isLoading && (keys.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No credentials yet.
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
          toast.success("Copied.");
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function IntegrationDocs({ stores }: { stores: Array<{ name: string; slug: string }> }) {
  const slug = stores[0]?.slug ?? "hope-human-books";
  // Always the central that is serving this page — never a hardcoded old domain.
  const base = typeof window !== "undefined" ? `${window.location.origin}/api/public/v1` : "/api/public/v1";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connecting an external checkout</CardTitle>
        <CardDescription>
          The store credential is server-side only. The external checkout never calls Stripe: it
          creates the order here and redirects the buyer to the returned paymentUrl.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <CodeBlock>{`Base: ${base}
Headers: x-store-api-key: <STORE_API_KEY>
         x-store-slug: ${slug}

GET  /products                        catalog with server prices
POST /quote                           { items:[{productId,quantity}] } -> totals (shipping 0)
POST /orders                          { items, customer:{firstName,lastName,email} }
                                      -> { orderId, orderNumber, publicToken, paymentUrl, receiptUrl, totals }
GET  /orders/status/:publicToken      -> status, receiptUrl, downloadsAvailable`}</CodeBlock>
        <CodeBlock>{`const res = await fetch("${base}/orders", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-store-api-key": process.env.STORE_API_KEY,
    "x-store-slug": "${slug}",
  },
  body: JSON.stringify({
    items: [{ productId: "<uuid from /products>", quantity: 1 }],
    customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  }),
});
const { data } = await res.json();
// redirect the buyer's browser to data.paymentUrl`}</CodeBlock>
        <p className="text-sm text-muted-foreground">
          Payment is confirmed only by the Stripe webhook. Ebook downloads unlock on the receipt
          page once the order is PAID.
        </p>
      </CardContent>
    </Card>
  );
}
