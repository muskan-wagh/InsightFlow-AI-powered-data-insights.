import type { ColumnKind, ColumnProfile, DatasetProfile } from "@/types"

/** identifiers the engine reserves for itself */
const RESERVED_IDENTIFIERS = new Set(["__rowid"])

export function sanitizeIdentifier(name: string, index: number): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
  if (cleaned === "") return `column_${index + 1}`
  const base = /^[0-9]/.test(cleaned) ? `c_${cleaned}` : cleaned
  return RESERVED_IDENTIFIERS.has(base) ? `${base}_user` : base
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}(T| )\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
const NUMBER_RE = /^-?(\d+[\d,]*(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/
const INT_RE = /^-?\d{1,15}$/
const BOOL_RE = /^(true|false|yes|no|t|f|y|n)$/i
const PERC_RE = /^-?\d+(\.\d+)?%$/
const MONEY_RE = /^[$€£¥]\s*-?\d[\d,]*(\.\d+)?$|^-?\d[\d,]*(\.\d+)?\s?[$€£¥]/

function classifyColumn(values: string[], hasMissing: boolean, columnName = ""): ColumnKind {
  const present = values.filter((v) => v !== "")
  if (present.length === 0) return "text"

  const sample = present.slice(0, 250) // classify on a sample; stays fast on big files
  let numberHits = 0
  let intHits = 0
  let boolHits = 0
  let dateHits = 0
  let datetimeHits = 0
  let moneyHits = 0
  let percHits = 0

  for (const v of sample) {
    if (INT_RE.test(v)) {
      intHits++; numberHits++
    } else if (NUMBER_RE.test(v.replace(/,/g, ""))) {
      numberHits++
    }
    if (BOOL_RE.test(v)) boolHits++
    if (DATE_RE.test(v)) dateHits++
    if (DATETIME_RE.test(v) && ISO_DT_RE.test(v.trim())) datetimeHits++
    if (MONEY_RE.test(v)) { moneyHits++; numberHits++ }
    if (PERC_RE.test(v)) { percHits++; numberHits++ }
  }

  const n = sample.length
  if (dateHits / n >= 0.8) return "date"
  if (datetimeHits / n >= 0.8) return "datetime"
  if (boolHits / n >= 0.98) return "boolean"
  if (numberHits / n >= 0.8) return intHits / n >= 0.8 ? "integer" : "decimal"

  // Numeric info encoded in formatting still counts if mostly numbers
  if ((numberHits || moneyHits || percHits) && (numberHits + moneyHits + percHits) / n >= 0.8) {
    return "decimal"
  }

  const distinct = new Set(present.map((v) => v.toLowerCase())).size
  // identifier-like columns (order_id, customer_id, id…) stay text — they are
  // unique keys, not analytical categories
  const idLike = /(^|_)(id|uuid|guid|code|sku|zip|postal)$/i.test(columnName) || /^id$/i.test(columnName)
  if (n >= 8 && distinct <= Math.max(18, n * 0.08) && !idLike) return "categorical"
  return "text"
}

function toNumber(raw: string): number | null {
  if (raw == null) return null
  let v = raw.trim()
  if (v === "") return null
  const money = v.match(MONEY_RE)
  if (money) v = v.replace(/[$€£¥\s]/g, "")
  const perc = v.endsWith("%")
  if (perc) v = v.slice(0, -1)
  v = v.replace(/,/g, "")
  const num = Number(v)
  if (Number.isNaN(num)) return null
  return perc ? num / 100 : num
}

function parseDate(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (DATETIME_RE.test(v)) return v.replace(" ", "T").slice(0, 16)
  if (DATE_RE.test(v)) return v
  const d = Date.parse(v)
  if (!Number.isNaN(d) && /\d{4}/.test(v) && /[A-Za-z\/]/.test(v)) return new Date(d).toISOString().slice(0, 10)
  return null
}

const quantile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}

function columnValues(rows: string[][], col: number): string[] {
  return rows.map((r) => (r[col] ?? "").trim())
}

function profileColumn(
  originalName: string,
  queryName: string,
  values: string[],
  kind: ColumnKind
): ColumnProfile {
  const present = values.filter((v) => v !== "")
  const missing = values.length - present.length
  const lowered = new Set(present.map((v) => v.toLowerCase()))
  const distinct = lowered.size
  const duplicatePercent = values.length ? ((values.length - lowered.size) / values.length) * 100 : 0

  const base: ColumnProfile = {
    originalName,
    queryName,
    kind,
    missing,
    missingPercent: values.length ? (missing / values.length) * 100 : 0,
    distinct,
    duplicatePercent: Math.max(0, duplicatePercent),
    samples: Array.from(new Set(present)).slice(0, 5),
  }

  if (kind === "integer" || kind === "decimal") {
    const nums = present.map(toNumber).filter((v): v is number => v !== null)
    if (nums.length > 0) {
      const sorted = [...nums].sort((a, b) => a - b)
      const sum = nums.reduce((a, b) => a + b, 0)
      const mean = sum / nums.length
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length > 1 ? nums.length - 1 : 1)
      base.min = sorted[0]
      base.max = sorted[sorted.length - 1]
      base.mean = mean
      base.median = quantile(sorted, 0.5)
      base.stdDev = Math.sqrt(variance)
      base.zeros = nums.filter((v) => v === 0).length
    }
  }
  if (kind === "date" || kind === "datetime") {
    const dates = present.map(parseDate).filter((v): v is string => v !== null).sort()
    if (dates.length) {
      base.minDate = dates[0]
      base.maxDate = dates[dates.length - 1]
    }
  }
  if (kind === "categorical" || kind === "boolean") {
    base.isCategory = present.length > 0 && distinct <= 24
  }
  return base
}

/**
 * Profiles a parsed dataset: column kinds, missing/duplicate stats, numeric
 * summaries, dataset-level quality signals.
 */
export function profileDataset(headers: string[], rows: string[][], byteSize = 0): DatasetProfile {
  const columnCount = headers.length
  const rowCount = rows.length

  const used = new Map<string, number>()
  const columns: ColumnProfile[] = headers.map((h, i) => {
    const base = sanitizeIdentifier(h, i)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return profileColumn(h, count === 0 ? base : `${base}_${count + 1}`, columnValues(rows, i), "text")
  })

  // First pass to classify consistently (kind affects stats)
  columns.forEach((col, i) => {
    const values = columnValues(rows, i)
    col.kind = classifyColumn(values, col.missing > 0, col.queryName)
    Object.assign(col, profileColumn(col.originalName, col.queryName, values, col.kind))
  })

  const duplicateRows = new Set(rows.map((r) => r.join("‹cell›"))).size
  const dupCount = rowCount - duplicateRows
  const rowsWithMissing = rows.filter((r) => r.some((c) => c === "")).length

  const issues: string[] = []
  for (const col of columns) {
    if (col.missing > 0) {
      issues.push(
        `“${col.originalName}” has ${col.missing} missing value${col.missing > 1 ? "" : ""} (${col.missingPercent.toFixed(1)}%).`
      )
    }
    if (col.kind === "integer" && col.stdDev !== undefined && col.mean !== undefined && col.stdDev > 0) {
      // hint only; anomaly module does the real statistics
    }
  }
  if (dupCount > 0) issues.push(`${dupCount} exact duplicate row${dupCount > 1 ? "" : ""} found.`)
  if (rowCount < 5) issues.push("Dataset is very small (< 5 rows); statistics may not be meaningful.")

  const missingTotal = columns.reduce((a, c) => a + c.missing, 0)
  const totalCells = Math.max(1, rowCount * columnCount)
  const completeness = 1 - missingTotal / totalCells
  const uniqueness = rowCount === 0 ? 1 : (rowCount - dupCount) / rowCount
  const consistency = columns.filter((c) => c.kind !== "text").length / Math.max(1, columnCount)
  const qualityScore = Math.round(Math.min(100, Math.max(0, (completeness * 0.5 + uniqueness * 0.3 + consistency * 0.2) * 100)))

  return {
    rowCount,
    columnCount,
    duplicateRows: dupCount,
    rowsWithMissing,
    byteSize,
    qualityScore,
    issues,
    columns,
    hasHeader: true,
    generatedColumnNames: headers.some((h) => /^column_\d+$/.test(h)) && headers.length > 0,
  }
}
