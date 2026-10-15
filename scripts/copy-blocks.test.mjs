import { describe, expect, it } from "vitest";
import { parseCopyBlocks, sourceTables, copyStatement } from "./copy-blocks.mjs";

const complete = () => Object.entries(sourceTables).map(([table, columns]) => `COPY public.${table} (${columns.join(", ")}) FROM stdin;\n\\.\n`).join("\n");
describe("reviewed PostgreSQL data import contract", () => {
  it("requires all 35 source tables and preserves their column order", () => {
    const blocks = parseCopyBlocks(complete());
    expect(blocks).toHaveLength(35);
    expect(blocks.reduce((total, block) => total + block.columns.length, 0)).toBe(480);
    expect(blocks.every((block) => block.rowCount === 0)).toBe(true);
    expect(copyStatement(blocks[0])).toMatch(/^COPY public\."addresses" /);
  });
  it("rejects missing, duplicated and foreign-schema blocks", () => {
    const input = complete();
    expect(() => parseCopyBlocks(input.replace(/^COPY public\.addresses[\s\S]*?\\\.\n/, ""))).toThrow();
    expect(() => parseCopyBlocks(input + input)).toThrow();
    expect(() => parseCopyBlocks(input.replace("COPY public.addresses", "COPY auth.users"))).toThrow();
  });
  it("rejects changed columns and truncated exports", () => {
    expect(() => parseCopyBlocks(complete().replace("(id, customer_id", "(customer_id, id"))).toThrow();
    expect(() => parseCopyBlocks(complete().slice(0, -3))).toThrow();
  });
  it("never returns arbitrary commands outside the validated COPY blocks", () => {
    const blocks = parseCopyBlocks(`DROP SCHEMA public CASCADE;\n${complete()}`);
    expect(blocks.every((block) => block.data === "")).toBe(true);
    expect(() => copyStatement(blocks[0], "PROGRAM 'anything'")).toThrow();
  });
});
