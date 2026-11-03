import { describe, expect, it } from "vitest"
import { parseCsvText, parseCsvFile, CsvParseError } from "@/lib/data/csv-parser"
import { profileDataset } from "@/lib/data/profiler"
import { buildIngestCsv, normalizeNumeric, normalizeWhen } from "@/lib/data/normalize"

// ── CSV upload: valid files ──────────────────────────────────────────────
describe("csv-parser: valid uploads", () => {
  it("parses a well-formed CSV with headers", () => {
    const csv = "name,qty,price\nWidget,3,9.99\nGadget,10,15\n"
    const parsed = parseCsvText(csv)
    expect(parsed.headers).toEqual(["name", "qty", "price"])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual(["Widget", "3", "9.99"])
  })

  it("handles quoted values with commas and escaped quotes", () => {
    const csv = 'name,note\n"Widget, Large","says ""wow"""\nPlain,fine\n'
    const parsed = parseCsvText(csv)
    expect(parsed.rows[0][0]).toBe("Widget, Large")
    expect(parsed.rows[0][1]).toBe('says "wow"')
  })

  it("auto-detects semicolon and tab delimiters", () => {
    expect(parseCsvText("a;b;c\n1;2;3\n").headers).toEqual(["a", "b", "c"])
    expect(parseCsvText("a\tb\n1\t2\n").headers).toEqual(["a", "b"])
  })

  it("generates column names when the first row is pure data (no header)", () => {
    const parsed = parseCsvText("1,2\n3,4\n")
    expect(parsed.headers).toEqual(["column_1", "column_2"])
    expect(parsed.rows).toHaveLength(2)
  })

  it("skips fully-empty rows and strips whitespace", () => {
    const csv = "a,b\n1,2\n,\n  3 , 4 \n"
    const parsed = parseCsvText(csv)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[1]).toEqual(["3", "4"])
  })

  it("strips a UTF-8 BOM without breaking the header", async () => {
    const file = new File(["﻿name,qty\nA,1\n"], "bom.csv", { type: "text/csv" })
    const parsed = await parseCsvFile(file)
    expect(parsed.headers[0]).toBe("name")
  })
})

// ── CSV upload: invalid files ────────────────────────────────────────────
describe("csv-parser: invalid uploads", () => {
  it("rejects files with no rows", () => {
    expect(() => parseCsvText("")).toThrow(CsvParseError)
  })

  it("rejects a header-only file", () => {
    expect(() => parseCsvText("a,b,c\n")).toThrow(/no data to analyze/i)
  })

  it("rejects files where every cell is empty", () => {
    expect(() => parseCsvText(",,\n,,\n")).toThrow(/usable data rows|empty/i)
  })

  it("rejects malformed quoted CSV", () => {
    expect(() => parseCsvText('a,b\n"x,2\n')).toThrow(CsvParseError)
    try {
      parseCsvText('a,b\n"x,2\n')
    } catch (e) {
      expect((e as CsvParseError).code).toBe("malformed_quotes")
    }
  })
})

// ── Profiling ────────────────────────────────────────────────────────────
describe("profiler", () => {
  const headers = ["order_id", "region", "revenue", "order_date", "active"]
  const rows = [
    ["S1", "West", "100.5", "2024-01-05", "true"],
    ["S2", "East", "250", "2024-02-10", "false"],
    ["S3", "West", "", "2024-02-10", "true"],
    ["S4", "North", "1250.75", "2024-02-14", "yes"],
    ["S1", "West", "100.5", "2024-01-05", "true"], // exact duplicate of row 1
    ["S6", "South", "80", "2024-03-01", "true"],
    ["S7", "West", "99.9", "2024-03-15", "false"],
    ["S8", "East", "310.2", "2024-04-02", "true"],
    ["S9", "Central", "77", "", "false"],
    ["S10", "South", "5", "2024-04-20", "true"],
    ["S11", "West", "42", "2024-05-08", "yes"],
    ["S12", "North", "8", "bad-date", "no"],
  ]

  const profile = profileDataset(headers, rows, 512)

  it("reports dimensions", () => {
    expect(profile.rowCount).toBe(12)
    expect(profile.columnCount).toBe(5)
  })

  it("classifies column types", () => {
    expect(profile.columns[0].kind).toBe("text")
    expect(profile.columns[1].kind).toBe("categorical")
    expect(profile.columns[2].kind).toBe("decimal")
    expect(profile.columns[3].kind).toBe("date")
    expect(profile.columns[4].kind).toBe("boolean")
  })

  it("counts missing values per column", () => {
    expect(profile.columns[2].missing).toBe(1)
    expect(profile.columns[3].missing).toBe(1)
    expect(profile.columns[2].missingPercent).toBeCloseTo(100 / 12, 5)
  })

  it("counts exact duplicate rows", () => {
    expect(profile.duplicateRows).toBe(1)
  })

  it("computes numeric stats", () => {
    const revenue = profile.columns[2]
    expect(revenue.min).toBeCloseTo(5)
    expect(revenue.max).toBeCloseTo(1250.75)
    expect(revenue.samples.length).toBeGreaterThan(0)
  })

  it("captures date ranges and skips un-parseable dates in min/max", () => {
    const dateCol = profile.columns[3]
    expect(dateCol.minDate).toBe("2024-01-05")
    expect(dateCol.maxDate).toBe("2024-05-08")
  })

  it("sanitizes identifiers for DuckDB (spaces, symbols, dupes, leading digits)", () => {
    const messy = profileDataset(["Order  Total", "2024 revenue!", "order total", "2fast"], [["1", "2", "3", "4"]])
    expect(messy.columns[0].queryName).toBe("order_total")
    expect(messy.columns[1].queryName).toBe("c_2024_revenue")
    expect(messy.columns[2].queryName).toBe("order_total_2")
    expect(messy.columns[3].queryName).toBe("c_2fast")
  })

  it("handles empty-ish datasets gracefully", () => {
    const p = profileDataset(["a"], [[""], [""]])
    expect(p.columns[0].kind).toBe("text")
    expect(p.qualityScore).toBeLessThan(100)
  })
})

// ── Large data (within supported limits) ─────────────────────────────────
describe("profiler: large dataset", () => {
  it("profiles 50k rows quickly and correctly", () => {
    const headers = ["id", "value", "kind"]
    const rows: string[][] = []
    for (let i = 0; i < 50_000; i++) rows.push([`r${i}`, String(i * 1.5), i % 2 ? "a" : "b"])
    const t0 = performance.now()
    const p = profileDataset(headers, rows)
    const ms = performance.now() - t0
    expect(p.rowCount).toBe(50_000)
    expect(p.columns[1].kind).toBe("decimal")
    expect(p.columns[2].kind).toBe("categorical")
    expect(ms).toBeLessThan(15_000)
  })
})

// ── Ingest normalization ─────────────────────────────────────────────────
describe("normalize", () => {
  it("normalizes money, commas, percent and parentheses", () => {
    expect(normalizeNumeric("$1,234.56")).toBe("1234.56")
    expect(normalizeNumeric("(2,500)")).toBe("-2500")
    expect(normalizeNumeric("45%")).toBe("45")
    expect(normalizeNumeric("₹ 999")).toBe("999")
    expect(normalizeNumeric("N/A")).toBeNull()
    expect(normalizeNumeric("")).toBe("")
    expect(normalizeNumeric("42")).toBe("42")
  })

  it("normalizes dates without shifting calendar days", () => {
    expect(normalizeWhen("2024-01-05", false)).toBe("2024-01-05")
    expect(normalizeWhen("Jan 5, 2024", false)).toBe("2024-01-05")
    expect(normalizeWhen("May 1, 2024", false)).toBe("2024-05-01")
    expect(normalizeWhen("2024-01-05 14:30:00", true)).toContain("2024-01-05T14:30".slice(0, 10))
    expect(normalizeWhen("not a date", false)).toBeNull()
  })

  it("emits DuckDB types from profile kinds", () => {
    const headers = ["a", "b", "c", "d", "e", "f"]
    const rows = [["1", "1.5", "2024-01-01", "2024-01-01T10:00", "true", "x"]]
    const profile = profileDataset(headers, rows, 10)
    const bundle = buildIngestCsv(headers, rows, profile)
    const types = Object.fromEntries(bundle.columnTypes.map((t) => [t.name, t.duckType]))
    expect(types["a"]).toBe("BIGINT")
    expect(types["b"]).toBe("DOUBLE")
    expect(types["c"]).toBe("DATE")
    expect(types["d"]).toBe("TIMESTAMP")
    expect(types["e"]).toBe("BOOLEAN")
    expect(types["f"]).toBe("VARCHAR")
  })

  it("reports un-parseable numeric cells", () => {
    const headers = ["value"]
    const rows = [["10"], ["20"], ["30"], ["40"], ["50"], ["60"], ["70"], ["oops"]]
    const profile = profileDataset(headers, rows, 10)
    expect(profile.columns[0].kind).toBe("integer")
    const bundle = buildIngestCsv(headers, rows, profile)
    expect(bundle.warnings.join(" ")).toMatch(/1 value.*not readable as numbers/)
  })
})
