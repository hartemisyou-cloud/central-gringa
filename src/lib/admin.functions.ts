import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isUnlocked } = await import("./admin/session.server");
  return { unlocked: await isUnlocked() };
});

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) =>
    z.object({ password: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { passwordMatches, getAdminSession } = await import("./admin/session.server");
    if (!(await passwordMatches(data.password))) {
      return { ok: false as const };
    }
    const session = await getAdminSession();
    await session.update({ unlocked: true, since: Date.now() });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { getAdminSession } = await import("./admin/session.server");
  const session = await getAdminSession();
  await session.clear();
  return { ok: true as const };
});

export const adminListStores = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  const { listStores } = await import("./admin/keys.server");
  return listStores();
});

export const adminListApiKeys = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  const { listApiKeys } = await import("./admin/keys.server");
  return listApiKeys();
});

export const adminCreateApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string; label: string }) =>
    z.object({ storeId: z.string().uuid(), label: z.string().max(60).default("default") }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { createApiKey } = await import("./admin/keys.server");
    return createApiKey({ storeId: data.storeId, label: data.label || "default" });
  });

export const adminRevokeApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { keyId: string }) => z.object({ keyId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { revokeApiKey } = await import("./admin/keys.server");
    await revokeApiKey(data.keyId);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ */
/* Tracking → Meta (Pixel + Conversions API), por loja                  */
/* ------------------------------------------------------------------ */

export const adminListMetaSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  const { listMetaSettings } = await import("./meta/config.server");
  return listMetaSettings();
});

export const adminSaveMetaSettings = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      storeId: string;
      pixelId: string;
      accessToken?: string;
      testEventCode?: string;
      enabled: boolean;
    }) =>
      z
        .object({
          storeId: z.string().uuid(),
          pixelId: z.string().trim().max(40).default(""),
          accessToken: z.string().trim().min(20).max(400).optional(),
          testEventCode: z.string().trim().max(40).optional(),
          enabled: z.boolean(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { saveMetaSettings } = await import("./meta/config.server");
    await saveMetaSettings({
      storeId: data.storeId,
      pixelId: data.pixelId || null,
      ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      testEventCode: data.testEventCode || null,
      enabled: data.enabled,
    });
    return { ok: true as const };
  });

export const adminTestMetaConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { testMetaConnection } = await import("./meta/capi.server");
    return testMetaConnection(data.storeId);
  });

export const adminRetryMetaEvents = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { retryFailedMetaEvents } = await import("./meta/capi.server");
    return retryFailedMetaEvents(data.storeId);
  });
