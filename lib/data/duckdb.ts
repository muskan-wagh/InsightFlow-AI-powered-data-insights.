import * as duckdb from "@duckdb/duckdb-wasm"

interface ArrowSchemaField {
  name: string
  type: unknown
}
/** Minimal structural type for the Apache Arrow table DuckDB-Wasm returns. */
export interface ArrowTable {
  schema: { fields: ArrowSchemaField[] }
  toArray?: () => unknown[]
}

/** WebAssembly.Exception is only in newer TS DOM libs — probe safely. */
const EH_SUPPORTED = (() => {
  try {
    return typeof WebAssembly !== "undefined" && typeof (WebAssembly as unknown as Record<string, unknown>).Exception === "function"
  } catch {
    return false
  }
})()

export type ArrowKind = "number" | "date" | "datetime" | "string" | "boolean" | "other"

export interface QueryOutput<T = Record<string, unknown>> {
  rows: T[]
  columns: { name: string; kind: ArrowKind }[]
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let connection: duckdb.AsyncDuckDBConnection | null = null

function localBundles(): LocalBundle {
  const base = "/duckdb-wasm"
  if (EH_SUPPORTED) {
    return {
      mainModule: `${base}/duckdb-eh.wasm`,
      mainWorker: `${base}/duckdb-browser-eh.worker.js`,
      pthreadWorker: `${base}/duckdb-browser-eh.pthread.worker.js`,
    }
  }
  return {
    mainModule: `${base}/duckdb-mvp.wasm`,
    mainWorker: `${base}/duckdb-browser-mvp.worker.js`,
  }
}

interface LocalBundle {
  mainModule: string
  mainWorker: string
  pthreadWorker?: string
}

/** Lazily starts the DuckDB-Wasm web worker and opens a shared connection. */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("DuckDB-Wasm runs in the browser only."))
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = localBundles()
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
      const worker = new Worker(bundle.mainWorker)
      const db = new duckdb.AsyncDuckDB(logger, worker)
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      return db
    })().catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  const db = await getDuckDB()
  if (!connection) {
    connection = await db.connect()
    try {
      // Cap resources so heavy SQL doesn't freeze modest machines.
      const threads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
      await connection.query(`SET threads=${threads}`)
      await connection.query(`SET memory_limit='1.2GB'`)
      await connection.query(`SET preserve_insertion_order=false`)
    } catch {
      // tolerate engine versions without some settings
    }
  }
  return connection
}

/** Quote a SQL identifier safely. */
export function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/**
 * Registers CSV bytes in the DuckDB virtual FS and materializes a real table.
 * All source columns are loaded as VARCHAR, then TRY_CAST per profiled column
 * makes the resulting schema deterministic even with messy columns.
 */
export async function ingestCsvFile(
  tableName: string,
  fileName: string,
  csvText: string,
  columnDefinitions: { name: string; duckType: string }[]
): Promise<{ columnTypes: { name: string; type: string }[] }> {
  const db = await getDuckDB()
  const conn = await getConnection()
  await listTables().then((tables) => {
    if (tables.includes(tableName.toLowerCase())) {
      return conn.query(`DROP TABLE ${q(tableName)}`)
    }
    return undefined
  })

  const bytes = new TextEncoder().encode(csvText)
  await db.registerFileBuffer(fileName, new Uint8Array(bytes.buffer))

  const casts = columnDefinitions
    .map((c) => `TRY_CAST(${q(c.name)} AS ${c.duckType}) AS ${q(c.name)}`)
    .join(",\n  ")
  if (!columnDefinitions.length) {
    throw new Error("Dataset has no columns to load.")
  }
  await conn.query(
    `CREATE TABLE ${q(tableName)} AS
     SELECT row_number() OVER () AS __rowid,
            ${casts}
     FROM read_csv_auto('${fileName}', header=true, all_varchar=true, sample_size=20000)`
  )
  return { columnTypes: await describeTable(tableName) }
}

/** Drops a table when it exists (used by re-upload and dataset removal). */
export async function dropTable(tableName: string): Promise<void> {
  const tables = await listTables()
  if (tables.includes(tableName.toLowerCase())) {
    const conn = await getConnection()
    await conn.query(`DROP TABLE ${q(tableName)}`)
  }
}

export async function listTables(): Promise<string[]> {
  const conn = await getConnection()
  const res = await runTrustedSql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE'`
  )
  return res.rows.map((r) => String((r as Record<string, unknown>).table_name)).map((t) => t.toLowerCase())
}

export async function describeTable(tableName: string): Promise<{ name: string; type: string }[]> {
  const res = await runTrustedSql(`DESCRIBE ${q(tableName)}`)
  return res.rows.map((r) => {
    const rec = r as Record<string, unknown>
    return { name: String(rec.column_name), type: String(rec.column_type ?? "unknown") }
  })
}

/** Internal (trusted) SQL execution — used by the module's own analytics. */
export async function runTrustedSql<T = Record<string, unknown>>(sql: string): Promise<QueryOutput<T>> {
  const conn = await getConnection()
  const res = (await conn.query(sql)) as unknown as ArrowTable
  return arrowToJson<T>(res)
}

export function arrowKind(type: unknown): ArrowKind {
  const name = (type as { constructor?: { name?: string } })?.constructor?.name ?? ""
  const lower = name.toLowerCase()
  if (lower.startsWith("timestamp")) return "datetime"
  if (lower.startsWith("date")) return "date"
  if (
    lower.startsWith("int") ||
    lower.includes("bigint") ||
    lower.includes("float") ||
    lower.includes("double") ||
    lower.includes("decimal") ||
    lower.startsWith("uint")
  ) {
    return "number"
  }
  if (lower.startsWith("utf8") || lower.includes("string")) return "string"
  if (lower.startsWith("bool")) return "boolean"
  return "other"
}

function normalizeArrowValue(value: unknown, kind: ArrowKind): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    // DuckDB returns DATE/TIMESTAMP as local-time Date; normalize to ISO.
    const iso = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString()
    return kind === "datetime" ? iso.slice(0, 16) : iso.slice(0, 10)
  }
  if (typeof value === "bigint") return Number(value)
  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : String(value)
  }
  return value
}

/** Converts an Arrow result table into plain JSON rows + column kinds. */
export function arrowToJson<T = Record<string, unknown>>(table: ArrowTable): QueryOutput<T> {
  const columns = table.schema.fields.map((f) => ({ name: String(f.name), kind: arrowKind(f.type) }))
  const rawRows = (table.toArray?.() ?? []) as unknown as Record<string, unknown>[]
  const rows = rawRows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) {
      out[col.name] = normalizeArrowValue(r[col.name], col.kind)
    }
    return out as T
  })
  return { rows, columns }
}
