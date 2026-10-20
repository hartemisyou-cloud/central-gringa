// Read-only owner audit after ALTER + publish + the two TEST checkouts.
// No payment, Session creation, database mutation or provider dispatch occurs.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const forbidden = /fundação|foundation|doação|donation|campanha|campaign|mateo|hopehumanfoundation|utm_|referr|tracking|hhf|via=/i;
const required = ["DATABASE_URL", "AUDITORIA_STRIPE_KEY", "ORDER_PUBLIC_TOKEN", "STRIPE_SESSION_ID", "AUDIT_OUTPUT_DIR"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(", ")}. Set secrets locally; never paste them in chat.`);
  process.exit(2);
}
const out = resolve(process.env.AUDIT_OUTPUT_DIR);
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fromRepo = relative(repo, out);
const outsideRepo = fromRepo === ".." || fromRepo.startsWith(`..${sep}`) || isAbsolute(fromRepo);
if (!outsideRepo || !process.env.STRIPE_SESSION_ID.startsWith("cs_test_")) {
  console.error("Use an output folder outside the repository and a cs_test_ Session ID.");
  process.exit(2);
}
await mkdir(out, { recursive: true, mode: 0o700 });
const save = (name, value) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false,
  connect_timeout: 10, ssl: { rejectUnauthorized: true } });
const token = process.env.ORDER_PUBLIC_TOKEN;
let exported;
try {
  exported = await db.begin("read only", async q => {
    const identity = await q`select current_database() as database, current_user as role,
      current_setting('transaction_read_only') as read_only`;
    const schema = await q`select column_name, data_type, is_nullable from information_schema.columns
      where table_schema='public' and table_name='orders'
        and column_name in ('client_ip','checkout_customer_details','delivery_email_sent_at') order by column_name`;
    if (schema.length !== 3) {
      await save("schema-pending.json", { identity, schema, status: "ALTER_REQUIRED_BEFORE_PUBLISH" });
      throw new Error("SCHEMA_PENDING");
    }
    const orders = await q`select id,store_id,order_number,environment,status,currency,total_cents,origin_hhf,
      client_ip,checkout_customer_details,delivery_email_sent_at,paid_at,created_at,updated_at
      from public.orders where environment='test' and public_token=${token}
      order by created_at desc,id desc limit 3`;
    const meta_conversion_events = await q`select e.* from public.meta_conversion_events e
      join public.orders o on o.id=e.order_id where o.environment='test' and o.public_token=${token}
      order by e.created_at desc,e.id desc limit 3`;
    const utmify_events = await q`select e.* from public.utmify_events e
      join public.orders o on o.id=e.order_id where o.environment='test' and o.public_token=${token}
      order by e.created_at desc,e.id desc limit 3`;
    const order_attribution = await q`select a.* from public.order_attribution a
      join public.orders o on o.id=a.order_id where o.environment='test' and o.public_token=${token}
      order by a.created_at desc,a.id desc limit 3`;
    return { captured_at: new Date().toISOString(), source_host: new URL(process.env.DATABASE_URL).hostname, identity, schema, orders,
      meta_conversion_events, utmify_events, order_attribution };
  });
  await save("micro-export.json", exported);
} catch (error) {
  // Do not print database connection/error text that might contain credentials.
  console.error(error.message === "SCHEMA_PENDING" ? "Apply and confirm the owner ALTER first." : "Read-only database export failed.");
  process.exitCode = 2;
} finally { await db.end({ timeout: 1 }); }

if (exported) {
  try {
    const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(process.env.STRIPE_SESSION_ID)}`);
    url.searchParams.append("expand[]", "line_items.data.price.product");
    url.searchParams.append("expand[]", "payment_intent");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AUDITORIA_STRIPE_KEY}` },
      signal: AbortSignal.timeout(20000) });
    const session = await response.json();
    await save("stripe-session-full.json", session);
    const serialized = JSON.stringify(session);
    const order = exported.orders[0];
    const report = {
      http_status: response.status,
      bound_to_selected_order: !!order && session.metadata?.order_id === order.id &&
        session.metadata?.store_id === order.store_id && session.metadata?.order_number === order.order_number,
      test_mode: session.livemode === false,
      paid: session.payment_status === "paid" && order?.status === "PAID",
      amount_matches: !!order && session.amount_total === order.total_cents && session.currency?.toUpperCase() === order.currency,
      regex: forbidden.source,
      serialized_object_pass: !forbidden.test(serialized),
      // No field is omitted, masked or exempted before the regex.
      first_match: serialized.match(forbidden)?.[0] ?? null,
    };
    await save("stripe-session-checks.json", report);
    if (!response.ok || !report.bound_to_selected_order || !report.test_mode || !report.paid ||
      !report.amount_matches || !report.serialized_object_pass) process.exitCode = 2;
    console.info("Saved micro-export.json, stripe-session-full.json and stripe-session-checks.json.");
  } catch { console.error("Read-only Stripe audit failed; no key or raw error was printed."); process.exitCode = 2; }
}
