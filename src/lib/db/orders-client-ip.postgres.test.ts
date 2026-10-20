import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createTestClient } from "./test-client";

it("applies manual migration 0006 additively and confirms all nullable order columns", async () => {
  const db = await createTestClient();
  try {
    await db.db.exec(`CREATE TABLE public.orders (id text PRIMARY KEY, public_token text NOT NULL);
      INSERT INTO public.orders VALUES ('historic-order', 'historic-token');`);
    const migration = await readFile(new URL("../../../migrations/0006_orders_client_ip.sql", import.meta.url), "utf8");
    await db.db.exec(migration);
    await db.db.exec(migration);
    expect(await db.client`SELECT * FROM public.orders`).toEqual([{
      id: "historic-order", public_token: "historic-token", client_ip: null,
      checkout_customer_details: null, delivery_email_sent_at: null,
    }]);
    expect(await db.client`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders'
        AND column_name IN ('client_ip', 'checkout_customer_details', 'delivery_email_sent_at')
      ORDER BY column_name`).toEqual([
      { column_name: "checkout_customer_details", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "client_ip", data_type: "text", is_nullable: "YES" },
      { column_name: "delivery_email_sent_at", data_type: "timestamp with time zone", is_nullable: "YES" },
    ]);
  } finally {
    await db.close();
  }
});
