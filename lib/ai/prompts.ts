import type { AnalysisMessage, DatasetSummary } from "@/types"
import type { ChatMessageWire } from "@/lib/ai/llm"

// ── Schema payload (token-efficient; query names are the executable ones) ──
export interface SchemaColumnPayload {
  column: string
  type: string
  missing: number
  distinct: number
  min?: number
  max?: number
  minDate?: string
  maxDate?: string
  sample?: string[]
}
export interface SchemaPayload {
  table: string
  name: string
  rowCount: number
  columns: SchemaColumnPayload[]
}

export function buildSchemaPayload(ds: DatasetSummary): SchemaPayload {
  if (!ds.columns) {
    throw new Error("Dataset schema is not ready yet")
  }
  return {
    table: ds.tableName,
    name: ds.name,
    rowCount: ds.rowCount,
    columns: ds.columns.map((c) => {
      const p: SchemaColumnPayload = {
        column: c.queryName,
        type: c.duckType ?? "VARCHAR",
        missing: c.missing,
        distinct: c.distinct,
      }
      if (c.min !== undefined) p.min = c.min
      if (c.max !== undefined) p.max = c.max
      if (c.minDate !== undefined) p.minDate = c.minDate
      if (c.maxDate !== undefined) p.maxDate = c.maxDate
      if (c.samples && c.samples.length > 0) p.sample = c.samples.slice(0, 4)
      return p
    }),
  }
}

export interface ConversationSlice {
  question: string
  sql?: string
  answerPreview: string
}

/** Last-N conversation compacted to what a follow-up actually needs. */
export function buildConversationSlice(messages: AnalysisMessage[], max = 4): ConversationSlice[] {
  const done = messages.filter((m) => m.status === "done" || m.role === "user")
  const slice = done.slice(-max * 2)
  const out: ConversationSlice[] = []
  for (const m of slice) {
    if (m.role === "user") {
      out.push({ question: m.content.slice(0, 400), answerPreview: "", sql: undefined })
    } else if (out.length > 0) {
      const last = out[out.length - 1]
      last.answerPreview = m.content.slice(0, 300)
      last.sql = m.sql?.slice(0, 400)
    }
  }
  return out.filter((c) => c.question)
}

// ── Prompts ──────────────────────────────────────────────────────────────

export const SQL_PLAN_SYSTEM = `You are the SQL planning module of InsightFlow, a data analysis product.
You write ONE read-only DuckDB SQL SELECT statement per user question.

INPUT (JSON): datasets schema, recent conversation (if any), the user question.

HARD RULES
1. Return ONLY JSON: {"sql": string, "table": string, "visualization": {"kind": "bar"|"line"|"area"|"pie"|"scatter", "x": string, "y": string, "title": string} | null, "needsClarification": boolean, "clarification": string | null, "notes": string}
2. No markdown fences, no commentary outside the JSON.
3. "sql" must be a single SELECT (or WITH ... SELECT) — never CREATE/INSERT/UPDATE/DELETE/DROP/PRAGMA/SET/ATTACH/COPY.
4. Use table and column names EXACTLY as given in the schema ("column" keys). DuckDB is case-insensitive for these names.
5. If the question references a prior analysis ("its", "that region", "the top one"), resolve it using the conversation history and write SQL for the resolved entity.
6. If the referenced dataset or column genuinely doesn't exist, or the question is not answerable from the given schemas, return needsClarification=true, leave "sql" empty string and explain briefly in "clarification".
7. Prefer aggregations with GROUP BY for breakdowns; ORDER BY for rankings; ROUND for readability (e.g. round to 2).
8. For date trends use CAST(col AS DATE) / DATE_TRUNC('month', CAST(col AS DATE)) when the column type is DATE/TIMESTAMP.
9. Percentages: compute them in SQL (e.g. share of total) rather than asking for post-processing.
10. Avoid SELECT * — select only the columns the answer needs (unless previewing raw rows).
11. If multiple datasets are provided and a JOIN answers the question best, you may JOIN them; otherwise query the single most relevant dataset and set "table" accordingly.
12. Keep "visualization" matching the expected result shape: bar for category+number, line/area for time+number, pie for few categories <7 with share-of-total, scatter for two numeric series; null to disable charting (e.g. value lookups).

Respond with the JSON object only.`

export interface SqlPlanUserPayload {
  schemas: SchemaPayload[]
  conversation?: ConversationSlice[]
  question: string
}

export function buildSqlPlanMessages(payload: SqlPlanUserPayload): ChatMessageWire[] {
  const user = [
    "DATASET SCHEMAS:",
    JSON.stringify(payload.schemas),
    payload.conversation?.length
      ? `RECENT CONVERSATION (most recent last):\n${JSON.stringify(payload.conversation)}`
      : "",
    `USER QUESTION:\n${payload.question}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  return [
    { role: "system", content: SQL_PLAN_SYSTEM },
    { role: "user", content: user },
  ]
}

export const EXPLAIN_SYSTEM = `You are the analysis module of InsightFlow, a data analysis product.
You receive: the user's question, the DuckDB SQL that was executed, and the ACTUAL result rows.

Return ONLY JSON: {"answer": string, "takeaways": string[], "chartAdjustment": {"kind": string, "x": string, "y": string} | null}

RULES
1. "answer" is concise markdown (2-5 sentences for simple results, up to ~120 words for complex ones). Use real numbers from the results — never invent numbers not present in the result. If the result is empty, say so honestly and suggest why (no matching rows / filters too narrow).
2. "takeaways": up to 4 short factual bullets (max ~90 chars each). Empty array if trivial.
3. If the given chart would misrepresent the data, propose a corrected "chartAdjustment" using ONLY the result column names; otherwise null.
4. Do not mention SQL mechanics, JSON, or that you are an AI. Do not use tables in the answer; short paragraphs and inline numbers are fine.
5. Interpret, don't dump: say what the numbers mean for the question asked.`

export interface ExplainUserPayload {
  question: string
  sql: string
  columns: { name: string; kind: string }[]
  rows: unknown[]
  rowCount: number
  truncated: boolean
  datasetName: string
}

export function buildExplainMessages(payload: ExplainUserPayload): ChatMessageWire[] {
  const user = [
    `DATASET: ${payload.datasetName}`,
    `QUESTION: ${payload.question}`,
    `SQL EXECUTED:\n${payload.sql}`,
    `RESULT COLUMNS: ${JSON.stringify(payload.columns)}`,
    `RESULT (up to 30 rows) — total ${payload.rowCount} rows${payload.truncated ? " (result truncated)" : ""}:\n${JSON.stringify(payload.rows.slice(0, 30))}`,
  ].join("\n\n")
  return [
    { role: "system", content: EXPLAIN_SYSTEM },
    { role: "user", content: user },
  ]
}

export const INSIGHTS_SYSTEM = `You are the narrative module of InsightFlow.
You receive pre-computed KPIs, breakdowns and trends — all calculated by real SQL.

Return ONLY JSON: {"narrative": string, "takeaways": string[]}

RULES
1. Write "narrative" as concise markdown (4-6 sentences): an executive summary of the dataset using ONLY the given statistics. Never invent or extrapolate numbers that are not given.
2. "takeaways": up to 5 short insight bullets grounded in the data (max ~100 chars).
3. No placeholders, no "as an AI", no tables.`

export function buildInsightsMessages(payload: unknown, datasetName: string): ChatMessageWire[] {
  return [
    { role: "system", content: INSIGHTS_SYSTEM },
    { role: "user", content: `DATASET: ${datasetName}\nCOMPUTED STATISTICS:\n${JSON.stringify(payload)}` },
  ]
}

/** Models love wrapping JSON in fences; extract the outermost object. */
export function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1].trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return body
  return body.slice(start, end + 1)
}
