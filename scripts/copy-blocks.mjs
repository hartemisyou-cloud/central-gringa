import { readFileSync } from "node:fs";

export const sourceTables = JSON.parse(readFileSync(new URL("./source-tables.json", import.meta.url), "utf8"));

/** Read only known public COPY blocks. Never execute commands from a data dump. */
export function parseCopyBlocks(text) {
  if (Buffer.byteLength(text, "utf8") > 64 * 1024 * 1024) throw new Error("Data dump exceeds the reviewed import limit.");
  const pattern = /^COPY public\.([a-z_][a-z0-9_]*) \(([a-z0-9_, ]+)\) FROM stdin;\r?\n([\s\S]*?)^\\\.\r?\n/gm;
  const seen = new Set();
  const blocks = [];
  for (const match of text.matchAll(pattern)) {
    const [, table, rawColumns, data] = match;
    const columns = rawColumns.split(",").map((name) => name.trim());
    if (!Object.hasOwn(sourceTables, table) || seen.has(table)) throw new Error("Unexpected or repeated table in the data dump.");
    if (JSON.stringify(columns) !== JSON.stringify(sourceTables[table])) throw new Error(`Column contract mismatch for ${table}.`);
    if (data && !data.endsWith("\n")) throw new Error("Incomplete COPY data block.");
    seen.add(table);
    blocks.push({ table, columns, data, rowCount: data ? data.split("\n").length - 1 : 0 });
  }
  if (blocks.length !== Object.keys(sourceTables).length || (text.match(/^COPY /gm)?.length ?? 0) !== blocks.length) {
    throw new Error("Expected exactly one complete COPY block for each source table.");
  }
  return blocks;
}

export function copyStatement(block, source = "STDIN") {
  if (!Object.hasOwn(sourceTables, block.table) || JSON.stringify(block.columns) !== JSON.stringify(sourceTables[block.table])) {
    throw new Error("Invalid COPY block contract.");
  }
  if (!["STDIN", "'/dev/blob'"].includes(source)) throw new Error("Unsupported COPY source.");
  return `COPY public."${block.table}" (${block.columns.map((name) => `"${name}"`).join(", ")}) FROM ${source}`;
}
