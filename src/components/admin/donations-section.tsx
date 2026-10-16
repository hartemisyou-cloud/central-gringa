import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { adminDonationOverview, adminSaveDonationCollection } from "@/lib/donations.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const donationAmount = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function DonationsSection() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["admin", "donations"],
    queryFn: () => adminDonationOverview(),
  });
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: (data: { storeId: string; enabled: boolean }) =>
      adminSaveDonationCollection({ data }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "donations"] });
      setEnabledDraft(null);
      toast.success("Donation settings saved.");
    },
    onError: () => toast.error("Could not save donation settings."),
  });

  const data = overview.data;
  const enabled = enabledDraft ?? data?.collectionEnabled ?? false;
  const collectionOpen = data ? data.collectionGaps.length === 0 : false;
  const activeCampaigns = data?.campaigns.filter((campaign) => campaign.active).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Donations (Hope Human Foundation)</CardTitle>
        <CardDescription>Active campaigns accept donations automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {overview.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
        {overview.isError ? (
          <p className="text-destructive">Could not load donations. Please try again.</p>
        ) : null}
        {!overview.isLoading && !overview.isError && !data ? (
          <p className="text-muted-foreground">No store configured.</p>
        ) : null}
        {data ? (
          <>
            <div className="space-y-4 rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Donation collection</p>
                <div className="flex items-center gap-2">
                  {data.environment ? <Badge variant="outline">{data.environment}</Badge> : null}
                  <Badge variant={collectionOpen ? "default" : "secondary"}>
                    {collectionOpen ? "Open" : "Paused"}
                  </Badge>
                </div>
              </div>
              <p className="text-muted-foreground">
                {data.environment === "TEST"
                  ? "Test mode — no real payments are collected."
                  : data.environment === "LIVE"
                    ? "Live mode — payments are processed by your Stripe account."
                    : "Connect Stripe to accept donations."}
              </p>
              {data.collectionEnabled && !collectionOpen && data.environment ? (
                <p className="text-muted-foreground">
                  Check your active Stripe connection to resume donations.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="donation-collection-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabledDraft}
                    disabled={save.isPending}
                  />
                  <Label htmlFor="donation-collection-enabled">Accept donations</Label>
                </div>
                <Button
                  onClick={() => save.mutate({ storeId: data.storeId, enabled })}
                  disabled={save.isPending || enabled === data.collectionEnabled}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Active campaigns</p>
              <Badge variant="secondary">{activeCampaigns}</Badge>
            </div>

            <div className="space-y-2">
              <p className="font-medium">Recent donations</p>
              {data.donations.length === 0 ? (
                <p className="text-muted-foreground">No donations yet.</p>
              ) : (
                data.donations.map((donation) => (
                  <div
                    key={donation.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <span className="break-all">{donation.donation_number}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {donationAmount.format(donation.amount_cents / 100)} USD
                      </span>
                      <Badge variant={donation.status === "PAID" ? "default" : "secondary"}>
                        {donation.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
