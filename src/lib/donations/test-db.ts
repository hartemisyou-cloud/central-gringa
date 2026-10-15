// Test-only: real Postgres (PGlite) running the actual donation migrations, behind
// a minimal supabase-js-like query builder. Never imported by app code.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STUBS = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TABLE public.stripe_integrations (id uuid PRIMARY KEY, status text, environment text, secret_key_ciphertext text,
  webhook_secret_ciphertext text, stripe_account_id text);
CREATE TABLE public.stores (id uuid PRIMARY KEY, slug text, stripe_integration_id uuid, allowed_origins text[] DEFAULT '{}', status text DEFAULT 'ACTIVE', environment text DEFAULT 'test');
CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_payment_id text);
`;

export async function makeTestDb() {
  const pg = new PGlite();
  await pg.exec(STUBS);
  const dir = join(process.cwd(), "drizzle/migrations");
  for (const f of ["0001_donations_subsystem.sql", "0002_donation_funds_constraints.sql", "0003_donation_financial_correctness.sql", "0004_donation_release_guards.sql"]) {
    await pg.exec(readFileSync(join(dir, f), "utf8").replace(/--> statement-breakpoint/g, ""));
  }
  return { pg, client: builderClient(pg) };
}

const val = (v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);

function builderClient(pg: PGlite) {
  // Serialize statements like a single pooled connection would per call.
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  const q = async (sql: string, params: unknown[]) => {
    try {
      const r = await run(() => pg.query(sql, params.map(val)));
      return { data: r.rows as any[], error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  };

  function from(table: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: any;
    let upsertOpts: any = {};
    let order = "";
    let limit = "";
    let countHead = false;
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const build = () => {
      const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      if (op === "select") {
        if (countHead) return `SELECT count(*)::int AS count FROM public.${table}${w}`;
        return `SELECT * FROM public.${table}${w}${order}${limit}`;
      }
      if (op === "update") {
        const sets = Object.entries(payload).map(([k, v]) => `${k} = ${p(v)}`);
        // Re-number: SET params were pushed after WHERE params; rebuild with correct order.
        return `UPDATE public.${table} SET ${sets.join(", ")}${w} RETURNING *`;
      }
      const list = Array.isArray(payload) ? payload : [payload];
      const cols = [...new Set(list.flatMap((r: any) => Object.keys(r)))];
      const rows = list.map((r: any) => `(${cols.map((c) => (c in r ? p(r[c]) : "DEFAULT")).join(", ")})`);
      let sql = `INSERT INTO public.${table} (${cols.join(", ")}) VALUES ${rows.join(", ")}`;
      if (op === "upsert") {
        const conflict = upsertOpts.onConflict ?? "id";
        sql += upsertOpts.ignoreDuplicates
          ? ` ON CONFLICT (${conflict}) DO NOTHING`
          : ` ON CONFLICT (${conflict}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`;
      }
      return `${sql} RETURNING *`;
    };
    const exec = async () => {
      const sql = build();
      const r = await q(sql, params);
      if (countHead) return { data: null, count: r.data?.[0]?.count ?? 0, error: r.error };
      return r;
    };
    const api: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => ((countHead = Boolean(o?.head)), api),
      eq: (k: string, v: unknown) => (where.push(`${k} = ${p(v)}`), api),
      neq: (k: string, v: unknown) => (where.push(`${k} <> ${p(v)}`), api),
      is: (k: string, v: null) => (where.push(`${k} IS ${v === null ? "NULL" : "NOT NULL"}`), api),
      in: (k: string, v: unknown[]) => (where.push(`${k} = ANY(${p(v)})`), api),
      order: (k: string, o?: { ascending?: boolean }) => ((order = ` ORDER BY ${k} ${o?.ascending === false ? "DESC" : "ASC"}`), api),
      limit: (n: number) => ((limit = ` LIMIT ${Number(n)}`), api),
      insert: (v: any) => ((op = "insert"), (payload = v), api),
      update: (v: any) => {
        op = "update";
        payload = v;
        // SET placeholders must come first: stash WHERE until build.
        return api;
      },
      upsert: (v: any, o?: any) => ((op = "upsert"), (payload = v), (upsertOpts = o ?? {}), api),
      maybeSingle: async () => {
        const r: any = await execOrdered();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r: any = await execOrdered();
        if (!r.error && (!r.data || r.data.length !== 1)) return { data: null, error: { message: "expected one row" } };
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (res: any, rej: any) => execOrdered().then(res, rej),
    };
    // UPDATE needs SET params before WHERE params; rebuild placeholders in that order.
    const execOrdered = async () => {
      if (op !== "update") return exec();
      const wParams = params.splice(0, params.length);
      const sets = Object.entries(payload).map(([k, v]) => (params.push(v), `${k} = $${params.length}`));
      const offset = params.length;
      const w = where.map((c) => c.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`));
      params.push(...wParams);
      const sql = `UPDATE public.${table} SET ${sets.join(", ")}${w.length ? ` WHERE ${w.join(" AND ")}` : ""} RETURNING *`;
      return q(sql, params);
    };
    return api;
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS r`;
    const r = await q(sql, keys.map((k) => args[k]));
    return { data: r.data?.[0]?.r ?? null, error: r.error };
  }

  return { from, rpc };
}
