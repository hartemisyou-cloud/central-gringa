import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { parseCopyBlocks, copyStatement } from "./copy-blocks.mjs";

const args = process.argv.slice(2);
const dataAt = args.indexOf("--data");
if (!args.includes("--apply") || !args.includes("--auth-users-empty-confirmed") || dataAt < 0 || !args[dataAt + 1]) {
  throw new Error("Usage: node scripts/migrate-database.mjs --apply --auth-users-empty-confirmed --data /absolute/private/public-data.sql");
}
const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const input = args[dataAt + 1];
if (!isAbsolute(input)) throw new Error("The private data export must use an absolute path outside the repository.");
const dataPath = await realpath(resolve(input));
const inside = relative(root, dataPath);
const outside = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
if (!outside) {
  throw new Error("The private data export must remain outside the repository.");
}
const blocks = parseCopyBlocks(await readFile(dataPath, "utf8"));
if (blocks.some((block) => ["profiles", "user_roles"].includes(block.table) && block.rowCount !== 0)) {
  throw new Error("This reviewed migration requires an empty legacy authentication snapshot.");
}
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required; the runtime URL must never be used for migration.");
let parsed;
try { parsed = new URL(migrationUrl); } catch { throw new Error("Invalid migration connection configuration."); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.username === "central_runtime") {
  throw new Error("Expected the distinct PostgreSQL migration connection.");
}
const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
if (!local && parsed.searchParams.get("sslmode") === "disable") throw new Error("Remote migration connections require TLS.");
let sql;
try { sql = postgres(migrationUrl, { max:1, prepare:false, ssl:local ? false : { rejectUnauthorized:true }, onnotice:() => {} }); }
catch { throw new Error("Invalid migration connection configuration."); }
const pre = await readFile(new URL("../migrations/001_pre.sql", import.meta.url), "utf8");
const post = await readFile(new URL("../migrations/002_post.sql", import.meta.url), "utf8");
const acl = await readFile(new URL("../migrations/003_server_acl.sql", import.meta.url), "utf8");
let phase = "destination validation";

function canonicalCopy(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized ? normalized.slice(0, -1).split("\n").sort() : [];
  return createHash("sha256").update(lines.length ? `${lines.join("\n")}\n` : "").digest("hex");
}

try {
  const receipt = await sql.begin(async (tx) => {
    const [existing] = await tx`select (
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p','v','m','S')) +
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') +
      (select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d'))
    )::integer as count`;
    if (existing.count !== 0) throw new Error("Destination public schema is not empty; import refused.");
    const [role] = await tx`select current_user <> 'central_runtime'
      and pg_has_role(current_user, 'central_owner', 'MEMBER')
      and pg_has_role(current_user, 'central_owner', 'USAGE') as ready`;
    if (!role.ready) throw new Error("Provision the migration/runtime roles before restoring.");
    const [version] = await tx`select current_setting('server_version_num')::integer as version`;
    if (version.version < 170000) throw new Error("This schema export requires PostgreSQL17or newer.");
    await tx.unsafe("SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3;");
    phase = "pre-data schema";
    await tx.unsafe(pre);
    for (const block of blocks) {
      phase = `COPY ${block.table}`;
      const writable = await tx.unsafe(copyStatement(block)).writable();
      await pipeline(Readable.from([block.data]), writable);
    }
    const tables = [];
    for (const block of blocks) {
      phase = `verify ${block.table}`;
      const statement = copyStatement(block).replace(/ FROM STDIN$/, " TO STDOUT");
      const readable = await tx.unsafe(statement).readable();
      const chunks = [];
      for await (const chunk of readable) chunks.push(Buffer.from(chunk));
      const restored = Buffer.concat(chunks).toString("utf8");
      const rowCount = restored ? restored.split("\n").length - 1 : 0;
      const sha256 = canonicalCopy(restored);
      if (rowCount !== block.rowCount || sha256 !== canonicalCopy(block.data)) {
        throw new Error(`Restored COPY content differs for ${block.table}; transaction will roll back.`);
      }
      tables.push({ table:block.table, rowCount, canonicalCopySha256:sha256 });
    }
    phase = "post-data constraints, indexes and triggers";
    await tx.unsafe(post);
    phase = "server ownership and ACL";
    await tx.unsafe(acl);
    phase = "commit";
    return { tables, restoredRows:tables.reduce((total, table) => total + table.rowCount, 0) };
  });
  // Counts and hashes are safe verification metadata; no row values or URLs.
  console.log(JSON.stringify({ status:"restored", tableCount:receipt.tables.length,
    restoredRows:receipt.restoredRows, tables:receipt.tables }, null, 2));
} catch (error) {
  // COPY error messages can include private row values. Never print error
  // messages, detail, context, statement, connection URL or the export itself.
  console.error("Database migration did not complete successfully. Verify the destination before retrying, especially if commit was attempted.", {
    phase, code:typeof error?.code === "string" ? error.code : "MIGRATION_FAILED",
  });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout:5 });
}
