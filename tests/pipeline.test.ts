import { describe, expect, it } from "vitest"
import { pickChart, validateChartSpec } from "@/lib/data/chart-picker"
import { buildConversationSlice, buildSqlPlanMessages, extractJson, SchemaPayload } from "@/lib/ai/prompts"
import { aiSqlPlanSchema, aiExplanationSchema, validateUploadedFile } from "@/lib/validation/schema"
import type { AnalysisMessage } from "@/types"

// ── Chart selection from actual result shapes ────────────────────────────
describe("chart-picker", () => {
  it("picks a line chart for time + number", () => {
    const cols = [
      { name: "month", kind: "date" },
      { name: "revenue", kind: "number" },
    ]
    const rows = [
      { month: "2024-01-01", revenue: 10 },
      { month: "2024-02-01", revenue: 12 },
    ]
    const chart = pickChart(cols, rows)
    expect(chart?.kind).toBe("line")
    expect(chart?.x).toBe("month")
    expect(chart?.y).toBe("revenue")
  })

  it("picks bar for category + number and pie only for few slices", () => {
    const cols = [
      { name: "region", kind: "string" },
      { name: "revenue", kind: "number" },
    ]
    const smallRows = [
      { region: "N", revenue: 1 },
      { region: "S", revenue: 2 },
      { region: "E", revenue: 3 },
      { region: "W", revenue: 4 },
    ]
    expect(pickChart(cols, smallRows)?.kind).toBe("pie")
    const manyRows = Array.from({ length: 12 }, (_, i) => ({ region: `r${i}`, revenue: i }))
    expect(pickChart(cols, manyRows)?.kind).toBe("bar")
  })

  it("picks scatter for two numeric series", () => {
    const cols = [
      { name: "x", kind: "number" },
      { name: "y", kind: "number" },
    ]
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2 }))
    expect(pickChart(cols, rows)?.kind).toBe("scatter")
  })

  it("returns null when rows are empty", () => {
    expect(pickChart([{ name: "a", kind: "number" }], [])).toBeNull()
  })
})

describe("chart spec validation (LLM hints)", () => {
  const cols = [
    { name: "region", kind: "string" },
    { name: "revenue", kind: "number" },
  ]
  const rows = [{ region: "N", revenue: 1 }, { region: "S", revenue: 2 }]

  it("accepts a valid hint", () => {
    const chart = validateChartSpec({ kind: "bar", x: "region", y: "revenue" }, cols, rows)
    expect(chart?.kind).toBe("bar")
  })

  it("rejects hints with unknown columns", () => {
    expect(validateChartSpec({ kind: "bar", x: "bogus", y: "revenue" }, cols, rows)).toBeNull()
    expect(validateChartSpec({ kind: "bar", x: "region", y: "bogus" }, cols, rows)).toBeNull()
  })

  it("rejects unknown chart kinds", () => {
    expect(validateChartSpec({ kind: "3d-plot", x: "region", y: "revenue" }, cols, rows)).toBeNull()
  })

  it("fills a missing y with the numeric column", () => {
    const chart = validateChartSpec({ kind: "bar", x: "region" }, cols, rows)
    expect(chart?.y).toBe("revenue")
  })
})

// ── Prompt/JSON plumbing ─────────────────────────────────────────────────
describe("prompts: extractJson", () => {
  it("extracts JSON from fenced responses", () => {
    const text = "```json\n{\"sql\": \"SELECT 1\"}\n```"
    expect(JSON.parse(extractJson(text))).toEqual({ sql: "SELECT 1" })
  })

  it("extracts the outermost object from prose", () => {
    const text = 'Sure! Here is the plan: {"sql": "SELECT 2", "note": "a } tricky } one }"}'
    expect(JSON.parse(extractJson(text)).sql).toBe("SELECT 2")
  })
})

describe("prompts: follow-up conversation slice", () => {
  it("pairs user questions with previous SQL so 'its' can be resolved", () => {
    const messages: AnalysisMessage[] = [
      { id: "1", role: "user", content: "Which region has the highest revenue?", createdAt: 1 },
      { id: "2", role: "assistant", content: "**West** leads with $432K…", createdAt: 2, status: "done", sql: "SELECT region, SUM(revenue) AS total FROM t GROUP BY 1 ORDER BY 2 DESC LIMIT 1" },
      { id: "3", role: "user", content: "Show its monthly trend", createdAt: 3 },
    ]
    const slice = buildConversationSlice(messages)
    expect(slice).toHaveLength(2)
    expect(slice[0].question).toContain("highest revenue")
    expect(slice[0].sql).toContain("SUM(revenue)")
    expect(slice[1].question).toBe("Show its monthly trend")
  })

  it("caps the slice size for token efficiency", () => {
    const messages: AnalysisMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? "assistant" : "user",
      content: `msg ${i}`,
      createdAt: i,
      status: "done" as const,
    }))
    const slice = buildConversationSlice(messages)
    expect(slice.length).toBeLessThanOrEqual(4)
  })
})

describe("prompts: schema payload", () => {
  it("builds a compact schema with query names", () => {
    const messages = buildSqlPlanMessages({
      question: "top region?",
      schemas: [
        {
          table: "ds_sales",
          name: "sales.csv",
          rowCount: 10,
          columns: [{ column: "region", type: "VARCHAR", missing: 0, distinct: 4 }],
        } satisfies SchemaPayload,
      ],
      conversation: [],
    })
    const userMsg = messages[1].content
    expect(userMsg).toContain("ds_sales")
    expect(messages[0].role).toBe("system")
  })
})

// ── Ai response schemas ──────────────────────────────────────────────────
describe("ai zod schemas", () => {
  it("accepts a valid SQL plan", () => {
    const plan = aiSqlPlanSchema.parse({
      sql: "SELECT 1",
      table: "ds_x",
      visualization: { kind: "bar", x: "region", y: "revenue" },
      needsClarification: false,
    })
    expect(plan.sql).toBe("SELECT 1")
  })

  it("rejects an invalid chart kind in the plan", () => {
    expect(() =>
      aiSqlPlanSchema.safeParse({ sql: "SELECT 1", table: "t", visualization: { kind: "hologram", x: "a", y: "b" } })
    ).toBeDefined()
  })

  it("accepts explanation with takeaways", () => {
    const parsed = aiExplanationSchema.parse({ answer: "West leads.", takeaways: ["West wins"] })
    expect(parsed.answer).toBe("West leads.")
  })
})

// ── Upload validation ────────────────────────────────────────────────────
describe("upload validation", () => {
  const empty = { totalBytes: 0, count: 0 }

  it("accepts a normal CSV", () => {
    expect(validateUploadedFile({ name: "sales.csv", size: 1000 }, empty).ok).toBe(true)
  })

  it("rejects a non-csv file", () => {
    const res = validateUploadedFile({ name: "doc.pdf", size: 1000 }, empty)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("bad_format")
  })

  it("rejects zero-byte and oversized files", () => {
    expect(validateUploadedFile({ name: "a.csv", size: 0 }, empty).ok).toBe(false)
    expect(validateUploadedFile({ name: "a.csv", size: 26 * 1024 * 1024 }, empty).ok).toBe(false)
  })

  it("rejects the 6th dataset", () => {
    const res = validateUploadedFile({ name: "a.csv", size: 100 }, { totalBytes: 1000, count: 5 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("too_many")
  })

  it("rejects when the session total exceeds 75MB", () => {
    const res = validateUploadedFile({ name: "a.csv", size: 2 * 1024 * 1024 }, { totalBytes: 74 * 1024 * 1024, count: 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("session_too_large")
  })
})
