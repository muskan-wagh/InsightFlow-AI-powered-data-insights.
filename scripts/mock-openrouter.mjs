// Minimal OpenRouter-compatible mock for end-to-end tests and demos.
// Implements POST /chat/completions and replies with a deterministic
// plan/explanation/insight JSON based on which system prompt it receives.
import http from "node:http"

const PORT = Number(process.argv[2] ?? 9999)

function pick(columns, pred) {
  return columns.find(pred)
}

function craftSql(userContent) {
  try {
    const start = userContent.indexOf("DATASET SCHEMAS:")
    if (start === -1) return null
    const jsonStart = userContent.indexOf("[", start)
    const jsonEnd = userContent.indexOf("\n\nRECENT", start) > -1 ? userContent.indexOf("\n\nRECENT", start) : userContent.indexOf("\n\nUSER QUESTION", start)
    const payload = JSON.parse(userContent.slice(jsonStart, jsonEnd))
    const ds = payload[0]
    const cols = ds.columns ?? []
    const table = ds.table
    const numeric = cols.filter((c) => /bigint|double/i.test(c.type ?? ""))
    const dateCol = cols.find((c) => /date|timestamp/i.test(c.type ?? ""))
    const dim = cols.find((c) => /region|category|segment|type|state/i.test(c.column)) ?? cols.find((c) => /varchar/i.test(c.type ?? ""))
    // Question hints decide the shape (so follow-ups act differently)
    const qSection = userContent.split("USER QUESTION:")[1]?.slice(0, 200) ?? ""
    const wantsTrend = /trend|monthly|over time|growth/i.test(qSection)
    const measure = numeric.find((c) => /revenue|amount|total|value|price|qty|quantity/i.test(c.column)) ?? numeric[0]

    if (wantsTrend && dateCol && measure) {
      const date = /timestamp/i.test(dateCol.type) ? `CAST("${dateCol.column}" AS DATE)` : `"${dateCol.column}"`
      return {
        sql: `SELECT DATE_TRUNC('month', CAST(COALESCE(${date}, DATE '1970-01-01') AS DATE)) AS month, SUM("${measure.column}") AS total FROM "${table}" WHERE ${date} IS NOT NULL GROUP BY 1 ORDER BY 1`,
        table,
        visualization: { kind: "line", x: "month", y: "total", title: `Monthly ${measure} trend` },
        needsClarification: false,
      }
    }
    if (dim && measure) {
      return {
        sql: `SELECT CAST("${dim.column}" AS VARCHAR) AS ${dim.column}, SUM("${measure.column}") AS total FROM "${table}" WHERE "${dim.column}" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        table,
        visualization: { kind: "bar", x: dim.column, y: "total", title: `Total ${measure.column} by ${dim.column}` },
        needsClarification: false,
      }
    }
    return {
      sql: `SELECT * FROM "${table}" LIMIT 8`,
      table,
      visualization: null,
      needsClarification: false,
    }
  } catch {
    return null
  }
}

function respond(res, content, model) {
  const body = JSON.stringify({
    id: "mock-completion",
    model,
    created: Date.now(),
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  })
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(body)
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: "not found" } }))
      return
    }
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify({ error: { message: "bad json" } }))
        return
      }
      const system = parsed.messages?.[0]?.content ?? ""
      const user = parsed.messages?.slice(1).map((m) => m.content).join("\n") ?? ""

      if (system.includes("SQL planning module")) {
        const plan = craftSql(user)
        if (plan) return respond(res, JSON.stringify(plan), parsed.model ?? "mock")
        return respond(res, JSON.stringify({ sql: "", table: "", needsClarification: true, clarification: "Mock needs the schema payload." }), parsed.model)
      }
      if (system.includes("analysis module")) {
        let rowCount = 0
        try {
          const rowsMatch = user.match(/RESULT \(up to 30 rows\) — total (\d+) rows/)
          rowCount = rowsMatch ? Number(rowsMatch[1]) : 0
          const resultJson = user.slice(user.indexOf(": [", user.indexOf("RESULT (up to 30 rows)")) + 2)
          const firstRow = JSON.parse(resultJson.split("\n")[0] ?? "[]")
          const region = firstRow?.[0]?.hasOwnProperty("region") ? firstRow.region : null
          return respond(
            res,
            JSON.stringify({
              answer:
                rowCount > 0
                  ? `The executed query returned **${rowCount} row(s)**${region ? `, led by \`${region}\`` : ""}, as computed by DuckDB on the actual dataset. The numbers below come straight from the result — the visualization mirrors the executed shape.`
                  : "The query returned **0 rows** — no records matched the filters.",
              takeaways: rowCount > 0 ? ["Totals are computed by real SQL execution", "Result rows are fully user-local"] : [],
              chartAdjustment: null,
            }),
            parsed.model
          )
        } catch {
          return respond(res, JSON.stringify({ answer: `The executed query returned ${rowCount} rows.`, takeaways: [], chartAdjustment: null }), parsed.model)
        }
      }
      if (system.includes("narrative module")) {
        return respond(
          res,
          JSON.stringify({
            narrative:
              "This narrative is grounded in the pre-computed statistics supplied to the model activity: all underlying KPIs were calculated with real aggregate SQL on your dataset. Breakdown ranking and trends reflect the executed queries — nothing here is invented.",
            takeaways: ["Insights are computed, then narrated", "Anomalies come from IQR/z-score statistics"],
          }),
          parsed.model
        )
      }
      res.writeHead(500)
      res.end(JSON.stringify({ error: { message: "unknown prompt kind" } }))
    })
  })
  .listen(PORT, () => console.log(`[mock-openrouter] listening on :${PORT}`))
