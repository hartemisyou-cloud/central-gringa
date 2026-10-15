import postgres from "postgres";

export interface DatabaseError { code: string; message: string; }
export interface Result<T> { data: T | null; error: DatabaseError | null; count?: number | null; }

let connection: ReturnType<typeof postgres> | undefined;

function connect() {
  if (typeof window !== "undefined") throw new Error("Database access is server-only.");
  if (connection) return connection;
  const value = process.env["DATABASE_URL"];
  if (!value) throw new Error("DATABASE_URL is required on the server.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must be a PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database protocol.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && url.searchParams.get("sslmode") === "disable") throw new Error("Remote database connections require TLS.");
  connection = postgres(value, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 1800,
    prepare: false,
    ssl: local ? false : { rejectUnauthorized: true },
    types: {
      timestampText: {
        to: 1184,
        from: [1114, 1184],
        serialize: (value: unknown) => value instanceof Date ? value.toISOString() : String(value),
        parse: (value: string) => {
          const withZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value) ? value : `${value}Z`;
          const parsed = new Date(withZone);
          return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
        },
      },
      dateText: {
        to: 1082,
        from: [1082],
        serialize: (value: unknown) => String(value),
        parse: (value: string) => value,
      },
    },
  });
  return connection;
}

// Initialization is lazy so build-time imports never require production secrets.
// Every query is an explicit parameterized PostgreSQL statement at its call site.
export const sql = new Proxy(function (...args: unknown[]) {
  return (connect() as unknown as (...values: unknown[]) => unknown)(...args);
} as unknown as ReturnType<typeof postgres>, {
  get(_target, property) {
    const client = connect();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

function failure(error: unknown): DatabaseError {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value?.code === "string" ? value.code : "DATABASE_ERROR",
    message: typeof value?.message === "string" ? value.message : "Database operation failed.",
  };
}

export async function rows<T = Record<string, unknown>>(query: PromiseLike<unknown>): Promise<Result<T[]>> {
  try { return { data: Array.from(await query as ArrayLike<T>), error: null }; }
  catch (error) { return { data: null, error: failure(error) }; }
}

export async function one<T = Record<string, unknown>>(query: PromiseLike<unknown>, maybe = false): Promise<Result<T>> {
  const result = await rows<T>(query);
  if (result.error) return { data: null, error: result.error };
  const records = result.data!;
  if (records.length === 1) return { data: records[0]!, error: null };
  if (maybe && records.length === 0) return { data: null, error: null };
  return { data: null, error: { code: "CARDINALITY_ERROR", message: "Expected a single database row." } };
}

export async function exec(query: PromiseLike<unknown>): Promise<Result<null>> {
  try { await query; return { data: null, error: null }; }
  catch (error) { return { data: null, error: failure(error) }; }
}

export async function count(query: PromiseLike<unknown>): Promise<Result<null>> {
  const result = await one<{ count: string | number | bigint }>(query);
  if (result.error) return { data: null, count: null, error: result.error };
  const value = Number(result.data!.count);
  if (!Number.isSafeInteger(value) || value < 0) return { data: null, count: null, error: { code: "COUNT_ERROR", message: "Invalid row count." } };
  return { data: null, count: value, error: null };
}
