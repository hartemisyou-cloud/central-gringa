import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { adminListStripeIntegrations, adminSaveStripeIntegration } from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function StripeSection() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "stripe"], queryFn: () => adminListStripeIntegrations() });
  const save = useServerFn(adminSaveStripeIntegration);
  const [form, setForm] = useState({ storeId: "", environment: "test" as "test" | "live", publishableKey: "", secretKey: "", webhookSecret: "" });
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const mutation = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setForm((f) => ({ ...f, publishableKey: "", secretKey: "", webhookSecret: "" }));
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.success(`Connected Stripe account ${result.accountId}.`);
    },
    onError: () => toast.error("Could not save the Stripe integration."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe integration</CardTitle>
        <CardDescription>
          Keys are validated with Stripe, stored encrypted and never shown again. Use test keys
          first. Add the webhook URL below in Stripe, then paste its signing secret here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {(list.data ?? []).map((row) => (
            <div key={row.storeId} className="rounded-lg border bg-background p-4 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">{row.storeName} <span className="text-muted-foreground">/{row.storeSlug}</span></p>
                <Badge variant={row.integration?.status === "ACTIVE" ? "default" : "secondary"}>
                  {row.integration ? `${row.integration.environment} · ${row.integration.status}` : "not connected"}
                </Badge>
              </div>
              {row.integration ? (
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <p>Account {row.integration.accountId ?? "—"} · secret key ending {row.integration.secretKeyLast4 ?? "—"} · webhook secret {row.integration.hasWebhookSecret ? "saved" : "missing"}</p>
                  <p className="break-all font-mono text-xs">
                    Webhook URL: {origin}/api/public/webhooks/stripe/{row.integration.id}
                  </p>
                  <p className="text-xs">
                    Events: payment_intent.succeeded, payment_intent.payment_failed,
                    payment_intent.canceled, charge.refunded, charge.dispute.created,
                    checkout.session.completed, checkout.session.async_payment_succeeded,
                    checkout.session.async_payment_failed, checkout.session.expired
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Store</Label>
            <Select value={form.storeId} onValueChange={(v) => setForm({ ...form, storeId: v })}>
              <SelectTrigger><SelectValue placeholder="Select a store" /></SelectTrigger>
              <SelectContent>
                {(list.data ?? []).map((r) => (
                  <SelectItem key={r.storeId} value={r.storeId}>{r.storeName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v as "test" | "live" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Test</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pk">Publishable key</Label>
            <Input id="pk" autoComplete="off" placeholder={`pk_${form.environment}_…`} value={form.publishableKey} onChange={(e) => setForm({ ...form, publishableKey: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sk">Secret or restricted key</Label>
            <Input id="sk" type="password" autoComplete="off" placeholder={`sk_${form.environment}_… or rk_${form.environment}_…`} value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="wh">Webhook signing secret (optional on first save)</Label>
            <Input id="wh" type="password" autoComplete="off" placeholder="whsec_…" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!form.storeId || !form.publishableKey || !form.secretKey || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Validate and save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
