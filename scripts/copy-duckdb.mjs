// Copies the DuckDB-Wasm browser bundle into /public so the app loads it
// locally instead of depending on a CDN at runtime.
import { cpSync, mkdirSync, existsSync, constants, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = join(root, "..");
const src = join(pkg, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const dest = join(pkg, "public", "duckdb-wasm");

if (!existsSync(src)) {
  console.warn("[copy-duckdb] @duckdb/duckdb-wasm not installed yet — skipping.");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, force: true, errorOnExist: false, mode: constants.COPYFILE_FICLONE });

console.log("[copy-duckdb] bundle ->", dest);
