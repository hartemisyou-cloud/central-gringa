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

export const adminRotateApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { keyId: string }) => z.object({ keyId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { rotateApiKey } = await import("./admin/keys.server");
    return rotateApiKey(data.keyId);
  });

export const adminRevealApiKey = createServerFn({ method: "POST" })
  .inputValidator((data: { keyId: string }) => z.object({ keyId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { revealApiKey } = await import("./admin/keys.server");
    return revealApiKey(data.keyId);
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

/** Purchase de teste (não cria pedido/pagamento). Somente admin. */
export const adminSendTestMetaPurchase = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { sendTestPurchase } = await import("./meta/capi.server");
    return sendTestPurchase(data.storeId);
  });

/**
 * Teste de fluxo completo: reenvia o Purchase de um pedido REAL existente com
 * test_event_code. Não cria pedido, cobrança nem grava evento de produção.
 */
export const adminSendTestMetaPurchaseForOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string; orderRef: string }) =>
    z.object({ storeId: z.string().uuid(), orderRef: z.string().trim().min(3).max(120) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { sendTestPurchaseFromOrder } = await import("./meta/capi.server");
    return sendTestPurchaseFromOrder({ storeId: data.storeId, orderRef: data.orderRef });
  });

/** Localiza o pedido PAID mais recente da loja (somente leitura, token mascarado). */
export const adminFindLatestPaidOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { findLatestPaidOrder } = await import("./meta/capi.server");
    return findLatestPaidOrder(data.storeId);
  });

/** Pedido PAID mais recente da loja COM registro em order_attribution (leitura). */
export const adminFindPaidOrderWithAttribution = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { findLatestPaidOrderWithAttribution } = await import("./meta/capi.server");
    return findLatestPaidOrderWithAttribution(data.storeId);
  });

/** Purchase somente como Test Event, usando os dados reais desse pedido PAID. */
export const adminSendTestMetaPurchaseAttributed = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { sendTestPurchaseFromAttributedOrder } = await import("./meta/capi.server");
    return sendTestPurchaseFromAttributedOrder(data.storeId);
  });

/* Diagnóstico: inspeção de pedidos + Purchase somente como Test Event TEST2904 */

export const adminListOrdersForMetaDiagnostics = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { listOrdersForDiagnostics } = await import("./meta/diagnostics.server");
    return listOrdersForDiagnostics(data.storeId);
  });

export const adminInspectOrderForMetaDiagnostics = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string; orderId: string }) =>
    z.object({ storeId: z.string().uuid(), orderId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { inspectOrderForDiagnostics } = await import("./meta/diagnostics.server");
    return inspectOrderForDiagnostics(data);
  });

export const adminSendDiagnosticMetaTestPurchase = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string; orderId: string }) =>
    z.object({ storeId: z.string().uuid(), orderId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { sendDiagnosticTestPurchase } = await import("./meta/diagnostics.server");
    return sendDiagnosticTestPurchase(data);
  });


export const adminRetryMetaEvents = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { retryFailedMetaEvents } = await import("./meta/capi.server");
    return retryFailedMetaEvents(data.storeId);
  });

/* ------------------------------------------------------------------ */
/* Tracking → UTMify (API direta), por loja                             */
/* ------------------------------------------------------------------ */

export const adminListUtmifySettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  const { listUtmifySettings } = await import("./utmify/config.server");
  return listUtmifySettings();
});

export const adminSaveUtmifySettings = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      storeId: string;
      webhookId: string;
      apiToken?: string;
      enabled: boolean;
      isTest: boolean;
    }) =>
      z
        .object({
          storeId: z.string().uuid(),
          webhookId: z.string().trim().max(80).default(""),
          apiToken: z.string().trim().min(10).max(400).optional(),
          enabled: z.boolean(),
          isTest: z.boolean(),
        })
        .parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { saveUtmifySettings } = await import("./utmify/config.server");
    await saveUtmifySettings({
      storeId: data.storeId,
      webhookId: data.webhookId || null,
      ...(data.apiToken ? { apiToken: data.apiToken } : {}),
      enabled: data.enabled,
      isTest: data.isTest,
    });
    return { ok: true as const };
  });

export const adminTestUtmifyConnection = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { testUtmifyConnection } = await import("./utmify/api.server");
    return testUtmifyConnection(data.storeId);
  });

export const adminRetryUtmifyEvents = createServerFn({ method: "POST" })
  .inputValidator((data: { storeId: string }) => z.object({ storeId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { retryFailedUtmifyEvents } = await import("./utmify/api.server");
    return retryFailedUtmifyEvents(data.storeId);
  });

/**
 * Ação administrativa temporária: reenvia à UTMify SOMENTE o pedido informado.
 * Não cria pedido/cobrança, não altera status financeiro, não envia Meta.
 */
export const adminResendUtmifyOrder = createServerFn({ method: "POST" })
  .inputValidator((data: { orderNumber: string }) =>
    z.object({ orderNumber: z.string().trim().min(5).max(60) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { resendUtmifySaleForOrderNumber } = await import("./utmify/api.server");
    return resendUtmifySaleForOrderNumber(data.orderNumber);
  });

/* ------------------------------------------------------------------ */
/* Stripe integration per store (keys stored encrypted, never returned) */
/* ------------------------------------------------------------------ */

export const adminListStripeIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin/session.server");
  await requireAdmin();
  const { listStripeIntegrations } = await import("./admin/stripe.server");
  return listStripeIntegrations();
});

export const adminSaveStripeIntegration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        storeId: z.string().uuid(),
        environment: z.enum(["test", "live"]),
        publishableKey: z.string().trim().min(10).max(300),
        secretKey: z.string().trim().min(10).max(300),
        webhookSecret: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin/session.server");
    await requireAdmin();
    const { saveStripeIntegration } = await import("./admin/stripe.server");
    try {
      const result = await saveStripeIntegration({
        ...data,
        webhookSecret: data.webhookSecret || undefined,
      });
      return { ok: true as const, ...result };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  });
