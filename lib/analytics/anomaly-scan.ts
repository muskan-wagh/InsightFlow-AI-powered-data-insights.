import type { AnomalyScanReport, DatasetSummary, NumericAnomalyReport } from "@/types"
import { runTrustedSql } from "@/lib/data/duckdb"
import { columnAnomalyReport } from "@/lib/analytics/anomaly-detection"

const NUMERIC_TYPES = new Set([
  "bigint", "double", "integer", "hugeint", "decimal", "float", "smallint", "tinyint", "real",
])

function isNumericType(t: string): boolean {
  return NUMERIC_TYPES.has(t.toLowerCase()) || t.toLowerCase().startsWith("numeric")
}

/** Scan the most "spread out" numeric columns first — they carry anomalies. */
function rankColumns(
  columns: { name: string; type: string; distinct: number; missing: number }[],
  rowCount: number
) {
  return columns
    .filter((c) => isNumericType(c.type) && c.name !== "__rowid")
    .filter((c) => rowCount - c.missing >= 8)
    .map((c) => ({
      ...c,
      rank:
        (rowCount - c.missing) / (c.distinct + 1) +
        (/quantity|price|amount|value|score|age|revenue/.test(c.name) ? 2 : 0),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 4)
}

/**
 * Runs real statistical anomaly detection (IQR fences + 3σ z-scores) over the
 * dataset's numeric columns using executed queries. Flags are produced only
 * from computed statistics — the LLM is never asked to invent anomalies.
 */
export async function scanDatasetAnomalies(
  ds: Pick<DatasetSummary, "id" | "name" | "tableName"> & {
    columns: { name: string; type: string; distinct: number; missing: number }[]
  },
  rowCount: number
): Promise<AnomalyScanReport> {
  const candidates = rankColumns(ds.columns, rowCount)
  const reports: NumericAnomalyReport[] = []

  for (const col of candidates) {
    try {
      const out = await runTrustedSql(`SELECT __rowid, "${col.name}" FROM "${ds.tableName}"`)
      const values: (number | null)[] = out.rows.map((r) => {
        const v = (r as Record<string, unknown>)[col.name]
        if (v === null || v === undefined) return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      })
      const report = columnAnomalyReport(col.name, values, out.rows as Record<string, unknown>[], {
        method: "both",
        zThreshold: 3,
      })
      if (report) reports.push(report)
    } catch {
      // column might not be numeric in DuckDB — skip it
    }
  }

  const flaggedRows = new Set<number>()
  for (const r of reports) for (const rec of r.records) flaggedRows.add(rec.rowId)
  reports.sort((a, b) => b.count - a.count)

  return {
    datasetId: ds.id,
    datasetName: ds.name,
    scanned: candidates.map((c) => c.name),
    reports,
    totalFlaggedRows: flaggedRows.size,
    scannedAt: Date.now(),
  }
}
