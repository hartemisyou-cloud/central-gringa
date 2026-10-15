import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  adminDonationOverview,
  adminExecuteRelease,
  adminImportCampaigns,
  adminReleasePreview,
  adminResumeRelease,
  adminSaveBeneficiary,
  adminStartOnboarding,
  adminVerifyBeneficiary,
  adminSaveDonationSettings,
  adminUpdateCampaign,
} from "@/lib/donations.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = any;

const BOOL_GATES: Array<[string, string]> = [
  ["stripe_fundraising_approved", "Stripe approved this account for fundraising (confirmed outside this app)"],
  ["connect_approved", "Stripe Connect separate charges & transfers approved"],
  ["usd_settlement_eligible", "USD is an eligible settlement currency for this account"],
  ["adaptive_pricing_eligible", "Account is eligible for Adaptive Pricing"],
  ["adaptive_pricing_enabled", "Use Adaptive Pricing on donation checkout"],
  ["legal_account_name_confirmed", "I checked the legal Stripe account name that appears on Stripe terms and receipts"],
  ["onboarding_enabled", "Allow Stripe-hosted onboarding of existing recipient accounts"],
  ["donations_enabled", "Accept donations"],
  ["releases_enabled", "Allow manual releases"],
];

export function DonationsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "donations"], queryFn: () => adminDonationOverview() });
  const [s, setS] = useState<S | null>(null);
  const [confirmedBy, setConfirmedBy] = useState("");
  const [manifest, setManifest] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [releaseName, setReleaseName] = useState("");
  const [releaseText, setReleaseText] = useState("");

  useEffect(() => {
    if (q.data) {
      const st = q.data.settings ?? {};
      setS({
        recipient_name: st.recipient_name ?? "Hope Human Foundation",
        recipient_country: st.recipient_country ?? "US",
        use_of_funds: st.use_of_funds ?? "",
        platform_country: st.platform_country ?? null,
        allowed_recipient_countries: st.allowed_recipient_countries ?? [],
        stripe_granted_countries: st.stripe_granted_countries ?? [],
        fee_coverage_policy: st.fee_coverage_policy ?? null,
        dashboard_responsibility: st.dashboard_responsibility ?? null,
        negative_balance_liability: st.negative_balance_liability ?? null,
        ngo_fee_funding_cents: st.ngo_fee_funding_cents ?? 0,
        manual_payout_schedule_confirmed: st.manual_payout_schedule_confirmed ?? false,
        max_hold_days: st.max_hold_days ?? null,
        ...Object.fromEntries(BOOL_GATES.map(([k]) => [k, Boolean(st[k])])),
      });
    }
  }, [q.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "donations"] });
  const save = useMutation({
    mutationFn: () => adminSaveDonationSettings({ data: { storeId: q.data!.storeId, ...(s as any), confirmedBy: confirmedBy || undefined } }),
    onSuccess: (r) => (r.ok ? (toast.success("Donation settings saved."), refresh()) : toast.error(r.message)),
  });
  const importM = useMutation({
    mutationFn: () => {
      const campaigns = manifest.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [slug, ...t] = l.split("|");
        return { slug: slug!.trim(), title: t.join("|").trim() };
      });
      return adminImportCampaigns({ data: { storeId: q.data!.storeId, campaigns } });
    },
    onSuccess: (r) => (r.ok ? (toast.success(`Imported ${r.count} campaigns (unreviewed).`), refresh()) : toast.error(r.message)),
  });
  const previewM = useMutation({
    mutationFn: (donationId: string) => adminReleasePreview({ data: { donationId } }),
    onSuccess: (r) => (r.ok ? setPreview(r) : toast.error(r.message)),
  });
  const releaseM = useMutation({
    mutationFn: () => adminExecuteRelease({ data: { donationId: preview.preview.donationId, previewHash: preview.hash, maxAmountCents: preview.preview.transferAmountCents, confirmedBy: releaseName, confirmText: releaseText as "RELEASE FULL DONATION" } }),
    onSuccess: (r) => (r.ok ? (toast.success(`Transfer ${r.transferId} recorded.`), setPreview(null), refresh()) : (toast.error(r.message), refresh())),
  });
  const resumeM = useMutation({
    mutationFn: (donationId: string) => {
      const name = window.prompt("Type your full name to resume this approved release (no new transfer is created):") ?? "";
      return adminResumeRelease({ data: { donationId, confirmedBy: name } });
    },
    onSuccess: (r) => (r.ok ? (toast.success(`Transfer ${r.transferId} recorded.`), refresh()) : (toast.error(r.message), refresh())),
  });
  const [ben, setBen] = useState({ display_name: "", country: "", stripe_account_id: "", service_agreement: "full" });
  const saveBen = useMutation({
    mutationFn: () => adminSaveBeneficiary({ data: { storeId: q.data!.storeId, display_name: ben.display_name, country: ben.country, stripe_account_id: ben.stripe_account_id || null, service_agreement: ben.service_agreement as "full" | "recipient", review_status: "UNREVIEWED" } }),
    onSuccess: (r) => (r.ok ? (toast.success("Beneficiary saved (unreviewed)."), refresh()) : toast.error(r.message)),
  });

  if (!q.data || !s) return null;
  const choice = (key: string, options: string[]) => (
    <select className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm" value={s[key] ?? ""} onChange={(e) => setS({ ...s, [key]: e.target.value || null })}>
      <option value="">Not selected</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Donations (Hope Human Foundation)</CardTitle>
        <CardDescription>Separate from ebooks. Everything stays off until each gate is confirmed by a person.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <div>
          <p className="font-medium">Readiness: {q.data.gaps.length ? <Badge variant="secondary">pending</Badge> : <Badge>ready</Badge>}</p>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">{q.data.gaps.map((g: string) => <li key={g}>{g}</li>)}</ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Recipient name</Label><Input value={s.recipient_name} onChange={(e) => setS({ ...s, recipient_name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Recipient country</Label><Input value={s.recipient_country} maxLength={2} onChange={(e) => setS({ ...s, recipient_country: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Use of funds (shown to donors)</Label><Textarea value={s.use_of_funds} onChange={(e) => setS({ ...s, use_of_funds: e.target.value })} /></div>
          <div className="space-y-1"><Label>Platform Stripe account country</Label><Input value={s.platform_country ?? ""} maxLength={2} onChange={(e) => setS({ ...s, platform_country: e.target.value || null })} /></div>
          <div className="space-y-1"><Label>Allowed recipient countries (comma separated)</Label><Input value={s.allowed_recipient_countries.join(",")} onChange={(e) => setS({ ...s, allowed_recipient_countries: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} /></div>
          <div className="space-y-1"><Label>Countries Stripe explicitly granted outside US/UK/EEA/CA/CH (comma separated)</Label><Input value={s.stripe_granted_countries.join(",")} onChange={(e) => setS({ ...s, stripe_granted_countries: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} /></div>
          <div className="space-y-1"><Label>Fee coverage policy</Label>{choice("fee_coverage_policy", ["NGO_COVERS_ALL"])}</div>
          <div className="space-y-1"><Label>Dashboard responsibility</Label>{choice("dashboard_responsibility", ["EXPRESS", "NONE"])}</div>
          <div className="space-y-1"><Label>Negative balance liability</Label>{choice("negative_balance_liability", ["PLATFORM"])}<p className="text-xs text-muted-foreground">Separate charges and transfers: the platform owns negative balances. Stripe-owned liability is not compatible.</p></div>
          <div className="space-y-1"><Label>Dedicated NGO fee funding (cents)</Label><Input type="number" min={0} value={s.ngo_fee_funding_cents} onChange={(e) => setS({ ...s, ngo_fee_funding_cents: Number(e.target.value) || 0 })} /></div>
          <div className="space-y-1"><Label>Max hold days (actual Stripe limit for the platform country; blank = not configured)</Label><Input type="number" min={1} value={s.max_hold_days ?? ""} onChange={(e) => setS({ ...s, max_hold_days: e.target.value ? Number(e.target.value) : null })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!s.manual_payout_schedule_confirmed} onChange={(e) => setS({ ...s, manual_payout_schedule_confirmed: e.target.checked })} /> I confirmed the Stripe payout schedule is manual (automatic bank payouts can remove the balance held for donations)</label>
        </div>
        <div className="space-y-2">
          {BOOL_GATES.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{label}</label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label>Your full name (confirms the selected financial responsibilities)</Label><Input value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} /></div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save donation settings</Button>
        </div>

        <div className="space-y-2">
          <p className="font-medium">Campaigns ({q.data.campaigns.length})</p>
          {q.data.campaigns.map((c: any) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <span>{c.title} <span className="text-muted-foreground">/{c.slug}</span></span>
              <span className="flex items-center gap-2">
                <Badge variant={c.gaps.length ? "secondary" : "default"}>{c.review_status}{c.active ? " · active" : ""}</Badge>
                {c.review_status !== "APPROVED" ? (
                  <Button size="sm" variant="outline" onClick={async () => {
                    const name = window.prompt("Type your full name to record that you reviewed this campaign:");
                    if (!name) return;
                    const r = await adminUpdateCampaign({ data: { id: c.id, review_status: "APPROVED", active: c.active, ends_at: c.ends_at, release_mode: c.release_mode, beneficiary_id: c.beneficiary_id, reviewedBy: name } });
                    r.ok ? refresh() : toast.error(r.message);
                  }}>Mark reviewed</Button>
                ) : null}
              </span>
            </div>
          ))}
          <Label>Import manifest (one per line: slug|title). Imports are never approved automatically.</Label>
          <Textarea value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder="campaign-slug|Campaign title" />
          <Button variant="outline" onClick={() => importM.mutate()} disabled={!manifest.trim()}>Import campaigns</Button>
        </div>

        <div className="space-y-2">
          <p className="font-medium">Beneficiary registry ({q.data.beneficiaries.length})</p>
          <p className="text-muted-foreground">Readiness is read live from Stripe (account country and transfers capability), never typed here. No identity documents are stored in this app; Stripe collects them on its own hosted pages. This build never creates Stripe accounts.</p>
          {q.data.beneficiaries.map((b: any) => (
            <div key={b.id} className="space-y-1 rounded border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{b.display_name} · {b.country} · {b.stripe_account_id ?? "no account"} · {b.service_agreement ?? "—"} agreement</span>
                <Badge variant={b.review_status === "APPROVED" ? "default" : "secondary"}>{b.review_status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Stripe check: {b.provider_verified_at ? `${b.provider_transfers_status ?? "unknown"} transfers, country ${b.provider_country ?? "?"} (${new Date(b.provider_verified_at).toLocaleString()})` : "not verified yet"}</p>
              {b.gaps.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{b.gaps.map((g: string) => <li key={g}>{g}</li>)}</ul> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!b.stripe_account_id} onClick={async () => {
                  const r = await adminVerifyBeneficiary({ data: { storeId: q.data!.storeId, beneficiaryId: b.id } });
                  if (r.ok) toast.success(r.gaps.length ? `Not ready: ${r.gaps.join("; ")}` : "Stripe confirms transfers are active.");
                  else toast.error([r.message, ...r.gaps].join(" — "));
                  refresh();
                }}>Verify with Stripe</Button>
                {b.review_status !== "APPROVED" ? (
                  <Button size="sm" variant="outline" onClick={async () => {
                    const name = window.prompt("Type your full name to record that you reviewed this beneficiary:");
                    if (!name) return;
                    const r = await adminSaveBeneficiary({ data: { id: b.id, storeId: q.data!.storeId, display_name: b.display_name, country: b.country, stripe_account_id: b.stripe_account_id, service_agreement: b.service_agreement, review_status: "APPROVED", reviewedBy: name } });
                    r.ok ? refresh() : toast.error(r.message);
                  }}>Mark reviewed</Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={b.onboardingGaps.length > 0} title={b.onboardingGaps.join("\n")} onClick={async () => {
                  const name = window.prompt("Type your full name to open Stripe-hosted onboarding:") ?? "";
                  const text = window.prompt("Type OPEN STRIPE ONBOARDING to confirm:") ?? "";
                  if (text !== "OPEN STRIPE ONBOARDING" || name.length < 3) return;
                  const r = await adminStartOnboarding({ data: { storeId: q.data!.storeId, beneficiaryId: b.id, confirmedBy: name, confirmText: "OPEN STRIPE ONBOARDING" } });
                  if (r.ok) window.open(r.url, "_blank", "noopener"); else toast.error([r.message, ...r.gaps].join(" — "));
                }}>Stripe-hosted onboarding</Button>
              </div>
              {b.onboardingGaps.length ? <p className="text-xs text-muted-foreground">Onboarding unavailable: {b.onboardingGaps.join("; ")}</p> : null}
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="Display name" value={ben.display_name} onChange={(e) => setBen({ ...ben, display_name: e.target.value })} />
            <Input placeholder="Country (2 letters)" maxLength={2} value={ben.country} onChange={(e) => setBen({ ...ben, country: e.target.value })} />
            <Input placeholder="Existing acct_… (optional)" value={ben.stripe_account_id} onChange={(e) => setBen({ ...ben, stripe_account_id: e.target.value })} />
            <select className="rounded-md border border-input bg-background px-2 text-sm" value={ben.service_agreement} onChange={(e) => setBen({ ...ben, service_agreement: e.target.value })}>
              <option value="full">Full service agreement</option>
              <option value="recipient">Recipient service agreement (same country only)</option>
            </select>
          </div>
          <Button variant="outline" disabled={!ben.display_name || ben.country.length !== 2 || saveBen.isPending} onClick={() => saveBen.mutate()}>Add beneficiary (unreviewed)</Button>
        </div>

        <div className="space-y-2">
          <p className="font-medium">Recent donations</p>
          {q.data.donations.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between rounded border border-border p-2">
              <span>{d.donation_number} · ${(d.amount_cents / 100).toFixed(2)} · {d.status}</span>
              <span className="flex items-center gap-2">
                {d.release ? <Badge variant="secondary">release {d.release.status}</Badge> : null}
                {d.release && ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(d.release.status) ? (
                  <Button size="sm" variant="outline" onClick={() => resumeM.mutate(d.id)}>Resume / reconcile</Button>
                ) : d.status === "PAID" ? <Button size="sm" variant="outline" onClick={() => previewM.mutate(d.id)}>Release preview</Button> : null}
              </span>
            </div>
          ))}
          {preview ? (
            <div className="space-y-2 rounded border border-border p-3">
              <p>Recipient: {preview.preview.recipientName ?? "—"} · {preview.preview.recipientAccountId ?? "—"} · {preview.preview.recipientCountry ?? "—"}</p>
              <p>Transfer (full gross): ${(preview.preview.transferAmountCents / 100).toFixed(2)} USD · Stripe fee covered by NGO: ${(preview.preview.stripeFeeCents / 100).toFixed(2)}</p>
              <p>Held for other donations (same Stripe account): ${(preview.preview.otherHeldObligationsCents / 100).toFixed(2)} · A release moves funds to the recipient's Stripe balance; it is not a bank payout.</p>
              <p>Dedicated funding left: ${(preview.preview.dedicatedFundingRemainingCents / 100).toFixed(2)} · Funding deficit: ${(preview.preview.fundingDeficitCents / 100).toFixed(2)}</p>
              {preview.preview.blockers.length ? (
                <ul className="list-disc pl-5 text-destructive">{preview.preview.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <Input placeholder="Your full name" value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
                  <Input placeholder="Type RELEASE FULL DONATION" value={releaseText} onChange={(e) => setReleaseText(e.target.value)} />
                  <Button onClick={() => releaseM.mutate()} disabled={releaseText !== "RELEASE FULL DONATION" || releaseName.length < 3}>Confirm release</Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
