import type { AnomalyMethod, AnomalyRecord, NumericAnomalyReport, ResultRow } from "@/types"

export interface AnomalyConfig {
  method?: AnomalyMethod
  /** z-score threshold when method is z-score (default 3) */
  zThreshold?: number
  /** IQR multiplier (default 1.5) */
  iqrMultiplier?: number
  maxRecords?: number
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b)

export function quantile(values: number[], q: number): number {
  const arr = sorted(values)
  if (arr.length === 0) return NaN
  const pos = (arr.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return arr[base + 1] !== undefined
    ? arr[base] + rest * (arr[base + 1] - arr[base])
    : arr[base]
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
}

export interface DistributionFacts {
  q1: number
  q3: number
  median: number
  mean: number
  stdDev: number
  lowerFence: number
  upperFence: number
  zThreshold: number
}

export function distributionFacts(values: number[], iqrMultiplier = 1.5, zThreshold = 3): DistributionFacts {
  const q1 = quantile(values, 0.25)
  const q3 = quantile(values, 0.75)
  const iqr = q3 - q1
  return {
    q1,
    q3,
    median: quantile(values, 0.5),
    mean: mean(values),
    stdDev: stdDev(values),
    lowerFence: q1 - iqrMultiplier * iqr,
    upperFence: q3 + iqrMultiplier * iqr,
    zThreshold,
  }
}

/**
 * Real statistical anomaly detection over one numeric series.
 *
 * - IQR: value outside [Q1 - k·IQR, Q3 + k·IQR]
 * - Z-score: |value − mean| / σ exceeds the threshold (only used when the
 *   series has enough variance; near-constant series would flag everything)
 *
 * Returns the why: fence values, z-score and plain-language explanation
 * material. The caller attaches row context.
 */
export function detectAnomalies(
  values: (number | null)[],
  config: AnomalyConfig = {}
): { facts: DistributionFacts | null; anomalies: AnomalyRecord[]; method: AnomalyMethod } {
  const method: AnomalyMethod = config.method ?? "iqr"
  const zThreshold = config.zThreshold ?? 3
  const iqrMultiplier = config.iqrMultiplier ?? 1.5
  const maxRecords = config.maxRecords ?? 50

  const indexed = values
    .map((v, rowId) => ({ v, rowId }))
    .filter((x): x is { v: number; rowId: number } => x.v !== null && Number.isFinite(x.v))
  const nums = indexed.map((x) => x.v)

  if (nums.length < Math.max(8, config.zThreshold !== undefined ? 0 : 0) || nums.length < 8) {
    return { facts: null, anomalies: [], method }
  }

  const facts = distributionFacts(nums, iqrMultiplier, zThreshold)
  // z-scores are meaningless on near-constant series
  const zUsable = facts.stdDev > 1e-12 && Number.isFinite(facts.stdDev)

  const useIqr = method === "iqr" || method === "both"
  const useZ = (method === "z-score" || method === "both") && zUsable

  const anomalies: AnomalyRecord[] = []
  for (const { v, rowId } of indexed) {
    const z = zUsable ? (v - facts.mean) / facts.stdDev : 0
    const belowIqr = useIqr && v < facts.lowerFence
    const aboveIqr = useIqr && v > facts.upperFence
    const zExtreme = useZ && Math.abs(z) >= zThreshold

    if (!(belowIqr || aboveIqr || zExtreme)) continue

    const iqrHit = belowIqr || aboveIqr
    const iqrRange = facts.q3 - facts.q1
    const how: AnomalyMethod = iqrHit && zExtreme ? "both" : iqrHit ? "iqr" : "z-score"

    anomalies.push({
      rowId,
      value: v,
      column: "",
      method: how,
      zScore: Number.isFinite(z) ? Math.round(z * 1000) / 1000 : 0,
      fenceExceedance:
        iqrHit && iqrRange > 0
          ? Math.round((Math.abs(v - facts.median) / iqrRange) * 100) / 100
          : 0,
      bound: aboveIqr ? facts.upperFence : facts.lowerFence,
      lowerBound: facts.lowerFence,
      upperBound: facts.upperFence,
    })
  }

  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore) || Math.abs(b.value - a.value))
  if (anomalies.length > maxRecords) anomalies.length = maxRecords

  return { facts, anomalies, method }
}

/** Full-column report with statistics + explanation-ready records. */
export function columnAnomalyReport(
  columnName: string,
  rowValues: (number | null)[],
  rows: Record<string, unknown>[] = [],
  config: AnomalyConfig = {}
): NumericAnomalyReport | null {
  const result = detectAnomalies(rowValues, config)
  if (!result.facts) return null
  const f = result.facts
  const total = rowValues.filter((v) => v !== null && Number.isFinite(v)).length
  const anomalies = result.anomalies.map((a) => ({
    ...a,
    column: columnName,
    row: (rows[a.rowId] ?? undefined) as ResultRow | undefined,
  }))
  return {
    column: columnName,
    method: result.method,
    count: anomalies.length,
    proportion: total ? (anomalies.length / total) * 100 : 0,
    q1: f.q1,
    q3: f.q3,
    median: f.median,
    mean: f.mean,
    stdDev: f.stdDev,
    lowerBound: f.lowerFence,
    upperBound: f.upperFence,
    records: anomalies,
  }
}

/** Plain-English explanation for a flagged record (computed, never LLM). */
export function explainAnomaly(report: NumericAnomalyReport, record: AnomalyRecord): string[] {
  const why: string[] = []
  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })

  if (record.method === "z-score" || record.method === "both") {
    const z = record.zScore
    const direction = z > 0 ? "above" : "below"
    why.push(
      `It sits ${fmt(Math.abs(z))} standard deviations ${direction} the column average (${fmt(report.mean)}) — anything beyond ${fmt(3)} is treated as unusual.`
    )
  }
  if (record.method === "iqr" || record.method === "both") {
    const isHigh = record.value > (report.upperBound ?? 0)
    why.push(
      isHigh
        ? `It exceeds the IQR upper fence of ${fmt(report.upperBound ?? record.bound)} (based on Q1=${fmt(report.q1)}, Q3=${fmt(report.q3)}).`
        : `It falls under the IQR lower fence of ${fmt(report.lowerBound ?? record.bound)} (based on Q1=${fmt(report.q1)}, Q3=${fmt(report.q3)}).`
    )
  }
  why.push(
    `Typical values here are around ${fmt(Number.isFinite(report.median) ? report.median : report.mean)} (median) with a spread of ${fmt(report.stdDev)}.`
  )
  return why
}
