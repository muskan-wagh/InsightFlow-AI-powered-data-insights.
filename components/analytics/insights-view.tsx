"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  BrainCircuit,
  Building2,
  CalendarRange,
  Layers,
  Lightbulb,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useWorkspace } from "@/store/workspace"
import { explainAnomaly } from "@/lib/analytics/anomaly-detection"
import { ChartFrame } from "@/components/charts/chart-frame"
import { Markdown } from "@/components/chat/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { AnomalyScanReport, ResultRow } from "@/types"
import { formatCellValue, formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

function KpiGrid({ datasetId }: { datasetId: string }) {
  const report = useWorkspace((s) => s.insights[datasetId])
  if (!report) return null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {report.kpis.map((kpi, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{kpi.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{kpi.formatted}</div>
          {kpi.sigmaNote && <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{kpi.sigmaNote}</div>}
        </div>
      ))}
    </div>
  )
}

function TrendCard({ datasetId }: { datasetId: string }) {
  const report = useWorkspace((s) => s.insights[datasetId])
  const trend = report?.trends?.[0]
  if (!trend) return null
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
          <CalendarRange className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" /> {trend.title}
        </h3>
        {trend.changePercent !== undefined && (
          <Badge variant={trend.direction === "up" ? "success" : trend.direction === "down" ? "danger" : "secondary"}>
            {trend.direction === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend.changePercent > 0 ? "+" : ""}
            {trend.changePercent}% total
          </Badge>
        )}
      </div>
      <div className="mt-2">
        <ChartFrame
          spec={{ kind: "area", x: "date", y: "value", title: trend.title }}
          rows={trend.points as unknown as ResultRow[]}
          height={230}
        />
      </div>
      {trend.caption && <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{trend.caption}</p>}
    </div>
  )
}

function BreakdownGrid({ datasetId }: { datasetId: string }) {
  const report = useWorkspace((s) => s.insights[datasetId])
  if (!report || report.breakdowns.length === 0) return null
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {report.breakdowns.map((b, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
            <Building2 className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" /> {b.title}
          </h3>
          <div className="mt-2">
            <ChartFrame
              spec={{ kind: b.values.length <= 6 ? "pie" : "bar", x: "name", y: "value" }}
              rows={b.values as unknown as ResultRow[]}
              height={240}
            />
          </div>
          {b.caption && <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{b.caption}</p>}
        </div>
      ))}
    </div>
  )
}

function AnomaliesSection({ datasetId }: { datasetId: string }) {
  const anomalies = useWorkspace((s) => s.anomalies[datasetId])
  const scanning = useWorkspace((s) => s.scanningAnomalies)
  const scanAnomaliesFor = useWorkspace((s) => s.scanAnomaliesFor)
  const [openReason, setOpenReason] = useState<number | null>(null)

  const worst = useMemo(() => {
    if (!anomalies) return null
    const withRecords = anomalies.reports.filter((r) => r.records.length > 0)
    if (withRecords.length === 0) return null
    return withRecords[0].records[0]
  }, [anomalies])

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
          <ShieldAlert className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" /> Anomaly detection
          <Badge variant="outline" className="ml-1">IQR fences + 3σ z-scores</Badge>
        </h3>
        <Button size="sm" variant="outline" disabled={scanning} onClick={() => void scanAnomaliesFor(datasetId)}>
          {scanning ? <Activity className="h-3.5 w-3.5 animate-pulse" /> : <Search className="h-3.5 w-3.5" />}
          {scanning ? "Scanning…" : anomalies ? "Re-scan" : "Scan for anomalies"}
        </Button>
      </div>

      {anomalies && (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
            Scanned {anomalies.scanned.length} numeric columns on {formatNumber(anomalies.totalFlaggedRows)} flagged rows.
            {anomalies.totalFlaggedRows === 0 && " No statistical outliers were detected — the data is clean."}
          </p>
          {anomalies.reports
            .filter((r) => r.count > 0)
            .map((r) => (
              <div key={r.column} className="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[12px] font-semibold text-zinc-800">{r.column}</code>
                  <Badge variant="danger">{r.count} flagged</Badge>
                  <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
                    {formatPercent(r.proportion)} of rows · typical {formatNumber(r.median)} (median) · fences [
                    {formatNumber(r.lowerBound ?? 0)}, {formatNumber(r.upperBound ?? 0)}]
                  </span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {r.records.slice(0, 6).map((rec) => (
                    <div key={`${rec.rowId}-${r.column}`} className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2.5">
                      <button
                        className="flex w-full items-center justify-between text-left text-[12px]"
                        onClick={() => setOpenReason(openReason === rec.rowId && r.column === (worst?.column ?? "") ? null : rec.rowId)}
                      >
                        <span className="truncate font-mono text-zinc-700 dark:text-zinc-200">
                          row #{((rec.rowId ?? 0) + 1).toLocaleString()} · {r.column} = {formatNumber(rec.value)}
                        </span>
                        <span className="flex items-center gap-1.5 pl-2">
                          <Badge variant={rec.method === "z-score" ? "info" : rec.method === "both" ? "warning" : "danger"}>
                            {rec.method === "both" ? "IQR + z-score" : rec.method === "z-score" ? `z=${rec.zScore}` : "IQR fence"}
                          </Badge>
                        </span>
                      </button>
                      {openReason === rec.rowId && rec.row && (
                        <div className="mt-2 border-t border-zinc-100 dark:border-zinc-800 pt-2">
                          <ul className="space-y-0.5">
                            {explainAnomaly(r, rec).map((why, i) => (
                              <li key={i} className="text-[11.5px] text-zinc-600 dark:text-zinc-300">– {why}</li>
                            ))}
                          </ul>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {Object.entries(rec.row)
                              .filter(([k]) => k !== "__rowid")
                              .slice(0, 8)
                              .map(([k, v]) => (
                                <span key={k} className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10.5px] text-zinc-600 dark:text-zinc-300">
                                  {k}: {formatCellValue(v)}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {r.count > 6 && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">+ {r.count - 6} more flagged rows in this column…</p>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
      {!anomalies && !scanning && (
        <p className="mt-3 text-[12.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          Runs real statistics (25/75 percentiles, 1.5·IQR fences, |z| ≥ 3) on executed column data — no model involved.
        </p>
      )}
      {worst && null}
    </div>
  )
}

function NarrativeCard({ datasetId }: { datasetId: string }) {
  const report = useWorkspace((s) => s.insights[datasetId])
  const requestNarrative = useWorkspace((s) => s.requestNarrative)
  const aiConfigured = useWorkspace((s) => s.aiConfigured)
  if (!report) return null
  const has = Boolean(report.narrative)
  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/60 to-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
          <BrainCircuit className="h-3.5 w-3.5 text-indigo-500" /> Business insights
        </h3>
        <Button size="sm" variant="ghost" onClick={() => void requestNarrative(datasetId)} disabled={!aiConfigured}>
          <RefreshCw className="h-3.5 w-3.5" /> {has ? "Rewrite" : "Generate narrative"}
        </Button>
      </div>
      {report.narrative ? (
        <div className="mt-2">
          <Markdown>{report.narrative}</Markdown>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          {aiConfigured
            ? "Generate an executive narrative grounded in the KPIs, breakdowns and trends above."
            : "AI narrative requires OPENROUTER_API_KEY. The statistics below are already computed from real queries."}
        </p>
      )}
    </div>
  )
}

export function InsightsView({ datasetId }: { datasetId: string }) {
  const ds = useWorkspace((s) => s.datasets[datasetId])
  const report = useWorkspace((s) => s.insights[datasetId])
  const generating = useWorkspace((s) => s.generatingInsights)
  const generateInsightsFor = useWorkspace((s) => s.generateInsightsFor)
  const setView = useWorkspace((s) => s.setView)
  const insightsDispatch = generateInsightsFor

  useEffect(() => {
    if (ds?.loaded && !report && !generating) {
      void insightsDispatch(datasetId)
    }
  }, [ds?.loaded, report, generating, datasetId, insightsDispatch])

  if (!ds || !ds.loaded) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
        This dataset is not loaded yet.
      </div>
    )
  }

  if (generating && !report) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex h-full items-center justify-center">
        <Button size="sm" onClick={() => void generateInsightsFor(datasetId)}>
          <Lightbulb className="h-4 w-4" /> Generate insights
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <Layers className="h-4 w-4 text-zinc-400 dark:text-zinc-500" /> Insights — {ds.name}
            </h1>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              KPIs, breakdowns and trends computed with aggregate SQL · {new Date(report.generatedAt).toLocaleTimeString()}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={generating} onClick={() => void generateInsightsFor(datasetId)}>
            <RefreshCw className={cn("h-3.5 w-3.5", generating && "animate-spin")} /> Recompute
          </Button>
        </header>

        <KpiGrid datasetId={datasetId} />
        <NarrativeCard datasetId={datasetId} />
        <TrendCard datasetId={datasetId} />
        <BreakdownGrid datasetId={datasetId} />
        <AnomaliesSection datasetId={datasetId} />

        <button onClick={() => setView("chat")} className="mx-auto block text-[12.5px] text-indigo-600 hover:underline">
          Ask a follow-up question about these insights →
        </button>
      </div>
    </div>
  )
}
