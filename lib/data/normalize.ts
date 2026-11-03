import type { ColumnProfile, DatasetProfile } from "@/types"
import Papa from "papaparse"

/**
 * Rebuilds the CSV so that DuckDB sees exactly the identifiers and value
 * formats the profiler detected. Values that cannot be normalized become
 * empty (-> NULL on ingest); these mismatches are counted and reported.
 */
export function duckTypeForKind(kind: ColumnProfile["kind"]): string {
  switch (kind) {
    case "integer":
      return "BIGINT"
    case "decimal":
      return "DOUBLE"
    case "date":
      return "DATE"
    case "datetime":
      return "TIMESTAMP"
    case "boolean":
      return "BOOLEAN"
    default:
      return "VARCHAR"
  }
}

/**
 * Normalizes a cell to a plain number string.
 * Returns the value unchanged when it is already normalized.
 * Returns `null` when parsing fails (the cell will load as NULL).
 */
export function normalizeNumeric(raw: string): string | null {
  let v = (raw ?? "").trim()
  if (!v) return ""
  let negative = /^\(.*\)$/.test(v)
  v = v.replace(/[()]/g, "").trim()
  v = v.replace(/[$€£¥₹\s]/g, "")
  v = v.replace(/,/g, "")
  if (v.endsWith("%")) v = v.slice(0, -1)
  if (negative && !v.startsWith("-")) v = `-${v}`
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return null
  const num = Number(v)
  if (!Number.isFinite(num)) return null
  return String(num)
}

const BOOL_TRUE = /^(true|yes|t|y|1)$/i
const BOOL_FALSE = /^(false|no|f|n|0)$/i

/**
 * Returns an ISO date (yyyy-mm-dd) or ISO datetime string, or null when the
 * value can't be parsed. Calendar dates are reconstructed from local wall
 * time so dates never shift (except for tz-explicit values, which keep UTC).
 */
export function normalizeWhen(raw: string, datetime: boolean): string | null {
  const v = (raw ?? "").trim()
  if (!v) return null

  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(v)
  const isoLike = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}(:\d{2})?(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)
  if (plainDate) return v
  if (isoLike) {
    // Contains an explicit timezone (Z or ±hh:mm) → trust UTC fields
    if (/Z$/i.test(v) || /[+-]\d{2}:?\d{2}$/.test(v)) {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) return null
      return datetime ? `${utcStamp(d).slice(0, 13)}` : v.slice(0, 10)
    }
    // Wall-clock ISO (no tz): parse and re-format exactly as given
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return datetime ? localStamp(d, /\d{2}:\d{2}/.test(v) ? 16 : 10) : v.slice(0, 10)
  }

  const d = Date.parse(v)
  if (Number.isNaN(d)) return null
  return localStamp(new Date(d), datetime ? 16 : 10)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}
function localStamp(d: Date, slice: number): string {
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${
    slice > 10 ? `T${pad(d.getHours())}:${pad(d.getMinutes())}` : ""
  }`
  return s
}
function utcStamp(d: Date, slice = 19): string {
  const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${
    slice > 10 ? `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ""
  }`
  return s
}

export interface IngestBundle {
  csv: string
  columnTypes: { name: string; duckType: string }[]
  warnings: string[]
}

/**
 * Builds the DuckDB-ready CSV: sanitized headers, values normalized to the
 * target types wherever the data actually supports them.
 */
export function buildIngestCsv(headers: string[], rows: string[][], profile: DatasetProfile): IngestBundle {
  const warnings: string[] = []
  const columnTypes = profile.columns.map((c) => ({
    name: c.queryName === "__rowid" ? "__rowid_user" : c.queryName,
    duckType: duckTypeForKind(c.kind),
  }))

  const outRows = rows.map((row) => {
    const out: string[] = new Array(headers.length).fill("")
    for (let i = 0; i < columnTypes.length; i++) {
      const col = profile.columns[i]
      const raw = row[i] ?? ""
      switch (col.kind) {
        case "integer":
        case "decimal": {
          const n = normalizeNumeric(raw)
          out[i] = n === null ? "" : n
          break
        }
        case "boolean": {
          const v = raw.trim()
          out[i] = BOOL_TRUE.test(v) ? "true" : BOOL_FALSE.test(v) ? "false" : ""
          break
        }
        case "date": {
          out[i] = normalizeWhen(raw, false) ?? ""
          break
        }
        case "datetime": {
          out[i] = normalizeWhen(raw, true) ?? ""
          break
        }
        default:
          out[i] = raw
      }
    }
    return out
  })

  // Report un-parseable cells in numeric columns (they load as NULL)
  for (let i = 0; i < profile.columns.length; i++) {
    const col = profile.columns[i]
    if (col.kind !== "integer" && col.kind !== "decimal") continue
    let bad = 0
    for (const row of rows) {
      const raw = (row[i] ?? "").trim()
      if (raw === "") continue
      if (normalizeNumeric(raw) === null) bad++
    }
    if (bad > 0) {
      warnings.push(
        `${bad} value${bad === 1 ? "" : "s"} in "${col.originalName}" ${bad === 1 ? "is" : "are"} not readable as numbers and loaded as empty.`
      )
    }
  }

  const csv = Papa.unparse({ fields: columnTypes.map((c) => c.name), data: outRows }, { newline: "\n" })
  return { csv, columnTypes, warnings }
}
