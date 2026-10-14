import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2 } from "lucide-react";

import { analyticsCsv, analyticsRealtime, analyticsReport } from "@/lib/analytics.functions";
import { adminListStores, adminStatus } from "@/lib/admin.functions";
import { ClearAnalyticsButton } from "@/components/admin/clear-analytics-button";

import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/admin_/analytics")({
  head: () => ({
    meta: [
      { title: "Conversion Analytics — Payment Center" },
      {
        name: "description",
        content:
          "Internal checkout analytics dashboard: funnel, payment methods, declines, 3DS, devices, and store attribution.",
      },
      { property: "og:title", content: "Conversion Analytics — Payment Center" },
      {
        property: "og:description",
        content: "Checkout funnel, wallets, declines, and conversion per store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AnalyticsPage,
});

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function AnalyticsPage() {
  const status = useQuery({ queryKey: ["admin", "status"], queryFn: () => adminStatus() });
  const [range, setRange] = useState("30");
  const [storeId, setStoreId] = useState("all");
  const [deviceType, setDeviceType] = useState("all");

  const stores = useQuery({
    queryKey: ["admin", "stores"],
    queryFn: () => adminListStores(),
    enabled: status.data?.unlocked === true,
  });

  const filters = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(range) * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      storeId: storeId === "all" ? null : storeId,
      deviceType: deviceType === "all" ? null : deviceType,
    };
  }, [range, storeId, deviceType]);

  const report = useQuery({
    queryKey: ["admin", "analytics", filters],
    queryFn: () => analyticsReport({ data: filters }),
    enabled: status.data?.unlocked === true,
  });

  // Camada em tempo real: independente do relatório histórico e sem threshold.
  const realtime = useQuery({
    queryKey: ["admin", "analytics", "realtime", storeId],
    queryFn: () => analyticsRealtime({ data: { storeId: storeId === "all" ? null : storeId } }),
    enabled: status.data?.unlocked === true,
    refetchInterval: 7000,
    refetchIntervalInBackground: false,
  });

  const lastUpdate = realtime.data
    ? new Date(realtime.data.generatedAt).toLocaleTimeString("en-US", { hour12: false })
    : "--:--:--";

  if (status.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!status.data?.unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Restricted Access</h1>
          <p className="text-sm text-muted-foreground">
            Log in to the admin panel to view conversion analytics.
          </p>
          <Button asChild>
            <Link to="/admin">Go to panel</Link>
          </Button>
        </div>
      </main>
    );
  }

  const data = report.data;

  async function downloadCsv() {
    try {
      const { csv } = await analyticsCsv({ data: filters });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `analytics-${filters.from.slice(0, 10)}_${filters.to.slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not export CSV.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/admin">
              <ArrowLeft className="size-4" /> Panel
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Conversion Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Checkout funnel, payment methods, declines, and store behavior.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void downloadCsv()}>
            <Download className="size-4" /> Export CSV
          </Button>
          <ClearAnalyticsButton storeId={storeId === "all" ? null : storeId} />
        </div>

      </header>

      <div className="flex flex-wrap gap-3">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            {(stores.data ?? []).map((store: { id: string; name: string }) => (
              <SelectItem key={store.id} value={store.id}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={deviceType} onValueChange={setDeviceType}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All devices</SelectItem>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="desktop">Desktop</SelectItem>
            <SelectItem value="tablet">Tablet</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section className="space-y-2">
        <div className="grid gap-4 sm:grid-cols-3">
          <RealtimeMetric
            label="Online now"
            value={realtime.data?.online}
            hint="Sessions with activity in the last 60s"
          />
          <RealtimeMetric
            label="Donation drawer open now"
            value={realtime.data?.cart}
            hint="Drawer open on main site, active in the last 5 min"
          />
          <RealtimeMetric
            label="In checkout now"
            value={realtime.data?.checkout}
            hint="In checkout and active in the last 5 min"
          />
          <RealtimeMetric
            label="Abandoned drawer"
            value={realtime.data?.drawerAbandoned}
            hint="Opened drawer, did not reach checkout and are 5+ min inactive"
          />
          <RealtimeMetric
            label="Drawer → Checkout Rate"
            value={realtime.data?.drawerToCheckoutRate ?? undefined}
            suffix="%"
            hint={`${realtime.data?.drawerToCheckout ?? 0} of ${realtime.data?.drawerOpened ?? 0} sessions that opened the drawer (24h)`}
          />
          <RealtimeMetric
            label="Drawer abandonment rate"
            value={realtime.data?.drawerAbandonRate ?? undefined}
            suffix="%"
            hint={`${realtime.data?.drawerAbandoned ?? 0} of ${realtime.data?.drawerOpened ?? 0} sessions that opened the drawer (24h)`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Last update: {lastUpdate} · updates automatically every 7s
        </p>
      </section>

      {report.isLoading || !data ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Checkouts" value={String(data.overview.totalCheckouts)} />
            <Metric label="Payment attempts" value={String(data.overview.paymentAttempts)} />
            <Metric
              label="Conversion rate"
              value={`${data.overview.conversionRate}%`}
              hint={`${data.overview.successfulPayments} approved payments`}
            />
            <Metric
              label="Decline rate"
              value={`${data.overview.declineRate}%`}
              hint={`Average ticket ${money(data.overview.averageTicketCents)}`}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Checkout funnel</CardTitle>
              <CardDescription>Stages per unique session in the filtered period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.funnel.map((stage) => (
                <div key={stage.stage} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{stage.stage}</span>
                    <span className="text-muted-foreground">
                      {stage.count} · {stage.overallRate}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.min(stage.overallRate, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment methods</CardTitle>
              <CardDescription>
                Availability, selection, and conversion by method (Apple Pay, Google Pay, Link, card).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead>Selected</TableHead>
                    <TableHead>Success</TableHead>
                    <TableHead>Failure</TableHead>
                    <TableHead>Conversion after selection</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.wallets.map((wallet) => (
                    <TableRow key={wallet.method}>
                      <TableCell className="font-medium">{wallet.method}</TableCell>
                      <TableCell>{wallet.available}</TableCell>
                      <TableCell>{wallet.selected}</TableCell>
                      <TableCell>{wallet.success}</TableCell>
                      <TableCell>{wallet.failed}</TableCell>
                      <TableCell>{wallet.conversionAfterSelection}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <DimensionCard title="Devices" rows={data.devices} />
            <DimensionCard title="Browsers" rows={data.browsers} />
            <DimensionCard title="Operating systems" rows={data.operatingSystems} />
            <DimensionCard title="Countries" rows={data.countries} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Declines</CardTitle>
                <CardDescription>{data.declines.total} declines in the period.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.declines.byCategory.length === 0 ? (
                  <p className="text-muted-foreground">No declines recorded.</p>
                ) : (
                  data.declines.byCategory.map((row) => (
                    <div key={row.category} className="flex justify-between">
                      <span>{row.category}</span>
                      <span className="text-muted-foreground">{row.count}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3DS Authentication</CardTitle>
                <CardDescription>
                  {data.threeDs.challengeRate}% of attempts required authentication.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Challenges" value={String(data.threeDs.challenges)} />
                <Row label="Success" value={`${data.threeDs.successRate}%`} />
                <Row label="Failure/abandonment" value={`${data.threeDs.failureRate}%`} />
                <Row
                  label="Median time to completion"
                  value={`${Math.round(data.timings.medianCompletionSec)}s`}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Traffic source</CardTitle>
              <CardDescription>Attribution by UTM or session referrer.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Sessions</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Conversion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sources.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No data in the period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.sources.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell>{row.sessions}</TableCell>
                        <TableCell>{row.attempts}</TableCell>
                        <TableCell>{row.conversionRate}%</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Automatic diagnostics</CardTitle>
              <CardDescription>
                Insights are only generated with a minimum statistical sample of 30 checkouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.insights.map((insight) => (
                <div key={insight.title} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={insight.severity === "critical" ? "destructive" : "secondary"}>
                      {insight.severity}
                    </Badge>
                    <span className="text-sm font-medium">{insight.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{insight.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function RealtimeMetric({
  label,
  value,
  hint,
  suffix,
}: {
  label: string;
  value: number | undefined;
  hint: string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/60" />
            <span className="inline-flex size-2 rounded-full bg-primary" />
          </span>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        </div>
        <p className="text-3xl font-semibold tabular-nums">
          {value === undefined ? (suffix ? "—" : 0) : `${value}${suffix ?? ""}`}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}

function DimensionCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; views: number; attempts: number; successes: number; conversionRate: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Segmento</TableHead>
              <TableHead>Checkouts</TableHead>
              <TableHead>Sucessos</TableHead>
              <TableHead>Conversion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Sem dados.
                </TableCell>
              </TableRow>
            ) : (
              rows.slice(0, 8).map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{row.views}</TableCell>
                  <TableCell>{row.successes}</TableCell>
                  <TableCell>{row.conversionRate}%</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
