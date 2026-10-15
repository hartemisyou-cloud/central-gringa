import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const STORE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const file = (name: string) => readFile(new URL(`../../../${name}`, import.meta.url), "utf8");
let acl: string;
let reference: string;

async function setupRoles() {
  const script = await file("scripts/setup-database-roles.mjs");
  const statements = /await tx\.unsafe\(`([\s\S]*?)`\);/.exec(script)?.[1];
  if (!statements) throw new Error("Role setup SQL was not found.");
  await db.exec("BEGIN");
  await db.query("select set_config('central_migration.runtime_password', $1, true)", ["synthetic-local-fixture-password-32bytes"]);
  try { await db.exec(statements); await db.exec("COMMIT"); }
  catch (error) { await db.exec("ROLLBACK"); throw error; }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE test_migrator LOGIN CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE test_untrusted NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    DO $test$ BEGIN
      EXECUTE format('ALTER DATABASE %I OWNER TO test_migrator', current_database());
    END $test$;
    ALTER SCHEMA public OWNER TO test_migrator;
    SET ROLE test_migrator;
  `);
  await setupRoles();
  const pre = await file("migrations/001_pre.sql");
  const post = await file("migrations/002_post.sql");
  acl = await file("migrations/003_server_acl.sql");
  reference = await file("migrations/reference/export-public-schema.sql");
  await db.exec("BEGIN");
  try {
    await db.exec(pre);
    // Synthetic rows deliberately load before foreign keys and triggers.
    await db.query("insert into public.stores (id, name, slug, currency) values ($1, 'Schema fixture', 'schema-fixture', 'USD')", [STORE]);
    await db.query("insert into public.products (id, store_id, name, slug, sku, price_cents, currency, stock, weight_grams) values ($1, $2, 'Fixture ebook', 'fixture-ebook', 'SCHEMA-TEST', 500, 'USD', 10, 0)", [PRODUCT, STORE]);
    await db.exec(post);
    await db.exec(acl);
    await db.exec("COMMIT");
  } catch (error) { await db.exec("ROLLBACK"); throw error; }
}, 15_000);
afterAll(async () => { await db?.close(); });

describe("portable authoritative schema", () => {
  it("preserves all public tables, enums, functions, triggers and RLS", async () => {
    const result = await db.query<{ tables: number; enums: number; functions: number; triggers: number; secured: number; indexes: number; constraints: number; columns: number; not_null_columns: number }>(`
      select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tables,
        (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e') as enums,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,
        (select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) as triggers,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity) as secured,
        (select count(*)::int from pg_indexes where schemaname='public') as indexes,
        (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype in ('c','f','p','u','x')) as constraints,
        (select count(*)::int from information_schema.columns where table_schema='public') as columns,
        (select count(*)::int from information_schema.columns where table_schema='public' and is_nullable='NO') as not_null_columns
    `);
    expect(result.rows[0]).toEqual({ tables:35, enums:10, functions:17, triggers:21, secured:35, indexes:89, constraints:133, columns:480, not_null_columns:287 });
  });

  it("preserves all17function bodies byte for byte", async () => {
    const bodies = [...reference.matchAll(/^CREATE FUNCTION public\.([^\(]+)\([\s\S]*?\n    AS \$\$([\s\S]*?)\$\$;/gm)];
    expect(bodies).toHaveLength(17);
    for (const match of bodies) {
      const result = await db.query<{ prosrc: string }>("select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [match[1]]);
      expect(result.rows[0]?.prosrc).toBe(match[2]);
    }
  });

  it("retains historical tables and removes only the two auth foreign keys", async () => {
    const result = await db.query<{ count: number }>("select count(*)::int as count from pg_constraint where conname in ('profiles_id_fkey', 'user_roles_user_id_fkey')");
    expect(result.rows[0]?.count).toBe(0);
    await expect(db.query("select * from public.profiles")).resolves.toBeDefined();
    await expect(db.query("select * from public.user_roles")).resolves.toBeDefined();
  });
});

describe("real owner/runtime roles and ACL", () => {
  it("uses distinct restricted roles without runtime inheritance or RLS bypass", async () => {
    const result = await db.query("select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls from pg_roles where rolname in ('central_owner','central_runtime') order by rolname");
    expect(result.rows).toEqual([
      { rolname:"central_owner", rolcanlogin:false, rolsuper:false, rolcreatedb:false, rolcreaterole:false, rolinherit:false, rolbypassrls:false },
      { rolname:"central_runtime", rolcanlogin:true, rolsuper:false, rolcreatedb:false, rolcreaterole:false, rolinherit:false, rolbypassrls:false },
    ]);
    const membership = await db.query<{ count: number }>("select count(*)::int as count from pg_auth_members where member='central_runtime'::regrole");
    expect(membership.rows[0]?.count).toBe(0);
  });

  it("has no PUBLIC EXECUTE on financial or SECURITY DEFINER functions", async () => {
    const result = await db.query<{ count: number }>(`select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
      where n.nspname='public' and a.grantee=0 and a.privilege_type='EXECUTE'`);
    expect(result.rows[0]?.count).toBe(0);
    const grants = await db.query<{ count: number }>("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('central_runtime',p.oid,'EXECUTE')");
    expect(grants.rows[0]?.count).toBe(9);
  });

  it("allows runtime server queries/RPCs, but denies DDL, helper RPCs and legacy tables", async () => {
    await db.exec("SET ROLE central_runtime");
    try {
      const catalog = await db.query("select sku from public.products");
      expect(catalog.rows).toEqual([{ sku:"SCHEMA-TEST" }]);
      const limit = await db.query<{ value: number }>("select public.bump_rate_limit('schema-test', 60) as value");
      expect(limit.rows[0]?.value).toBe(1);
      await expect(db.exec("create table public.forbidden (id integer)")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select public.is_staff(gen_random_uuid())")).rejects.toThrow(/permission denied/i);
      for (const table of ["cart_items", "carts", "product_variants", "profiles", "stripe_checkout_sessions", "user_roles"]) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/i);
      }
      await expect(db.exec("update public.products set stock=0")).rejects.toThrow(/permission denied/i);
    } finally { await db.exec("SET ROLE test_migrator"); }
  });

  it("denies untrusted schema/table access and financial RPC execution", async () => {
    await db.exec("SET ROLE test_untrusted");
    try {
      await expect(db.query("select * from public.products")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select public.bump_rate_limit('forbidden',60)")).rejects.toThrow(/permission denied/i);
    } finally { await db.exec("SET ROLE test_migrator"); }
  });

  it("reapplies ownership/ACL transactionally without resetting data or passwords", async () => {
    await setupRoles();
    await db.exec(`BEGIN; ${acl} COMMIT;`);
    const result = await db.query("select sku from public.products");
    expect(result.rows).toEqual([{ sku:"SCHEMA-TEST" }]);
  });
});

describe("documented pre-existing stock function risk", () => {
  it("demonstrates that the unchanged commit RPC debits twice when called twice", async () => {
    await db.query("insert into public.orders (id, store_id, order_number, environment, public_token, stock_reserved) values ($1,$2,'SCHEMA-RISK','test','synthetic-risk-token',true)", [ORDER, STORE]);
    await db.query("insert into public.order_items (order_id, product_id, product_name, sku, unit_price_cents, quantity, total_cents) values ($1,$2,'Fixture ebook','SCHEMA-TEST',500,2,1000)", [ORDER, PRODUCT]);
    await db.query("select public.reserve_stock($1,2)", [PRODUCT]);
    await db.query("select public.commit_order_stock($1)", [ORDER]);
    await db.query("select public.commit_order_stock($1)", [ORDER]);
    const product = await db.query<{ stock: number }>("select stock from public.products where id=$1", [PRODUCT]);
    // Evidence of the source risk, not an assertion that this is desired.
    // A future reviewed fix must change this expectation to8 and add concurrency coverage.
    expect(product.rows[0]?.stock).toBe(6);
  });

  it("demonstrates that the unchanged release RPC can release another reservation", async () => {
    await db.query("update public.products set reserved_stock=4 where id=$1", [PRODUCT]);
    await db.query("select public.release_order_stock($1)", [ORDER]);
    await db.query("select public.release_order_stock($1)", [ORDER]);
    const product = await db.query<{ reserved_stock: number }>("select reserved_stock from public.products where id=$1", [PRODUCT]);
    expect(product.rows[0]?.reserved_stock).toBe(0);
  });
});
