import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const filtersSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  storeId: z.string().uuid().nullish(),
  integrationId: z.string().uuid().nullish(),
  currency: z.string().max(8).nullish(),
  country: z.string().max(8).nullish(),
  deviceType: z.string().max(20).nullish(),
  paymentMethod: z.string().max(40).nullish(),
  amountCents: z.number().int().positive().nullish(),
});

export type AnalyticsFiltersInput = z.infer<typeof filtersSchema>;

export const analyticsReport = createServerFn({ method: "POST" })
  .inputValidator((data: AnalyticsFiltersInput) => filtersSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { buildReport } = await import("./analytics/query.server");
    return buildReport(data);
  });

export const analyticsCsv = createServerFn({ method: "POST" })
  .inputValidator((data: AnalyticsFiltersInput) => filtersSchema.parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { exportCsv } = await import("./analytics/query.server");
    return { csv: await exportCsv(data) };
  });
