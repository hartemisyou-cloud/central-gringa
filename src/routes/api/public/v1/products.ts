import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/products")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/payments/http.server");
        return preflight();
      },
      GET: async ({ request }) => {
        const { withStore } = await import("@/lib/payments/http.server");
        return withStore(
          request,
          { bucket: "products", limit: 120, windowSeconds: 60 },
          async (store) => {
            const { listStoreProducts } = await import("@/lib/payments/catalog.server");
            return { products: await listStoreProducts(store) };
          },
        );
      },
    },
  },
});
