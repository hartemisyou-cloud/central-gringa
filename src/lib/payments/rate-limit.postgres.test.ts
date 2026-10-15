import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestClient } from "@/lib/db/test-client";

const H = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof createTestClient>> | null }));
vi.mock("@/lib/db/client.server", async (original) => {
  const actual = await original<typeof import("@/lib/db/client.server")>();
  return { ...actual, sql: new Proxy(function (...args: unknown[]) {
    return (H.current!.client as unknown as (...args: unknown[]) => unknown)(...args);
  }, { get(_target, key) { const value = Reflect.get(H.current!.client, key); return typeof value === "function" ? value.bind(H.current!.client) : value; } }) };
});
import { enforceRateLimit } from "./store-auth.server";
beforeAll(async () => {
  H.current = await createTestClient();
  await H.current.db.exec(`
    CREATE TABLE counters (bucket text PRIMARY KEY, count integer NOT NULL);
    CREATE FUNCTION bump_rate_limit(_bucket text, _window integer) RETURNS integer LANGUAGE sql AS $$
      INSERT INTO counters VALUES (_bucket,1) ON CONFLICT (bucket) DO UPDATE SET count=counters.count+1 RETURNING count
    $$;
  `);
});
afterAll(async () => { await H.current?.close(); });
describe("request protection after migration", () => {
  it("allows the configured quota and rejects the next attempt", async () => {
    await enforceRateLimit("test-bucket",2,60);
    await enforceRateLimit("test-bucket",2,60);
    await expect(enforceRateLimit("test-bucket",2,60)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("fails closed if the database protection is unavailable", async () => {
    await H.current!.db.exec("DROP FUNCTION bump_rate_limit(text,integer)");
    await expect(enforceRateLimit("unprotected",2,60)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});
