import type { ArrowKind } from "@/lib/data/duckdb"
import type { ChartKind, ChartSpec, ResultRow } from "@/types"

export interface ResultColumn {
  name: string
  kind: ArrowKind | string
}

type ColKind = "number" | "date" | "datetime" | "string" | "boolean" | "other"

function kind(nameCol: ResultColumn): ColKind {
  const k = nameCol.kind
  return (k === "number" || k === "date" || k === "datetime" || k === "string" || k === "boolean" || k === "other") ? k : "other"
}

/**
 * Deterministic visualization selection from the ACTUAL query result shape
 * (column kinds + row structure). Used standalone and as a validated fallback
 * when the LLM's chart hint doesn't match the data.
 */
export function pickChart(columns: ResultColumn[], rows: ResultRow[]): ChartSpec | null {
  if (columns.length === 0 || rows.length === 0) return null

  const dateCol = columns.find((c) => kind(c) === "date" || kind(c) === "datetime")
  // Prefer trailing numeric columns (ids like __rowid come first)
  const numericCols = columns.filter((c) => kind(c) === "number")
  const stringCols = columns.filter((c) => kind(c) === "string" || kind(c) === "boolean")
  const catCol = stringCols.find((c) => {
    const distinct = new Set(rows.map((r) => String(r[c.name] ?? ""))).size
    return distinct >= 2 && distinct <= Math.max(24, rows.length)
  })

  // 1. Trend: date/datetime on one axis + numeric measure → line
  if (dateCol && numericCols.length >= 1 && rows.length >= 2) {
    return {
      kind: "line",
      x: dateCol.name,
      y: numericCols[0].name,
      title: `${numericCols[0].name} over ${dateCol.name}`,
    }
  }

  // 2. Two numerics → scatter
  if (numericCols.length >= 2 && stringCols.length === 0) {
    return { kind: "scatter", x: numericCols[0].name, y: numericCols[1].name }
  }

  // 3. Category + numeric → pie (few slices) or bar
  if (catCol && numericCols.length >= 1) {
    const distinct = new Set(rows.map((r) => String(r[catCol.name] ?? ""))).size
    if (distinct <= 6 && rows.length <= 12) {
      const total = rows.reduce((a, r) => a + Math.abs(Number(r[numericCols[0].name] ?? 0)), 0)
      if (total > 0) {
        return { kind: "pie", x: catCol.name, y: numericCols[0].name }
      }
    }
    return { kind: "bar", x: catCol.name, y: numericCols[0].name }
  }

  // 4. Numbers only (e.g. rank lists where the label is a number)
  if (numericCols.length === 1) {
    if (rows.length === 1) return null
    return { kind: "bar", x: columns[0].name, y: numericCols[0].name }
  }

  // diversified fallback: first numeric as y, first string/date as x
  if (numericCols.length >= 2 && stringCols.length === 0 && rows.length <= 8) {
    return { kind: "bar", x: numericCols[0].name, y: numericCols[1].name }
  }

  return null
}

/** Validates an LLM-proposed chart against the actual executed result. */
export function validateChartSpec(spec: unknown, columns: ResultColumn[], rows: ResultRow[]): ChartSpec | null {
  if (typeof spec !== "object" || spec === null) return null
  const s = spec as { kind?: string; x?: string; y?: string; title?: string }
  if (!s.kind || !s.x) return null
  if (!["bar", "line", "area", "pie", "scatter"].includes(s.kind)) return null
  const names = new Set(columns.map((c) => c.name))
  if (!names.has(s.x)) return null
  if (s.y && !names.has(s.y)) return null
  if (!s.y) {
    const numeric = columns.find((c) => c.kind === "number")
    if (!numeric) return null
    s.y = numeric.name
  }
  const fallback = pickChart(columns, rows)
  return {
    kind: s.kind as ChartKind,
    x: s.x,
    y: s.y,
    title: typeof s.title === "string" && s.title.length < 120 ? s.title : undefined,
  } satisfies ChartSpec
}
