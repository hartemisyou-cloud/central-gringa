// Test-only: real PostgreSQL donation migrations with the production Postgres.js
// SQL binding/protocol through PGlite. Never imported by app code.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestClient } from "@/lib/db/test-client";

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
  const transport = await createTestClient(pg);
  return { pg, client: transport.client, async close() {
    await transport.close();
    await pg.close();
  } };

}
