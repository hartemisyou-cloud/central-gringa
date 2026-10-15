import { Duplex } from "node:stream";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { rows, one, exec, count } from "./client.server";

/**
 * PostgreSQL wire transport for tests. Postgres.js compiles and binds the same
 * tagged SQL used in production; PGlite executes it as PostgreSQL. No REST
 * client, table/query emulation, external server or credentials are involved.
 */
class PGliteSocket extends Duplex {
  private startup = true;
  constructor(private readonly db: PGlite) {
    super();
  }
  get readyState() {
    return this.destroyed ? "closed" : "open";
  }
  override _read() {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (this.startup) {
      this.startup = false;
      // PGlite is already initialized. Complete the driver's startup handshake.
      queueMicrotask(() => {
        this.push(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0])); // AuthenticationOk
        this.push(Buffer.from([90, 0, 0, 0, 5, 73])); // ReadyForQuery (idle)
      });
      callback();
      return;
    }
    if (chunk[0] === 88) {
      callback();
      this.destroy();
      return;
    } // Terminate
    this.db
      .execProtocolRaw(new Uint8Array(chunk), { syncToFs: false })
      .then((response) => {
        // PGlite can emit ErrorResponse + two consecutive ReadyForQuery messages
        // for one Bind/Execute/Sync group. A real PostgreSQL backend emits one.
        // Keep one readiness message so the duplicate cannot resolve the next query.
        const buffer = Buffer.from(response);
        const messages: Buffer[] = [];
        let hadError = false;
        for (let offset = 0; offset < buffer.length;) {
          const length = 1 + buffer.readInt32BE(offset + 1);
          const message = buffer.subarray(offset, offset + length);
          if (message[0] === 69) hadError = true; // ErrorResponse
          if (!(hadError && message[0] === 90 && messages.at(-1)?.[0] === 90)) messages.push(message);
          offset += length;
        }
        if (messages.length) this.push(Buffer.concat(messages));
        callback();
      })
      .catch((error: Error) => callback(error));
  }
}

export async function createTestClient(existing?: PGlite) {
  const db = existing ?? new PGlite();
  await db.waitReady;
  const client = postgres("postgres://postgres@localhost/postgres", {
    max: 1,
    prepare: false,
    // PGlite exposes one backend; do not pipeline extended-query message groups.
    max_pipeline: 0,
    fetch_types: true,
    idle_timeout: 0,
    ssl: false,
    // `socket` is supported by Postgres.js at runtime (custom transports).
    socket: () => new PGliteSocket(db),
    types: {
      timestampText: {
        to: 1184,
        from: [1114, 1184],
        serialize: (value: unknown) =>
          value instanceof Date ? value.toISOString() : String(value),
        parse: (value: string) =>
          new Date(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value) ? value : `${value}Z`).toISOString(),
      },
    },
  } as Parameters<typeof postgres>[1]);
  return {
    db,
    client,
    module: { sql: client, rows, one, exec, count },
    async close() {
      await client.end({ timeout: 1 });
      if (!existing) await db.close();
    },
  };
}
