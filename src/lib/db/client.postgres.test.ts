import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient } from "./test-client";
import { rows, one, exec, count } from "./client.server";

let h: Awaited<ReturnType<typeof createTestClient>>;
beforeAll(async () => {
  h = await createTestClient();
  await h.db.exec("CREATE TABLE lookup (id integer PRIMARY KEY, name text UNIQUE); INSERT INTO lookup VALUES (1,'one'),(2,'two');");
});
afterAll(async () => { await h.close(); });

describe("PostgreSQL result contracts", () => {
  it("preserves single/missing cardinality without hiding duplicate rows", async () => {
    expect(await one(h.client`SELECT * FROM lookup WHERE id=1`)).toMatchObject({ data: { id: 1 }, error: null });
    expect(await one(h.client`SELECT * FROM lookup WHERE id=99`, true)).toEqual({ data: null, error: null });
    expect((await one(h.client`SELECT * FROM lookup WHERE id=99`)).error?.code).toBe("CARDINALITY_ERROR");
    expect((await one(h.client`SELECT * FROM lookup`, true)).error?.code).toBe("CARDINALITY_ERROR");
  });
  it("retains SQLSTATE uniqueness errors used by idempotent retries", async () => {
    const result = await exec(h.client`INSERT INTO lookup VALUES (1,'duplicate')`);
    expect(result.error?.code).toBe("23505");
    expect((await count(h.client`SELECT count(*) AS count FROM lookup`)).count).toBe(2);
  });
  it("does not let an error readiness message consume the next concurrent query", async () => {
    const [failure, success] = await Promise.all([
      exec(h.client`INSERT INTO lookup VALUES (1,'duplicate')`),
      one<{ id: number }>(h.client`SELECT id FROM lookup WHERE id = ${2}`),
    ]);
    expect(failure.error?.code).toBe("23505");
    expect(success).toEqual({ data: { id: 2 }, error: null });
  });
  it("binds hostile input as a value and keeps the table intact", async () => {
    const input = "' OR TRUE; DROP TABLE lookup; --";
    expect((await rows(h.client`SELECT * FROM lookup WHERE name=${input}`)).data).toEqual([]);
    expect((await count(h.client`SELECT count(*) AS count FROM lookup`)).count).toBe(2);
  });
  it("returns UTC timestamps compatible with existing report filters", async () => {
    const result = await one<{ stamp: string }>(h.client`SELECT '2026-10-15 10:30:00-03'::timestamptz AS stamp`);
    expect(result.data?.stamp).toBe("2026-10-15T13:30:00.000Z");
  });
});
