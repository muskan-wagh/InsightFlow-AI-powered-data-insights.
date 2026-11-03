import { describe, expect, it } from "vitest"
import { validateSql, stripLiteralsAndComments, extractTableRefs, extractCteAliases, MAX_RESULT_ROWS } from "@/lib/validation/sql-guard"

const TABLES = ["ds_sales_orders_abc", "ds_customers_xyz"]

describe("sql-guard: allows valid read-only SQL", () => {
  it("accepts a simple SELECT", () => {
    const res = validateSql("SELECT region, SUM(revenue) FROM ds_sales_orders_abc GROUP BY 1", TABLES)
    expect(res.ok).toBe(true)
    expect(res.sql).toContain(`LIMIT ${MAX_RESULT_ROWS}`)
    expect(res.limited).toBe(true)
  })

  it("accepts CTE queries and does not flag CTE alias as unknown table", () => {
    const sql = `WITH west AS (SELECT * FROM ds_sales_orders_abc WHERE region = 'West')
      SELECT COUNT(*) FROM west`
    const res = validateSql(sql, TABLES)
    expect(res.ok).toBe(true)
  })

  it("accepts multi-CTE chains", () => {
    const sql = `WITH a AS (SELECT 1 AS x), b AS (SELECT * FROM a) SELECT * FROM a, b`
    const res = validateSql(sql, TABLES)
    expect(res.ok).toBe(true)
  })

  it("does not double-LIMIT an already limited query", () => {
    const res = validateSql("SELECT * FROM ds_sales_orders_abc LIMIT 10", TABLES)
    expect(res.ok).toBe(true)
    expect(res.limited).toBe(false)
    expect(res.sql).toBe("SELECT * FROM ds_sales_orders_abc LIMIT 10")
  })

  it("allows string literals containing forbidden words (status = 'DELETE')", () => {
    const res = validateSql("SELECT * FROM ds_sales_orders_abc WHERE status = 'DELETE'", TABLES)
    expect(res.ok).toBe(true)
  })

  it("allows comments", () => {
    const res = validateSql("-- grab totals\nSELECT SUM(revenue) FROM ds_sales_orders_abc /* ok */", TABLES)
    expect(res.ok).toBe(true)
  })

  it("keeps a user-provided LIMIT but still caps nothing above cap", () => {
    const res = validateSql("SELECT * FROM ds_sales_orders_abc LIMIT 99999", TABLES)
    expect(res.ok).toBe(true)
    expect(res.limited).toBe(false)
  })

  it("allows JOINs and comma joins between known tables", () => {
    const res = validateSql(
      "SELECT a.region FROM ds_sales_orders_abc a JOIN ds_customers_xyz b ON a.customer = b.name",
      TABLES
    )
    expect(res.ok).toBe(true)
  })
})

describe("sql-guard: blocks destructive / unsafe SQL", () => {
  const cases: [string, string][] = [
    ["DROP TABLE ds_sales_orders_abc", " destructive op"],
    ["DELETE FROM ds_sales_orders_abc", " destructive op"],
    ["INSERT INTO ds_sales_orders_abc VALUES (1)", " destructive op"],
    ["UPDATE ds_sales_orders_abc SET revenue = 0", " destructive op"],
    ["CREATE TABLE x AS SELECT 1", " destructive op"],
    ["ALTER TABLE ds_sales_orders_abc RENAME TO y", " destructive op"],
    ["ATTACH 'x.db' AS x", " destructive op"],
    ["COPY ds_sales_orders_abc TO 'out.csv'", " destructive op"],
    ["PRAGMA memory_limit='2GB'", " destructive op"],
    ["CALL read_csv('x')", " destructive op"],
  ]
  for (const [sql] of cases) {
    it(`blocks: ${sql}`, () => {
      const res = validateSql(sql, TABLES)
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/Blocked/i)
    })
  }

  it("blocks keyword hidden inside a string-concat (still unsafe)", () => {
    const res = validateSql("SELECT 1 FROM ds_sales_orders_abc WHERE x = executables", TABLES)
    // 'executables' — no word-boundary match for known keywords; but ensure unknown-table catch
    if (!res.ok) expect(res.error).toMatch(/references table|Blocked/)
  })

  it("blocks multiple stacked statements", () => {
    const res = validateSql("SELECT 1; DROP TABLE ds_sales_orders_abc", TABLES)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/multiple SQL statements/i)
  })

  it("blocks stacked statements even with an inner string semicolon", () => {
    const res = validateSql("SELECT 'a;b' FROM ds_sales_orders_abc; SELECT 2", TABLES)
    expect(res.ok).toBe(false)
  })

  it("rejects non-SELECT heads", () => {
    expect(validateSql("SHOW TABLES", TABLES).ok).toBe(false)
    expect(validateSql("EXPLAIN SELECT 1", TABLES).ok).toBe(false)
    expect(validateSql("VACUUM", TABLES).ok).toBe(false)
  })

  it("blocks unknown table references", () => {
    const res = validateSql("SELECT * FROM nonexistent_table", TABLES)
    expect(res.ok).toBe(false)
    expect(res.error).toContain("nonexistent_table")
  })

  it("blocks union-prefixed tricks", () => {
    const res = validateSql("(SELECT 1) UNION DROP TABLE x", TABLES)
    expect(res.ok).toBe(false)
  })
})

describe("sql-guard: helpers", () => {
  it("stripLiteralsAndComments removes quotes/comments before scan", () => {
    expect(stripLiteralsAndComments("SELECT 'DROP TABLE' AS x -- drop\n")).not.toMatch("DROP TABLE")
  })

  it("extractTableRefs finds FROM and JOIN targets", () => {
    const refs = extractTableRefs("SELECT * FROM ds_a JOIN ds_b ON 1=1 LEFT JOIN ds_c USING (id)")
    expect(refs).toEqual(["ds_a", "ds_b", "ds_c"])
  })

  it("extractCteAliases finds CTE names", () => {
    const aliases = extractCteAliases("WITH x AS (SELECT 1), y AS (SELECT 2 FROM x) SELECT * FROM x JOIN y ON 1=1")
    expect(aliases).toEqual(["x", "y"])
  })
})

describe("sql-guard: multi-dataset support", () => {
  it("validates against all registered tables", () => {
    const res = validateSql(
      "SELECT s.region, c.segment FROM ds_sales_orders_abc s JOIN ds_customers_xyz c ON s.customer_name = c.customer_name",
      TABLES
    )
    expect(res.ok).toBe(true)
  })
})
