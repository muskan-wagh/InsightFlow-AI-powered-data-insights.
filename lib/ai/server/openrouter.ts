import "server-only"
import type { ChatMessageWire } from "@/lib/ai/llm"

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct"

export function getOpenRouterModel(): string {
  const model = process.env.OPENROUTER_MODEL?.trim()
  return model && model.length > 0 ? model : DEFAULT_MODEL
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

export interface OpenRouterResult {
  text: string
  model: string
  usage?: { promptTokens: number; completionTokens: number }
}

export class OpenRouterRequestFailed extends Error {
  status?: number
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = "OpenRouterRequestFailed"
    this.status = status
    this.code = code
  }
}

/** One call to OpenRouter's chat completions endpoint. Server-side only. */
export async function callOpenRouter(messages: ChatMessageWire[], options?: { temperature?: number; maxTokens?: number }): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    throw new OpenRouterRequestFailed("OPENROUTER_API_KEY is not configured.", 401, "unauthorized")
  }
  const model = getOpenRouterModel()
  const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "")
  const maxTokens = options?.maxTokens ?? Number(process.env.LLM_MAX_TOKENS ?? 1400)
  const temperature = options?.temperature ?? Number(process.env.LLM_TEMPERATURE ?? 0.1)

  async function attempt(): Promise<OpenRouterResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title": "InsightFlow",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: Number.isFinite(temperature) ? temperature : 0.1,
          max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1400,
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string | { text?: string }[] } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        error?: { message?: string; code?: number }
      } | null
      if (!res.ok) {
        const message = body?.error?.message ?? `OpenRouter request failed (${res.status}).`
        throw new OpenRouterRequestFailed(message, res.status)
      }
      const content = body?.choices?.[0]?.message?.content
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : ""
      if (!text.trim()) {
        throw new OpenRouterRequestFailed("The model returned an empty response.", 502)
      }
      return {
        text,
        model,
        usage: body?.usage
          ? { promptTokens: body.usage.prompt_tokens ?? 0, completionTokens: body.usage.completion_tokens ?? 0 }
          : undefined,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    return await attempt()
  } catch (err) {
    // One retry on transient failures (429 / 5xx)
    const status = err instanceof OpenRouterRequestFailed ? err.status : undefined
    const transient = status !== undefined && (status === 429 || status >= 500) || (err instanceof Error && err.name === "AbortError")
    if (!transient) throw err
    if (status === 429) {
      await new Promise((r) => setTimeout(r, 2500))
    }
    return attempt()
  }
}

/** Maps engine failures to the JSON error shape the API route returns. */
export function toLlmError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof OpenRouterRequestFailed) {
    const map: Record<number, { status: number; code: string }> = {
      400: { status: 400, code: "bad_request" },
      401: { status: 401, code: "unauthorized" },
      402: { status: 402, code: "payment_required" },
      404: { status: 502, code: "model_not_found" },
      429: { status: 429, code: "rate_limited" },
      502: { status: 502, code: "empty_response" },
    }
    const mapped = err.status !== undefined ? map[err.status] : undefined
    return {
      status: mapped?.status ?? 500,
      body: { error: err.message, code: mapped?.code ?? err.code },
    }
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { status: 504, body: { error: "The model took too long to respond. Try again.", code: "timeout" } }
  }
  return {
    status: 500,
    body: {
      error: err instanceof Error ? err.message : "Unexpected analysis service error.",
      code: "internal",
    },
  }
}
