import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let directory: string;
let emptyExport: string;
let badExport: string;
let misleadingInsideDirectory: string;
let misleadingInsideExport: string;
const sentinel = "synthetic-secret-that-must-not-be-logged";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "central-migration-guards-"));
  const tables = JSON.parse(await readFile(join(root, "scripts/source-tables.json"), "utf8")) as Record<string, string[]>;
  emptyExport = join(directory, "synthetic-empty-public.sql");
  await writeFile(emptyExport, Object.entries(tables).map(([table, columns]) =>
    `COPY public.${table} (${columns.join(", ")}) FROM stdin;\n\\.\n`).join("\n"));
  badExport = join(directory, "synthetic-invalid.sql");
  await writeFile(badExport, sentinel);
  misleadingInsideDirectory = await mkdtemp(join(root, "..migration-guard-"));
  misleadingInsideExport = join(misleadingInsideDirectory, "synthetic.sql");
  await writeFile(misleadingInsideExport, "");
});
afterAll(async () => {
  await rm(directory, { recursive:true, force:true });
  await rm(misleadingInsideDirectory, { recursive:true, force:true });
});

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    cwd:root,
    encoding:"utf8",
    env:{ ...process.env, MIGRATION_DATABASE_URL:"", CENTRAL_RUNTIME_PASSWORD:"", ...env },
    timeout:5000,
  });
  return { status:result.status, output:`${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const apply = (data: string) => ["--apply", "--auth-users-empty-confirmed", "--data", data];

describe("migration CLI guards before any network connection", () => {
  it("requires explicit apply and authentication-snapshot confirmation", () => {
    const result = run("migrate-database.mjs", []);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Usage:");
  });

  it("refuses a private export placed inside the repository", () => {
    const result = run("migrate-database.mjs", apply(join(root, "migrations/schema-adaptations.json")));
    expect(result.status).toBe(1);
    expect(result.output).toContain("outside the repository");
  });

  it("does not mistake a repository folder starting with two dots for an external path", () => {
    const result = run("migrate-database.mjs", apply(misleadingInsideExport));
    expect(result.status).toBe(1);
    expect(result.output).toContain("outside the repository");
  });

  it("rejects incomplete data without printing its contents", () => {
    const result = run("migrate-database.mjs", apply(badExport));
    expect(result.status).toBe(1);
    expect(result.output).toContain("Expected exactly one complete COPY block");
    expect(result.output).not.toContain(sentinel);
  });

  it("requires a distinct migration connection even for a valid empty export", () => {
    const result = run("migrate-database.mjs", apply(emptyExport));
    expect(result.status).toBe(1);
    expect(result.output).toContain("MIGRATION_DATABASE_URL is required");
  });

  it("does not leak malformed connection values from the URL parser", () => {
    const result = run("migrate-database.mjs", apply(emptyExport), { MIGRATION_DATABASE_URL:sentinel });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Invalid migration connection configuration");
    expect(result.output).not.toContain(sentinel);
  });

  it("role setup also protects malformed connection values", () => {
    const result = run("setup-database-roles.mjs", [], { MIGRATION_DATABASE_URL:sentinel, CENTRAL_RUNTIME_PASSWORD:sentinel });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Invalid migration connection configuration");
    expect(result.output).not.toContain(sentinel);
  });
});
