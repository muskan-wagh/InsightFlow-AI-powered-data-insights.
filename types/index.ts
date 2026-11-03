// ── Dataset profiling ─────────────────────────────────────────────────────
export type ColumnKind = "integer" | "decimal" | "date" | "datetime" | "boolean" | "text" | "categorical"

export interface ColumnProfile {
  /** Original header as written in the CSV */
  originalName: string
  /** Sanitized identifier used in DuckDB (see sanitizeIdentifier) */
  queryName: string
  kind: ColumnKind
  /** null/empty cells in the column */
  missing: number
  missingPercent: number
  distinct: number
  /** percent of rows duplicating an earlier value in this column */
  duplicatePercent: number
  min?: number
  max?: number
  mean?: number
  median?: number
  stdDev?: number
  /** ISO range for date columns */
  minDate?: string
  maxDate?: string
  samples: string[]
  /** distinct count capped — categories worth charting */
  isCategory?: boolean
  /** pct of zeros when numeric */
  zeros?: number
}

export interface DatasetProfile {
  rowCount: number
  columnCount: number
  /** number of identical duplicate data rows (excluding first occurrence) */
  duplicateRows: number
  /** rows with at least one missing value */
  rowsWithMissing: number
  /** bytes of original file */
  byteSize: number
  /** quality score 0-100 */
  qualityScore: number
  issues: string[]
  columns: ColumnProfile[]
  hasHeader: boolean
  generatedColumnNames: boolean
}

// ── Charts ───────────────────────────────────────────────────────────────
export type ChartKind = "bar" | "line" | "area" | "pie" | "scatter"

export interface ChartSpec {
  kind: ChartKind
  /** column key for categorical / x axis */
  x: string
  /** column key for numeric / y axis */
  y: string
  /** optional second numeric series (scatter bubble not needed) */
  series?: string[]
  xLabel?: string
  yLabel?: string
  title?: string
}

export interface QueryResult {
  columns: string[]
  rows: ResultRow[]
  rowCount: number
  /** true when the full result set was truncated by MAX_RESULT_ROWS */
  truncated: boolean
  durationMs: number
  executedSql: string
  rawSql: string
}

type Primitive = string | number | boolean | null
export type ResultRow = Record<string, Primitive>

// ── Chat / analysis pipeline ────────────────────────────────────────────
export interface ChatColumn {
  name: string
  queryName: string
  kind: ColumnKind
  /** DuckDB DESC type as materialized, e.g. BIGINT, VARCHAR, DATE */
  duckType: string
  missing: number
  distinct: number
  min?: number
  max?: number
  minDate?: string
  maxDate?: string
  samples: string[]
}

export interface DatasetSummary {
  id: string
  name: string
  tableName: string
  rowCount: number
  columnCount: number
  byteSize: number
  profile?: DatasetProfile
  columns?: ChatColumn[]
}

export interface AnalysisMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  datasetId?: string
  status?: "streaming" | "done" | "error"
  result?: QueryResult
  chart?: ChartSpec | null
  sql?: string
  takeaways?: string[]
  error?: string
  kind?: "analysis" | "clarification" | "insights" | "anomalies"
}

export interface ChatSession {
  id: string
  title: string
  datasetIds: string[]
  createdAt: number
  updatedAt: number
  messages: AnalysisMessage[]
}

// ── Anomalies ───────────────────────────────────────────────────────────
export type AnomalyMethod = "iqr" | "z-score" | "both"

export interface AnomalyRecord {
  rowId: number
  value: number
  column: string
  method: AnomalyMethod
  zScore: number
  /** distance from the median, in IQR fence multiples */
  fenceExceedance: number
  bound: number
  lowerBound?: number
  upperBound?: number
  row?: ResultRow
}

export interface NumericAnomalyReport {
  column: string
  method: AnomalyMethod
  count: number
  proportion: number
  lowerBound?: number
  upperBound?: number
  q1: number
  q3: number
  median: number
  mean: number
  stdDev: number
  records: AnomalyRecord[]
}

export interface AnomalyScanReport {
  datasetId: string
  datasetName: string
  scanned: string[]
  reports: NumericAnomalyReport[]
  totalFlaggedRows: number
  scannedAt: number
}

// ── Insights ────────────────────────────────────────────────────────────
export interface KpiCard {
  label: string
  value: number
  formatted: string
  /** column it is computed from */
  source: string
  deltaPercent?: number
  sigmaNote?: string
}

export interface CategoryBreakdown {
  dimension: string
  measure: string
  title: string
  values: { name: string; value: number }[]
  caption?: string
}

export interface TrendSeries {
  title: string
  dimension: string
  measure: string
  points: { date: string; value: number }[]
  direction: "up" | "down" | "flat"
  changePercent?: number
  caption?: string
}

export interface InsightReport {
  datasetId: string
  kpis: KpiCard[]
  breakdowns: CategoryBreakdown[]
  trends: TrendSeries[]
  narrative?: string
  generatedAt: number
  dataMissingNarrative?: boolean
}

// ── Misc ────────────────────────────────────────────────────────────────
export interface UploadIssue {
  file: string
  code: string
  message: string
}
