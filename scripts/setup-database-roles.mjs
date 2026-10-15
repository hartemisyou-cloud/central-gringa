import postgres from "postgres";

// Run locally after destination approval. Never place migration credentials or
// CENTRAL_RUNTIME_PASSWORD in the browser, repository, deployed runtime or logs.
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const runtimePassword = process.env.CENTRAL_RUNTIME_PASSWORD;
if (!migrationUrl || !runtimePassword || Buffer.byteLength(runtimePassword) < 32) {
  throw new Error("MIGRATION_DATABASE_URL and a CENTRAL_RUNTIME_PASSWORD of at least32bytes are required.");
}
let parsed;
try { parsed = new URL(migrationUrl); } catch { throw new Error("Invalid migration connection configuration."); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Expected a PostgreSQL migration URL.");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
if (!local && parsed.searchParams.get("sslmode") === "disable") throw new Error("Remote migration connections require TLS.");
let sql;
try { sql = postgres(migrationUrl, { max:1, prepare:false, ssl:local ? false : { rejectUnauthorized:true }, onnotice:() => {} }); }
catch { throw new Error("Invalid migration connection configuration."); }

try {
  await sql.begin(async (tx) => {
    // Bind the secret as a value in a transaction-local setting. The static SQL
    // on disk contains no password. Existing passwords are never rotated here.
    await tx.unsafe("SET LOCAL password_encryption = 'scram-sha-256'");
    await tx`select set_config('central_migration.runtime_password', ${runtimePassword}, true)`;
    await tx.unsafe(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_owner') THEN
          CREATE ROLE central_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_runtime') THEN
          CREATE ROLE central_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          EXECUTE format('ALTER ROLE central_runtime PASSWORD %L', current_setting('central_migration.runtime_password'));
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_owner'
            AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
          RAISE EXCEPTION 'Existing central_owner attributes are incompatible';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_runtime'
            AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)) THEN
          RAISE EXCEPTION 'Existing central_runtime attributes are incompatible';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'central_runtime'::regrole) THEN
          RAISE EXCEPTION 'central_runtime must not inherit or switch to another role';
        END IF;
        EXECUTE format('GRANT central_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user);
      END
      $roles$;
    `);
  });
  console.log("Database roles are ready. Existing runtime passwords were left unchanged.");
} catch (error) {
  // PostgreSQL error context can contain the password-setting statement; omit
  // message/detail/query/URL entirely rather than risking secret disclosure.
  console.error("Database role setup failed.", { code: typeof error?.code === "string" ? error.code : "SETUP_FAILED" });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout:5 });
}
