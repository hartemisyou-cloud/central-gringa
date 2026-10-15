import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

async function main() {
  const input = process.argv[2];
  if (!input || process.argv[3] !== "--apply") throw new Error("Usage: node scripts/upload-ebooks.mjs /private/ebook-directory --apply");
  const folder = await realpath(resolve(input));
  const project = await realpath(new URL("../", import.meta.url));
  const outside = (from, to) => { const path = relative(from, to); return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path); };
  if (!outside(project, folder)) throw new Error("Keep private book files outside the source repository.");
  if (!process.env["BLOB_READ_WRITE_TOKEN"] && !process.env["VERCEL_OIDC_TOKEN"]) throw new Error("Private Blob authentication is required.");
  const manifest = JSON.parse(await readFile(new URL("../docs/catalog/hope-human-books-provenance.json", import.meta.url), "utf8"));
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  const files = [];
  for (const work of manifest) {
    if (!/^[a-z0-9-]+\.txt$/.test(work.file)) throw new Error("Invalid catalog pathname.");
    const path = await realpath(resolve(folder, work.file));
    if (outside(folder, path)) throw new Error("Book path escapes the reviewed directory.");
    const bytes = await readFile(path);
    if (bytes.length !== work.bytes || hash(bytes) !== work.sha256) throw new Error(`Source file verification failed: ${work.file}`);
    files.push({ work, bytes });
  }
  // Verify every source before the first upload. Never overwrite a different file.
  for (const { work, bytes } of files) {
    const pathname = `v1/${work.file}`;
    const existing = await get(pathname, { access: "private" });
    if (existing?.statusCode === 200) {
      const current = Buffer.from(await new Response(existing.stream).arrayBuffer());
      if (current.length !== work.bytes || hash(current) !== work.sha256) throw new Error(`Destination differs; refusing overwrite: ${work.file}`);
    } else {
      await put(pathname, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain; charset=utf-8" });
    }
    const check = await get(pathname, { access: "private", useCache: false });
    if (check?.statusCode !== 200 || hash(Buffer.from(await new Response(check.stream).arrayBuffer())) !== work.sha256) throw new Error(`Destination verification failed: ${work.file}`);
    console.log(`Verified private book: ${work.file}`);
  }
}

main().catch((error) => {
  console.error("Private ebook migration failed.", { code: typeof error?.code === "string" ? error.code : "UPLOAD_FAILED" });
  process.exitCode = 1;
});
