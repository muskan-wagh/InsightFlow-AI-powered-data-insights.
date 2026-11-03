import { z } from "zod"
import type { ChartKind, ColumnKind } from "@/types"

// ── Dataset / column validation ──────────────────────────────────────────
export const columnKinds: ColumnKind[] = ["integer", "decimal", "date", "datetime", "boolean", "text", "categorical"]
export const chartKinds: ChartKind[] = ["bar", "line", "area", "pie", "scatter"]

export const chartKindSchema = z.enum(["bar", "line", "area", "pie", "scatter"])
export const columnKindSchema = z.enum(columnKinds as [ColumnKind, ...ColumnKind[]])

// ── AI: SQL plan (first LLM step) ────────────────────────────────────────
export const aiSqlPlanSchema = z.object({
  sql: z.string().min(1).describe("A single read-only SQL SELECT statement"),
  table: z.string().describe("The dataset table the SQL primarily queries"),
  visualization: z
    .object({
      kind: chartKindSchema,
      x: z.string(),
      y: z.string().optional(),
      title: z.string().optional(),
    })
    .nullish(),
  needsClarification: z.boolean().optional().default(false),
  clarification: z.string().optional(),
  notes: z.string().optional(),
})
export type AiSqlPlan = z.infer<typeof aiSqlPlanSchema>

// ── AI: result explanation (second LLM step) ────────────────────────────
export const aiExplanationSchema = z.object({
  answer: z.string().min(1).describe("Markdown answer summarizing the actual result rows"),
  takeaways: z.array(z.string()).max(5).optional(),
  chartAdjustment: z
    .object({
      kind: chartKindSchema,
      x: z.string(),
      y: z.string().optional(),
    })
    .nullish(),
})
export type AiExplanation = z.infer<typeof aiExplanationSchema>

// ── AI: insights narrative ───────────────────────────────────────────────
export const aiNarrativeSchema = z.object({
  narrative: z.string().min(1),
  takeaways: z.array(z.string()).max(6).optional(),
})
export type AiNarrative = z.infer<typeof aiNarrativeSchema>

// ── Upload validation ────────────────────────────────────────────────────
export const uploadConstraints = {
  maxFileSizeBytes: 25 * 1024 * 1024,
  maxTotalBytes: 75 * 1024 * 1024,
  maxDatasets: 5,
  acceptedExtensions: [".csv", ".txt", ".tsv"],
} as const

export function validateUploadedFile(
  file: { name: string; size: number },
  existing: { totalBytes: number; count: number }
): { ok: true } | { ok: false; code: string; message: string } {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."))
  if (!uploadConstraints.acceptedExtensions.includes(ext as ".csv" | ".txt" | ".tsv")) {
    return {
      ok: false,
      code: "bad_format",
      message: `“${file.name}” is not a supported file. Upload files ending in .csv, .tsv or .txt.`,
    }
  }
  if (file.size === 0) {
    return { ok: false, code: "empty_file", message: `“${file.name}” is empty (0 bytes).` }
  }
  if (file.size > uploadConstraints.maxFileSizeBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — the limit is 25 MB per file.`,
    }
  }
  if (existing.totalBytes + file.size > uploadConstraints.maxTotalBytes) {
    return {
      ok: false,
      code: "session_too_large",
      message: `Upload limit reached (75 MB across all datasets). Remove a dataset or split the file.`,
    }
  }
  if (existing.count >= uploadConstraints.maxDatasets) {
    return {
      ok: false,
      code: "too_many",
      message: `You already have ${uploadConstraints.maxDatasets} datasets in this session. Remove one to add another.`,
    }
  }
  return { ok: true }
}
