// Shared LLM request/response contract between the browser store and /api/llm.
// The client sends STRUCTURED DATA ONLY — prompts are assembled server-side
// (in lib/ai/prompts.ts) so prompt logic and API key never leave the server.

export type LlmKind = "sql-plan" | "explain" | "insights"

/** Wire shape for a chat message on the server side (normalized by the route). */
export interface ChatMessageWire {
  role: "system" | "user"
  content: string
}

export interface SqlPlanRequest {
  kind: "sql-plan"
  question: string
  schemas: unknown[]
  conversation?: { question: string; answerPreview: string; sql?: string }[]
}

export interface ExplainRequest {
  kind: "explain"
  question: string
  sql: string
  columns: { name: string; kind: string }[]
  rows: unknown[]
  rowCount: number
  truncated: boolean
  datasetName: string
}

export interface InsightsRequest {
  kind: "insights"
  datasetName: string
  report: unknown
}

export type LlmRequestBody = SqlPlanRequest | ExplainRequest | InsightsRequest

export interface SqlPlanResponse {
  plan: {
    sql?: string
    table?: string
    visualization?: { kind: string; x: string; y?: string; title?: string } | null
    needsClarification?: boolean
    clarification?: string
    notes?: string
  }
  model: string
}

export interface ExplainResponse {
  explanation: {
    answer: string
    takeaways?: string[]
    chartAdjustment?: { kind: string; x: string; y?: string } | null
  }
  model: string
}

export interface InsightsResponse {
  narrative: { narrative: string; takeaways?: string[] }
  model: string
}

export type LlmResponse = SqlPlanResponse | ExplainResponse | InsightsResponse

export const LLM_ENDPOINT = "/api/llm"

export async function llmRequest<T = unknown>(body: LlmRequestBody): Promise<T> {
  let response: Response
  try {
    response = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new LlmUnavailableError("Could not reach the analysis service. Check your connection and try again.")
  }
  const payload = (await response.json().catch(() => null)) as LlmResponse | { error: string; code?: string } | null
  if (!response.ok || payload === null || "error" in (payload as object)) {
    const err = payload as { error?: string; code?: string } | null
    if (response.status === 401) {
      throw new LlmUnavailableError(
        err?.error ?? "OPENROUTER_API_KEY is missing or invalid. Add your key to .env.local and restart the dev server.",
        err?.code ?? "unauthorized"
      )
    }
    if (response.status === 402) {
      throw new LlmUnavailableError("Your OpenRouter account has no credits. Add credits or select a free model.", "payment")
    }
    throw new LlmUnavailableError(err?.error ?? `The analysis service returned an error (${response.status}).`, err?.code)
  }
  return payload as T
}

export class LlmUnavailableError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = "LlmUnavailableError"
    this.code = code
  }
}
