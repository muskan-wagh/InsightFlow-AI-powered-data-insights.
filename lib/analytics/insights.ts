import type { CategoryBreakdown, DatasetSummary, InsightReport, KpiCard, TrendSeries } from "@/types"
import { runTrustedSql } from "@/lib/data/duckdb"

const NUMERIC_TYPES = new Set(["bigint", "double", "integer", "hugeint", "decimal", "float", "smallint", "tinyint", "real", "int"])

const MEASURE_KEYWORDS = [
  "revenue", "sales", "amount", "total", "value", "profit", "spend", "cost",
  "price", "quantity", "qty", "units", "ltv", "salary", "expense", "income",
]

function isNumericType(t: string): boolean {
  return NUMERIC_TYPES.has(t.toLowerCase()) || t.toLowerCase().startsWith("numeric")
}

function scoreMeasure(col: { name: string; type: string; distinct: number }): number {
  if (!isNumericType(col.type)) return -1
  const lower = col.name.toLowerCase()
  if (lower === "__rowid") return -1
  let score = 0
  MEASURE_KEYWORDS.forEach((kw, i) => {
    if (lower.includes(kw)) score += MEASURE_KEYWORDS.length - i
  })
  score += col.distinct > 24 ? 1 : 0
  return score
}

function compact(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}K`
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export interface InsightBuildOptions {
  /** limit per-breakdown rows */
  maxCategories?: number
  maxBreakdowns?: number
}

/**
 * Builds the insights dashboard report with REAL aggregate SQL over the
 * dataset's DuckDB table. Every number shown was executed by the engine.
 */
export async function generateInsightReport(
  ds: Pick<DatasetSummary, "id" | "name" | "tableName"> &
    { columns: { name: string; type: string; distinct: number; missing: number }[] },
  options: InsightBuildOptions = {}
): Promise<InsightReport | null> {
  const maxCategories = options.maxCategories ?? 12
  const maxBreakdowns = options.maxBreakdowns ?? 3
  const t = `"${ds.tableName}"`

  const numericCols = ds.columns.filter((c) => isNumericType(c.type) && c.name !== "__rowid")
  const categoryCols = ds.columns.filter(
    (c) =>
      (c.type.toLowerCase().startsWith("varchar") || c.type.toLowerCase() === "boolean") &&
      c.distinct >= 2 &&
      c.distinct <= 24 &&
      c.name !== "__rowid"
  )
  const dateCols = ds.columns.filter(
    (c) => c.type.toLowerCase() === "date" || c.type.toLowerCase().startsWith("timestamp")
  )

  const rankedMeasures = numericCols
    .map((c) => ({ ...c, score: scoreMeasure(c) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score)
  const measures = rankedMeasures.length > 0 ? rankedMeasures.slice(0, 3) : numericCols.slice(0, 1)
  if (measures.length === 0) return null

  const main = measures[0]
  const needle = `"${main.name}"`

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis: KpiCard[] = []
  try {
    const res = await runTrustedSql(`
      SELECT
        COUNT(*) AS row_count,
        SUM(${needle}) AS sum_v,
        AVG(${needle}) AS avg_v,
        MIN(${needle}) AS min_v,
        MAX(${needle}) AS max_v,
        quantile_cont(${needle}, 0.5) AS median_v
      FROM ${t}`)
    const r = res.rows[0] as Record<string, number | null>
    kpis.push({ label: "Total rows", value: Number(r.row_count ?? 0), formatted: Number(r.row_count ?? 0).toLocaleString(), source: "*" })
    kpis.push({ label: `Total ${main.name}`, value: Number(r.sum_v ?? 0), formatted: compact(Number(r.sum_v ?? 0)), source: main.name })
    kpis.push({ label: `Average ${main.name}`, value: Number(r.avg_v ?? 0), formatted: compact(Number(r.avg_v ?? 0)), source: main.name })
    if (r.median_v != null) {
      kpis.push({
        label: `Median ${main.name}`,
        value: Number(r.median_v),
        formatted: compact(Number(r.median_v)),
        source: main.name,
        sigmaNote: `min ${compact(Number(r.min_v ?? 0))} · max ${compact(Number(r.max_v ?? 0))}`,
      })
    }
  } catch {
    // dataset may have been removed mid-scan
    return null
  }

  // ── Breakdowns: category × main measure ─────────────────────────────────
  const breakdowns: CategoryBreakdown[] = []
  const dimensionPool = [
    ...categoryCols.filter((c) => /region|country|state|city|category|segment|channel|type|product|department/.test(c.name.toLowerCase())),
    ...categoryCols.filter((c) => !/region|country|state|city|category|segment|channel|type|product|department/.test(c.name.toLowerCase())),
  ].slice(0, maxBreakdowns)

  for (const dim of dimensionPool) {
    const dName = `"${dim.name}"`
    try {
      const res = await runTrustedSql(`
        SELECT CAST(${dName} AS VARCHAR) AS name, SUM(${needle}) AS value
        FROM ${t}
        WHERE ${dName} IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT ${maxCategories}`)
      const values = res.rows
        .map((r) => {
          const rec = r as Record<string, unknown>
          return {
            name: String(rec.name ?? "(other)"),
            value: Number(rec.value ?? 0),
          }
        })
        .filter((v) => Number.isFinite(v.value))
      if (values.length < 2) continue
      const total = values.reduce((a, b) => a + Math.abs(b.value), 0)
      const top = Math.max(...values.map((v) => Math.abs(v.value)))
      const share = total > 0 ? (top / total) * 100 : 0
      breakdowns.push({
        dimension: dim.name,
        measure: main.name,
        title: `${main.name} by ${dim.name}`,
        values,
        caption:
          total > 0
            ? `${values[0].name} leads with ${share.toFixed(1)}% of total ${main.name}.`
            : undefined,
      })
    } catch {
      // skip dimension on query failure
    }
  }

  // ── Trend over time ─────────────────────────────────────────────────────
  const trends: TrendSeries[] = []
  const dateDim = dateCols[0]
  if (dateDim) {
    const dExpr = dateDim.type.toLowerCase() === "date" ? `"${dateDim.name}"` : `CAST("${dateDim.name}" AS DATE)`
    try {
      const res = await runTrustedSql(`
        SELECT DATE_TRUNC('month', CAST(COALESCE(${dExpr}, DATE '1970-01-01') AS DATE)) AS month,
               SUM(${needle}) AS value
        FROM ${t}
        WHERE ${dExpr} IS NOT NULL
        GROUP BY 1 ORDER BY 1`)
      const points = res.rows
        .map((r) => {
          const rec = r as Record<string, unknown>
          const v = Number(rec.value ?? 0)
          return { date: String(rec.month ?? "").slice(0, 10), value: v }
        })
        .filter((p) => Number.isFinite(p.value) && p.date && p.date !== "1970-01-01")
      if (points.length >= 2) {
        const first = points[0].value
        const last = points[points.length - 1].value
        const changePercent = first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : undefined
        trends.push({
          title: `${main.name} trend by month (${dateDim.name})`,
          dimension: dateDim.name,
          measure: main.name,
          points,
          direction: last > first ? "up" : last < first ? "down" : "flat",
          changePercent,
          caption: `${points.length} months · ${first > 0 && last > first ? "growing" : "decreasing"} trend${
            changePercent !== undefined ? ` (${changePercent > 0 ? "+" : ""}${changePercent}%)` : ""
          }`,
        })
      }
    } catch {
      // skip trend on failure
    }
  }

  return {
    datasetId: ds.id,
    kpis,
    breakdowns,
    trends,
    generatedAt: Date.now(),
    dataMissingNarrative: true,
  }
}

/** Compact JSON summary of an insight report, for LLM narration. */
export function reportNarrativePayload(report: InsightReport): unknown {
  return {
    kpis: report.kpis.map((k) => ({ label: k.label, value: k.formatted })),
    breakdowns: report.breakdowns.map((b) => ({
      title: b.title,
      values: b.values.slice(0, 8),
    })),
    trends: report.trends.map((tr) => ({
      title: tr.title,
      changePercent: tr.changePercent,
      first: tr.points[0]?.value,
      last: tr.points[tr.points.length - 1]?.value,
      min: Math.min(...tr.points.map((p) => p.value)),
      max: Math.max(...tr.points.map((p) => p.value)),
    })),
  }
}
