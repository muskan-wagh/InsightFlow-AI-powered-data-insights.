import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  callOpenRouter,
  isOpenRouterConfigured,
  toLlmError,
} from "@/lib/ai/server/openrouter"
import { buildInsightsMessages, buildExplainMessages, buildSqlPlanMessages, extractJson } from "@/lib/ai/prompts"
import { aiExplanationSchema, aiNarrativeSchema, aiSqlPlanSchema } from "@/lib/validation/schema"
import { LLM_ENDPOINT } from "@/lib/ai/llm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql-plan"),
    question: z.string().min(1).max(2000),
    schemas: z.array(z.any()).min(1),
    conversation: z.array(z.any()).max(6).optional(),
  }),
  z.object({
    kind: z.literal("explain"),
    question: z.string().min(1).max(2000),
    sql: z.string().min(1).max(8000),
    columns: z.array(z.object({ name: z.string(), kind: z.string() })).max(60),
    rows: z.array(z.any()).max(30),
    rowCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    datasetName: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("insights"),
    datasetName: z.string().min(1).max(200),
    report: z.any(),
  }),
])

export async function POST(request: NextRequest) {
  if (!isOpenRouterConfigured()) {
    return NextResponse.json(
      {
        error:
          "OPENROUTER_API_KEY is not configured on the server. Add your key to .env.local and restart the dev server.",
        code: "unauthorized",
      },
      { status: 401 }
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body.", code: "bad_request" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request for /${LLM_ENDPOINT.replace(/^\//, "")}: ${parsed.error.issues[0]?.message ?? "unknown"}`, code: "bad_request" },
      { status: 400 }
    )
  }

  const body = parsed.data
  try {
    if (body.kind === "sql-plan") {
      const messages = buildSqlPlanMessages({
        schemas: body.schemas as never[],
        conversation: body.conversation as never[] | undefined,
        question: body.question,
      })
      const result = await callOpenRouter(messages, { temperature: 0.05, maxTokens: 900 })
      const json = aiSqlPlanSchema.safeParse(JSON.parse(extractJson(result.text)))
      if (!json.success) {
        // One corrective retry: models occasionally add narrative after JSON.
        const retry = await callOpenRouter(
          [
            ...messages,
            { role: "user", content: "Your previous response was not valid JSON. Respond again with ONLY the JSON object, no other text." },
          ],
          { temperature: 0, maxTokens: 900 }
        )
        const retryParsed = aiSqlPlanSchema.safeParse(JSON.parse(extractJson(retry.text)))
        if (!retryParsed.success) {
          return NextResponse.json(
            { error: "The model could not produce a valid SQL plan. Try rephrasing the question.", code: "invalid_plan" },
            { status: 502 }
          )
        }
        return NextResponse.json({ plan: retryParsed.data, model: result.model })
      }
      return NextResponse.json({ plan: json.data, model: result.model })
    }

    if (body.kind === "explain") {
      const messages = buildExplainMessages({
        question: body.question,
        sql: body.sql,
        columns: body.columns,
        rows: body.rows,
        rowCount: body.rowCount,
        truncated: body.truncated,
        datasetName: body.datasetName,
      })
      const result = await callOpenRouter(messages, { maxTokens: 1100 })
      const json = aiExplanationSchema.safeParse(JSON.parse(extractJson(result.text)))
      if (!json.success) {
        return NextResponse.json(
          { error: "The model could not explain the result. The data itself is still shown below.", code: "invalid_explanation" },
          { status: 502 }
        )
      }
      return NextResponse.json({ explanation: json.data, model: result.model })
    }

    // insights
    const messages = buildInsightsMessages(body.report, body.datasetName)
    const result = await callOpenRouter(messages, { maxTokens: 1200 })
    const json = aiNarrativeSchema.safeParse(JSON.parse(extractJson(result.text)))
    if (!json.success) {
      return NextResponse.json(
        { error: "The model could not narrate the insights.", code: "invalid_narrative" },
        { status: 502 }
      )
    }
    return NextResponse.json({ narrative: json.data, model: result.model })
  } catch (err) {
    const mapped = toLlmError(err)
    return NextResponse.json(mapped.body, { status: mapped.status })
  }
}
