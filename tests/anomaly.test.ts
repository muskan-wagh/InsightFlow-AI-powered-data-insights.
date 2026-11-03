import { describe, expect, it } from "vitest"
import {
  detectAnomalies,
  distributionFacts,
  explainAnomaly,
  columnAnomalyReport,
  quantile,
} from "@/lib/analytics/anomaly-detection"

/** Generic series builder for numeric tests */
function nums(n: number, value: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => value(i))
}

describe("anomaly-detection: distribution facts", () => {
  it("computes quartiles and fences", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    const f = distributionFacts(values)
    // linear interpolation quartiles (numpy-style): q1=3.25, q3=7.75, IQR=4.5
    expect(f.q1).toBeCloseTo(3.25, 5)
    expect(f.median).toBeCloseTo(5.5)
    expect(f.q3).toBeCloseTo(7.75, 2)
    expect(f.lowerFence).toBeCloseTo(3.25 - 1.5 * 4.5, 2)
    expect(f.upperFence).toBeCloseTo(7.75 + 1.5 * 4.5, 2)
  })

  it("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5)
  })
})

describe("anomaly-detection: IQR", () => {
  it("flags planted outliers ONLY", () => {
    const values = nums(100, (i) => (i === 42 ? 5000 : 10 + ((i * 7) % 20))) // ~10..29 + one 5000
    const { anomalies, facts } = detectAnomalies(values, { method: "iqr" })
    expect(facts).not.toBeNull()
    const flagged = anomalies.map((a) => a.rowId)
    expect(flagged).toContain(42)
    expect(flagged.length).toBe(1)
    expect(anomalies[0].value).toBe(5000)
  })

  it("flags low-side outliers", () => {
    const values = [100, 102, 98, 101, 99, 100, -500, 103, 97, 101]
    const { anomalies } = detectAnomalies(values, { method: "iqr" })
    expect(anomalies.some((a) => a.value === -500)).toBe(true)
  })

  it("returns no anomalies for uniform data", () => {
    const values = nums(50, () => 5)
    const { anomalies, facts } = detectAnomalies(values, { method: "iqr" })
    // IQR is 0 → fences collapse; our implementation skips q-range==0 handling by design
    expect(facts?.q1).toBe(5)
    expect(anomalies.length).toBe(0) // upper/lower fence = 5; values are NOT > fence nor < fence
  })
})

describe("anomaly-detection: z-score", () => {
  it("flags >= 3 sigma points", () => {
    const values = nums(200, (i) => (i === 150 ? 1000 : 50 + (i % 6))) // mean ~52, σ ~1.7
    const { anomalies } = detectAnomalies(values, { method: "z-score", zThreshold: 3 })
    expect(anomalies.map((a) => a.rowId)).toContain(150)
    expect(anomalies[0].method).toBe("z-score")
    expect(Math.abs(anomalies[0].zScore)).toBeGreaterThan(10)
  })

  it("does not flag everything on near-constant series", () => {
    const values = nums(40, () => 7)
    const { anomalies } = detectAnomalies(values, { method: "z-score" })
    expect(anomalies.length).toBe(0)
  })
})

describe("anomaly-detection: combined method", () => {
  it("marks records hit by both fences and z as 'both'", () => {
    const values = nums(300, (i) => (i === 200 ? 9000 : 40 + (i % 10)))
    const { anomalies } = detectAnomalies(values, { method: "both" })
    const flag = anomalies.find((a) => a.rowId === 200)
    expect(flag).toBeDefined()
    expect(flag!.method).toBe("both")
  })
})

describe("anomaly-detection: report + explanation", () => {
  const rows: Record<string, unknown>[] = Array.from({ length: 120 }, (_, i) => ({
    region: i % 2 ? "East" : "West",
    qty: i === 60 ? 900 : 5 + (i % 5),
  }))
  const values = nums(120, (i) => (i === 60 ? 900 : 5 + (i % 5)))

  const report = columnAnomalyReport("qty", values, rows, { method: "both" })
  it("produces bounded statistics", () => {
    expect(report).not.toBeNull()
    expect(report!.column).toBe("qty")
    expect(report!.count).toBe(1)
    expect(report!.q3).toBeGreaterThan(report!.q1)
  })

  it("explains why a record was flagged with real numbers", () => {
    const rec = report!.records[0]
    const why = explainAnomaly(report!, rec)
    expect(why.length).toBeGreaterThan(1)
    expect(why.join(" ")).toMatch(/standard deviation|fence|median/i)
    expect(why.join(" ")).not.toMatch(/AI|model/)
  })

  it("returns null for tiny series", () => {
    expect(columnAnomalyReport("x", [1, 2, 3], [])).toBeNull()
  })

  it("ignores null values in statistics", () => {
    const withNulls: (number | null)[] = Array.from({ length: 60 }, (_, i) => (i === 30 ? 1000 : i + 1))
    withNulls[10] = null
    const rep = columnAnomalyReport("v", withNulls, [], { method: "iqr" })
    expect(rep).not.toBeNull()
    expect(rep!.count).toBe(1)
  })
})
