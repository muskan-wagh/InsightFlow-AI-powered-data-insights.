"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type {
  AnalysisMessage,
  AnomalyScanReport,
  ChartSpec,
  DatasetProfile,
  InsightReport,
  QueryResult,
  UploadIssue,
} from "@/types"
import { parseCsvFile, CsvParseError } from "@/lib/data/csv-parser"
import { profileDataset } from "@/lib/data/profiler"
import { buildIngestCsv, duckTypeForKind } from "@/lib/data/normalize"
import {
  describeTable,
  ingestCsvFile,
  runTrustedSql,
  dropTable,
} from "@/lib/data/duckdb"
import type { ArrowKind } from "@/lib/data/duckdb"
import { validateUploadedFile } from "@/lib/validation/schema"
import { validateSql } from "@/lib/validation/sql-guard"
import { pickChart, validateChartSpec } from "@/lib/data/chart-picker"
import { llmRequest, LlmUnavailableError } from "@/lib/ai/llm"
import { buildSchemaPayload, buildConversationSlice } from "@/lib/ai/prompts"
import { generateInsightReport, reportNarrativePayload } from "@/lib/analytics/insights"
import { scanDatasetAnomalies } from "@/lib/analytics/anomaly-scan"
import { saveDatasetFile, loadDatasetFile, deleteDatasetFile } from "@/lib/data/file-store"

// ── Domain types ─────────────────────────────────────────────────────────

export interface DatasetState {
  id: string
  name: string
  tableName: string
  fileName: string
  rowCount: number
  columnCount: number
  byteSize: number
  createdAt: number
  /** present in the current DuckDB session */
  loaded: boolean
  loading: boolean
  error?: string
  profile: DatasetProfile
  columns: DatasetStateColumn[]
  ingestColumns: { name: string; duckType: string }[]
  suggestions: string[]
}

export interface DatasetStateColumn {
  name: string
  queryName: string
  duckType: string
  kind: DatasetProfile["columns"][number]["kind"]
  missing: number
  missingPercent: number
  distinct: number
  min?: number
  max?: number
  minDate?: string
  maxDate?: string
  samples: string[]
}

export type WorkspaceView = "chat" | "explorer" | "insights"

interface WorkspaceStore {
  // state
  datasets: Record<string, DatasetState>
  datasetOrder: string[]
  sessions: Record<string, ChatSessionState>
  sessionOrder: string[]
  activeDatasetId: string | null
  activeSessionId: string | null
  view: WorkspaceView
  aiConfigured: boolean
  aiModel: string
  booted: boolean
  insights: Record<string, InsightReport>
  narratives: Record<string, string>
  anomalies: Record<string, AnomalyScanReport>
  scanningAnomalies: boolean
  generatingInsights: boolean
  uploadingCount: number
  busySessionIds: Record<string, boolean>

  // actions
  bootstrap: () => Promise<void>
  refreshAiStatus: () => Promise<void>
  uploadFiles: (files: File[]) => Promise<UploadIssue[]>
  removeDataset: (id: string) => Promise<void>
  ensureDatasetLoaded: (id: string) => Promise<boolean>
  createSession: (datasetId?: string, title?: string) => string
  setActiveSession: (id: string) => void
  setActiveDataset: (id: string) => void
  setView: (view: WorkspaceView) => void
  sendAnalysis: (question: string, sessionId?: string) => Promise<void>
  generateInsightsFor: (datasetId: string) => Promise<void>
  requestNarrative: (datasetId: string) => Promise<void>
  scanAnomaliesFor: (datasetId: string) => Promise<void>
}

export interface ChatSessionState {
  id: string
  title: string
  datasetIds: string[]
  messages: AnalysisMessage[]
  createdAt: number
  updatedAt: number
}

// ── Helpers ──────────────────────────────────────────────────────────────

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.csv$/i, "")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "dataset"
}

function shortHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0
  return Math.abs(h).toString(36).slice(0, 5)
}

function kindToArrow(kind: DatasetProfile["columns"][number]["kind"]): ArrowKind {
  switch (kind) {
    case "integer":
    case "decimal":
      return "number"
    case "date":
      return "date"
    case "datetime":
      return "datetime"
    case "boolean":
      return "boolean"
    default:
      return "string"
  }
}

function measureForSuggestions(ds: DatasetState): DatasetStateColumn | null {
  const numeric = ds.columns.filter(
    (c) => (c.duckType === "BIGINT" || c.duckType === "DOUBLE") && c.queryName !== "__rowid"
  )
  const scored = numeric
    .map((c) => ({
      c,
      // monetary measures are the most natural "total" to ask about
      score:
        /revenue|sales|amount|total|profit|spend|ltv|price|cost|value/.test(c.queryName)
          ? 30
          : /quantity|qty|count|units|volume/.test(c.queryName)
            ? 20
            : 10,
    }))
    .sort((a, b) => b.score - a.score)
  return scored[0]?.c ?? null
}

function buildSuggestions(ds: DatasetState): string[] {
  const measure = measureForSuggestions(ds)
  const cat = ds.columns.find(
    (c) => c.kind === "categorical" && c.distinct >= 2 && c.distinct <= 18 && c.queryName !== "__rowid"
  )
  const date = ds.columns.find((c) => c.duckType === "DATE" || c.duckType.startsWith("TIMESTAMP"))
  const num = measure?.queryName
  const out: string[] = []
  if (cat && num) {
    out.push(`Which ${cat.queryName.replace(/_/g, " ")} generated the highest total ${num.replace(/_/g, " ")}?`)
    out.push(`Show the top 5 ${cat.queryName.replace(/_/g, " ")} by ${num.replace(/_/g, " ")}`)
  }
  if (date && num) out.push(`What is the monthly ${num.replace(/_/g, " ")} trend?`)
  if (num) out.push(`What is the average ${num.replace(/_/g, " ")}?`)
  if (num) out.push(`Find unusual ${num.replace(/_/g, " ")} values and explain them`)
  return out.slice(0, 5)
}

function previewResult(rows: Record<string, unknown>[], columns: { name: string; kind: ArrowKind }[], rowCount: number, executedSql: string, rawSql: string, durationMs: number): QueryResult {
  return {
    columns: columns.map((c) => c.name),
    rows: rows as QueryResult["rows"],
    rowCount,
    truncated: rowCount > rows.length || rowCount >= 500,
    durationMs,
    executedSql,
    rawSql,
  }
}

async function executeAnalyzedSql(
  sql: string,
  datasetTable: string,
  allTables: string[]
): Promise<QueryResult> {
  const guard = validateSql(sql, allTables)
  if (!guard.ok || !guard.sql) {
    throw new Error(guard.error ?? "The generated SQL failed safety validation.")
  }
  void datasetTable
  const started = performance.now()
  try {
    const out = await runTrustedSql(guard.sql)
    return previewResult(
      out.rows,
      out.columns,
      out.rows.length,
      guard.sql,
      sql,
      Math.round(performance.now() - started)
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`SQL execution failed: ${message}`)
  }
}

function summarizeResultLocally(result: QueryResult): string {
  // Deterministic fallback when the narrative model is unavailable —
  // still 100% derived from the executed result, never invented.
  const numericCols = result.columns.filter((c) =>
    result.rows.some((r) => typeof r[c] === "number")
  )
  const parts: string[] = []
  parts.push(
    `The query returned **${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? "" : "s"}** in ${result.durationMs} ms.`
  )
  for (const col of numericCols.slice(0, 2)) {
    const values = result.rows.map((r) => Number(r[col])).filter((n) => Number.isFinite(n))
    if (values.length === 0) continue
    const sum = values.reduce((a, b) => a + b, 0)
    parts.push(`Total **${col}**: ${sum.toLocaleString(undefined, { maximumFractionDigits: 2 })} across ${values.length} row${values.length === 1 ? "" : "s"}.`)
  }
  if (numericCols.length === 0 && result.rows.length > 0) {
    const first = result.rows[0]
    const snippet = result.columns
      .slice(0, 3)
      .map((c) => `${c}=${String(first[c] ?? "—")}`)
      .join(", ")
    parts.push(`First row: ${snippet}.`)
  }
  return parts.join(" ")
}

// ── Store ────────────────────────────────────────────────────────────────

export const useWorkspace = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      datasets: {},
      datasetOrder: [],
      sessions: {},
      sessionOrder: [],
      activeDatasetId: null,
      activeSessionId: null,
      view: "chat",
      aiConfigured: false,
      aiModel: "",
      booted: false,
      insights: {},
      narratives: {},
      anomalies: {},
      scanningAnomalies: false,
      generatingInsights: false,
      uploadingCount: 0,
      busySessionIds: {},

      async refreshAiStatus() {
        try {
          const res = await fetch("/api/health", { cache: "no-store" })
          const body = (await res.json()) as { aiConfigured?: boolean; model?: string }
          set({ aiConfigured: Boolean(body.aiConfigured), aiModel: body.model ?? "", booted: true })
        } catch {
          set({ aiConfigured: false, booted: true })
        }
      },

      async bootstrap() {
        // 1. AI status
        await get().refreshAiStatus()
        // 2. Re-register persisted datasets into this fresh DuckDB session
        const { datasets } = get()
        for (const id of Object.keys(datasets)) {
          const ds = datasets[id]
          if (!ds || ds.loaded) continue
          await get().ensureDatasetLoaded(id)
        }
        set({ booted: true })
      },

      async ensureDatasetLoaded(id) {
        const ds = get().datasets[id]
        if (!ds || ds.loaded || ds.loading) return true
        set((s) => ({ datasets: { ...s.datasets, [id]: { ...ds, loading: true } } }))
        try {
          const file = await loadDatasetFile(id)
          if (!file) throw new Error("Stored file data is missing — re-upload this dataset.")
          await ingestCsvFile(ds.tableName, ds.fileName, file.csv, ds.ingestColumns)
          set((s) => ({ datasets: { ...s.datasets, [id]: { ...s.datasets[id], loaded: true, loading: false, error: undefined } } }))
          return true
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to load dataset"
          set((s) => ({ datasets: { ...s.datasets, [id]: { ...s.datasets[id], loaded: false, loading: false, error: message } } }))
          return false
        }
      },

      async uploadFiles(files) {
        const issues: UploadIssue[] = []
        set({ uploadingCount: files.length })
        const state = get()
        const existingBytes = Object.values(state.datasets).reduce((a, d) => a + d.byteSize, 0)

        for (const file of files) {
          try {
            const check = validateUploadedFile(
              { name: file.name, size: file.size },
              { totalBytes: existingBytes, count: Object.keys(state.datasets).length }
            )
            if (!check.ok) {
              issues.push({ file: file.name, code: check.code, message: check.message })
              continue
            }

            const parsed = await parseCsvFile(file)
            const profile = profileDataset(parsed.headers, parsed.rows, file.size)
            const bundle = buildIngestCsv(parsed.headers, parsed.rows, profile)
            for (const w of [...parsed.warnings, ...bundle.warnings]) {
              issues.push({ file: file.name, code: "warning", message: w })
            }

            const id = uid()
            const name = file.name
            const tableName = `ds_${sanitizeName(name)}_${shortHash(name + id)}`
            const fileName = `ingest_${shortHash(id)}.csv`

            await ingestCsvFile(tableName, fileName, bundle.csv, bundle.columnTypes)
            const duckCols = await describeTable(tableName)
            const typeByName = new Map(duckCols.map((c) => [c.name.toLowerCase(), c.type]))

            const columns: DatasetStateColumn[] = profile.columns.map((c) => ({
              name: c.originalName,
              queryName: c.queryName === "__rowid" ? "__rowid_user" : c.queryName,
              duckType: typeByName.get((c.queryName === "__rowid" ? "__rowid_user" : c.queryName).toLowerCase()) ?? duckTypeForKind(c.kind),
              kind: c.kind,
              missing: c.missing,
              missingPercent: c.missingPercent,
              distinct: c.distinct,
              min: c.min,
              max: c.max,
              minDate: c.minDate,
              maxDate: c.maxDate,
              samples: c.samples,
            }))

            const ds: DatasetState = {
              id,
              name,
              tableName,
              fileName,
              rowCount: profile.rowCount,
              columnCount: profile.columnCount,
              byteSize: file.size,
              createdAt: Date.now(),
              loaded: true,
              loading: false,
              profile,
              columns,
              ingestColumns: bundle.columnTypes,
              suggestions: [],
            }
            ds.suggestions = buildSuggestions(ds)

            await saveDatasetFile(id, bundle.csv, fileName)
            set((s) => ({
              datasets: { ...s.datasets, [id]: ds },
              datasetOrder: [...s.datasetOrder, id],
              activeDatasetId: s.activeDatasetId ?? id,
            }))

            // Seed a session for the very first dataset
            if (!get().activeSessionId) {
              get().createSession(id, `Analysis of ${name}`)
            }

            const totalRows = profile.rowCount
            issues.push({
              file: file.name,
              code: "ok",
              message: `${totalRows.toLocaleString()} rows × ${profile.columnCount} columns ready.`,
            })
          } catch (err) {
            if (err instanceof CsvParseError) {
              issues.push({ file: file.name, code: err.code, message: err.message })
            } else {
              const message = err instanceof Error ? err.message : "Unknown upload failure"
              issues.push({ file: file.name, code: "error", message: `Could not load “${file.name}”: ${message}` })
            }
          }
        }
        set({ uploadingCount: 0 })
        return issues
      },

      async removeDataset(id) {
        const ds = get().datasets[id]
        if (ds) {
          try {
            await dropTable(ds.tableName)
          } catch {
            // table may already be gone (fresh browser session)
          }
          await deleteDatasetFile(id)
        }
        set((s) => {
          const datasets = { ...s.datasets }
          delete datasets[id]
          const datasetOrder = s.datasetOrder.filter((d) => d !== id)
          const sessions = { ...s.sessions }
          const sessionOrder: string[] = []
          for (const sid of s.sessionOrder) {
            const session = sessions[sid]
            if (!session) continue
            session.datasetIds = session.datasetIds.filter((d) => d !== id)
            if (session.datasetIds.length === 0) delete sessions[sid]
            else sessionOrder.push(sid)
          }
          const insights = { ...s.insights }
          delete insights[id]
          const anomalies = { ...s.anomalies }
          delete anomalies[id]
          const narratives = { ...s.narratives }
          delete narratives[id]
          return {
            datasets,
            datasetOrder,
            sessions,
            sessionOrder,
            insights,
            anomalies,
            narratives,
            activeDatasetId: s.activeDatasetId === id ? datasetOrder[0] ?? null : s.activeDatasetId,
          }
        })
      },

      createSession(datasetId, title) {
        const id = uid()
        const dsId = datasetId ?? get().activeDatasetId ?? undefined
        const ds = dsId ? get().datasets[dsId] : undefined
        const now = Date.now()
        const session: ChatSessionState = {
          id,
          title: title ?? `Analysis ${get().sessionOrder.length + 1}`,
          datasetIds: dsId ? [dsId] : [],
          messages: [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({
          sessions: { ...s.sessions, [id]: session },
          sessionOrder: [id, ...s.sessionOrder],
          activeSessionId: id,
          activeDatasetId: dsId ?? s.activeDatasetId,
          view: "chat",
        }))
        return id
      },

      setActiveSession(id) {
        const session = get().sessions[id]
        set({
          activeSessionId: id,
          activeDatasetId: session?.datasetIds[0] ?? get().activeDatasetId,
          view: "chat",
        })
      },

      setActiveDataset(id) {
        const ds = get().datasets[id]
        set({ activeDatasetId: id })
        // attach to the active session if not already
        const sid = get().activeSessionId
        if (sid && ds) {
          set((s) => {
            const session = s.sessions[sid]
            if (!session) return s
            if (session.datasetIds.includes(id)) return s
            const sessions = {
              ...s.sessions,
              [sid]: { ...session, datasetIds: [...session.datasetIds, id] },
            }
            return { sessions }
          })
        }
      },

      setView(view) {
        set({ view })
      },

      async sendAnalysis(question, sessionId) {
        const sid = sessionId ?? get().activeSessionId ?? get().createSession()
        const session = get().sessions[sid]
        if (!session) return
        const dsId = session.datasetIds[0] ?? get().activeDatasetId
        const ds = dsId ? get().datasets[dsId] : undefined
        if (!ds || !ds.loaded) {
          const errMsg: AnalysisMessage = {
            id: uid(),
            role: "assistant",
            content: "There is no dataset ready for this analysis. Upload a CSV first, then ask again.",
            createdAt: Date.now(),
            status: "error",
            kind: "analysis",
            error: "no_dataset",
          }
          set((s) => ({
            sessions: { ...s.sessions, [sid]: { ...session, messages: [...session.messages, errMsg], updatedAt: Date.now() } },
          }))
          return
        }

        const userMsg: AnalysisMessage = { id: uid(), role: "user", content: question, createdAt: Date.now() }
        const aiMsg: AnalysisMessage = {
          id: uid(),
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          status: "streaming",
          datasetId: ds.id,
          kind: "analysis",
        }
        set((s) => ({
          busySessionIds: { ...s.busySessionIds, [sid]: true },
          sessions: {
            ...s.sessions,
            [sid]: {
              ...session,
              messages: [...session.messages, userMsg, aiMsg],
              updatedAt: Date.now(),
            },
          },
        }))

        const patchMessage = (patch: Partial<AnalysisMessage>) => {
          set((s) => {
            const cur = s.sessions[sid]
            if (!cur) return s
            const messages = cur.messages.map((m) => (m.id === aiMsg.id ? { ...m, ...patch } : m))
            return { sessions: { ...s.sessions, [sid]: { ...cur, messages, updatedAt: Date.now() } } }
          })
        }
        const failMessage = (message: string) => {
          patchMessage({ status: "error", content: message })
          set((s) => ({ busySessionIds: { ...s.busySessionIds, [sid]: false } }))
        }

        // 1. Schema-aware SQL plan via LLM
        const schemaPayload = buildSchemaPayload({ ...ds, columns: ds.columns })
        const conversation = buildConversationSlice(session.messages)
        let plan: { sql?: string; visualization?: unknown; needsClarification?: boolean; clarification?: string; notes?: string }
        try {
          const res = await llmRequest<{ plan: typeof plan; model: string }>({
            kind: "sql-plan",
            question,
            schemas: [schemaPayload],
            conversation,
          })
          plan = res.plan
        } catch (err) {
          failMessage(
            err instanceof LlmUnavailableError
              ? err.message
              : "The analysis model could not be reached. Check the AI configuration and try again."
          )
          return
        }

        if (plan.needsClarification && !plan.sql) {
          patchMessage({
            status: "done",
            kind: "clarification",
            content: plan.clarification ?? "I need a bit more detail to answer that. Could you rephrase with specifics?",
          })
          set((s) => ({ busySessionIds: { ...s.busySessionIds, [sid]: false } }))
          return
        }

        if (!plan.sql) {
          failMessage("The model did not return a SQL query. Try rephrasing the question.")
          return
        }

        // 2. Validate + execute on DuckDB
        let result: QueryResult
        const allTables = Object.values(get().datasets).map((d) => d.tableName)
        try {
          result = await executeAnalyzedSql(plan.sql, ds.tableName, allTables)
        } catch (err) {
          const message = err instanceof Error ? err.message : "SQL execution failed"
          // One corrective retry: give the model the error and let it fix the SQL
          try {
            const retry = await llmRequest<{ plan: { sql?: string; visualization?: unknown } }>({
              kind: "sql-plan",
              question,
              schemas: [schemaPayload],
              conversation: [
                {
                  question,
                  answerPreview: `The previous SQL failed with: ${message.slice(0, 300)}`,
                  sql: plan.sql?.slice(0, 400),
                },
              ],
            })
            const retryPlan = retry.plan
            if (!retryPlan.sql) throw err
            const retryGuard = validateSql(retryPlan.sql, allTables)
            if (!retryGuard.ok || !retryGuard.sql) throw err
            const out2 = await runTrustedSql(retryGuard.sql)
            result = previewResult(out2.rows, out2.columns, out2.rows.length, retryGuard.sql, retryPlan.sql, 0)
            plan = retryPlan
          } catch {
            failMessage(message)
            return
          }
        }

        // 3. Chart from the REAL result (LLM hint validated, else deterministic)
        const arrowCols: { name: string; kind: ArrowKind }[] = result.columns.map((name, i) => ({
          name,
          kind: inferKindFromRows(result.rows, name),
        }))
        const chart: ChartSpec | null =
          validateChartSpec(plan.visualization, arrowCols, result.rows) ?? pickChart(arrowCols, result.rows)

        patchMessage({ result, sql: result.executedSql, chart, status: "streaming", content: "" })

        // 4. LLM narrative over the real rows
        try {
          const res = await llmRequest<{ explanation: { answer: string; takeaways?: string[]; chartAdjustment?: { kind: string; x: string; y?: string } | null }; model: string }>({
            kind: "explain",
            question,
            sql: result.executedSql.slice(0, 6000),
            columns: result.columns.map((c) => ({ name: c, kind: String(arrowCols.find((ac) => ac.name === c)?.kind ?? "other") })),
            rows: result.rows.slice(0, 30),
            rowCount: result.rowCount,
            truncated: result.truncated,
            datasetName: ds.name,
          })
          const explanation = res.explanation
          let chart2 = chart
          if (explanation.chartAdjustment) {
            const v = validateChartSpec(explanation.chartAdjustment, arrowCols, result.rows)
            if (v) chart2 = v
          }
          patchMessage({
            content: explanation.answer,
            takeaways: explanation.takeaways,
            status: "done",
            chart: chart2,
          })
        } catch {
          // Deterministic fallback keeps the product usable without the LLM —
          // the summary is still computed from the executed result rows.
          patchMessage({
            content: summarizeResultLocally(result),
            status: "done",
            takeaways: [],
          })
        }

        set((s) => ({ busySessionIds: { ...s.busySessionIds, [sid]: false } }))
      },

      async generateInsightsFor(datasetId) {
        const ds = get().datasets[datasetId]
        if (!ds || !ds.loaded) return
        set({ generatingInsights: true })
        try {
          const report = await generateInsightReport(
            {
              id: ds.id,
              name: ds.name,
              tableName: ds.tableName,
              columns: ds.columns.map((c) => ({
                name: c.queryName,
                type: c.duckType,
                distinct: c.distinct,
                missing: c.missing,
              })),
            },
            {}
          )
          if (!report) {
            set((s) => ({ generatingInsights: false, narratives: { ...s.narratives, [datasetId]: "" } }))
            return
          }
          let narrative: string | undefined
          if (get().aiConfigured) {
            try {
              const res = await llmRequest<{ narrative: { narrative: string; takeaways?: string[] }; model: string }>({
                kind: "insights",
                datasetName: ds.name,
                report: reportNarrativePayload(report),
              })
              narrative = res.narrative.narrative
            } catch {
              narrative = undefined
            }
          }
          set((s) => ({
            insights: { ...s.insights, [datasetId]: { ...report, narrative, dataMissingNarrative: !narrative } },
            generatingInsights: false,
          }))
        } catch {
          set({ generatingInsights: false })
        }
      },

      async requestNarrative(datasetId) {
        const ds = get().datasets[datasetId]
        const report = get().insights[datasetId]
        if (!ds || !report) return
        try {
          const res = await llmRequest<{ narrative: { narrative: string }; model: string }>({
            kind: "insights",
            datasetName: ds.name,
            report: reportNarrativePayload(report),
          })
          const narrative = res.narrative.narrative
          set((s) => ({
            narratives: { ...s.narratives, [datasetId]: narrative },
            insights: { ...s.insights, [datasetId]: { ...report, narrative, dataMissingNarrative: false } },
          }))
        } catch (err) {
          const message = err instanceof LlmUnavailableError ? err.message : "Narrative generation failed."
          set((s) => ({ narratives: { ...s.narratives, [datasetId]: message } }))
        }
      },

      async scanAnomaliesFor(datasetId) {
        const ds = get().datasets[datasetId]
        if (!ds || !ds.loaded) return
        set({ scanningAnomalies: true })
        try {
          const report = await scanDatasetAnomalies(
            {
              id: ds.id,
              name: ds.name,
              tableName: ds.tableName,
              columns: ds.columns.map((c) => ({
                name: c.queryName,
                type: c.duckType,
                distinct: c.distinct,
                missing: c.missing,
              })),
            },
            ds.rowCount
          )
          set((s) => ({ anomalies: { ...s.anomalies, [datasetId]: report }, scanningAnomalies: false }))
        } catch {
          set({ scanningAnomalies: false })
        }
      },
    }),
    {
      name: "insightflow-workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // persist metadata + conversations; CSV bytes live in IndexedDB,
        // result rows are trimmed to keep localStorage small
        const datasets: Record<string, DatasetState> = {}
        for (const [id, ds] of Object.entries(state.datasets)) {
          datasets[id] = { ...ds, loaded: false, loading: false }
        }
        const sessions: Record<string, ChatSessionState> = {}
        for (const [id, s] of Object.entries(state.sessions)) {
          sessions[id] = {
            ...s,
            messages: s.messages.map((m) =>
              m.result && m.result.rows.length > 12
                ? { ...m, result: { ...m.result, rows: m.result.rows.slice(0, 12), truncated: true } }
                : m
            ),
          }
        }
        return {
          datasets,
          datasetOrder: state.datasetOrder,
          sessions,
          sessionOrder: state.sessionOrder,
          activeDatasetId: state.activeDatasetId,
          activeSessionId: state.activeSessionId,
          view: state.view,
          insights: state.insights,
          narratives: state.narratives,
          anomalies: state.anomalies,
        } as WorkspaceStore
      },
    }
  )
)

// ── Row-kind inference (kept out of the store body for readability) ──────

function inferKindFromRows(rows: Record<string, unknown>[], col: string): ArrowKind {
  for (const r of rows) {
    const v = r[col]
    if (v === null || v === undefined) continue
    if (typeof v === "number") return "number"
    if (typeof v === "boolean") return "boolean"
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "datetime"
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date"
      return "string"
    }
  }
  return "other"
}
