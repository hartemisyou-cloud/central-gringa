import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";

import {
  adminCreateMarketingCode,
  adminDeactivateMarketingCode,
  adminListMarketingCodes,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Settings → Tracking → Marketing codes.
 * Only the random 8-digit code goes in /comprar/{slug}?ref=<code>; the
 * campaign name stays in the database and is resolved on the server.
 */
export function MarketingCodesSection() {
  const queryClient = useQueryClient();
  const create = useServerFn(adminCreateMarketingCode);
  const deactivate = useServerFn(adminDeactivateMarketingCode);
  const [draft, setDraft] = useState({ utmSource: "", utmMedium: "", utmCampaign: "" });
  const [created, setCreated] = useState<string | null>(null);

  const codes = useQuery({ queryKey: ["admin", "marketing-codes"], queryFn: () => adminListMarketingCodes() });

  const createMutation = useMutation({
    mutationFn: () => create({ data: draft }),
    onSuccess: (row) => {
      setCreated(row.code);
      setDraft({ utmSource: "", utmMedium: "", utmCampaign: "" });
      void queryClient.invalidateQueries({ queryKey: ["admin", "marketing-codes"] });
      toast.success("Code created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (code: string) => deactivate({ data: { code } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "marketing-codes"] });
      toast.success("Code deactivated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => toast.success("Copied"));
  };

  const ready = draft.utmSource.trim() && draft.utmMedium.trim() && draft.utmCampaign.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketing codes</CardTitle>
        <CardDescription>
          Use <code>?ref=&lt;code&gt;</code> on /comprar links. The campaign name never appears in the URL or at Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["utmSource", "utmMedium", "utmCampaign"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`mc-${key}`}>{key.replace("utm", "utm_").toLowerCase()}</Label>
              <Input
                id={`mc-${key}`}
                value={draft[key]}
                maxLength={255}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <Button disabled={!ready || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generate code
        </Button>
        {created && (
          <div className="flex items-center gap-3 rounded-md border p-3">
            <span className="font-mono text-lg">{created}</span>
            <Button size="sm" variant="outline" onClick={() => copy(created)}>
              <Copy className="mr-1 h-4 w-4" /> Copy
            </Button>
          </div>
        )}
        <div className="space-y-2">
          {codes.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {codes.data?.length === 0 && <p className="text-sm text-muted-foreground">No active codes.</p>}
          {codes.data?.map((row) => (
            <div key={row.code} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
              <span className="font-mono">{row.code}</span>
              <span className="text-muted-foreground">
                {row.utm_source} / {row.utm_medium} / {row.utm_campaign}
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(row.code)}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate(row.code)}
                >
                  Deactivate
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
