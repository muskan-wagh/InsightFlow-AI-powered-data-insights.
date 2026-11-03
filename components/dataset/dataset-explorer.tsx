"use client"

import { useEffect, useState } from "react"
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Copy,
  Hash,
  RefreshCw,
  Sigma,
  Table2,
  Type,
} from "lucide-react"
import { useWorkspace } from "@/store/workspace"
import { runTrustedSql, q } from "@/lib/data/duckdb"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import type { ColumnKind, ResultRow } from "@/types"
import { formatBytes, formatCellValue, formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

const KIND_ICONS: Record<ColumnKind, React.ReactNode> = {
  integer: <Hash className="h-3 w-3" />,
  decimal: <Sigma className="h-3 w-3" />,
  date: <CalendarDays className="h-3 w-3" />,
  datetime: <CalendarDays className="h-3 w-3" />,
  boolean: <CheckCircle2 className="h-3 w-3" />,
  categorical: <Type className="h-3 w-3" />,
  text: <Type className="h-3 w-3" />,
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-red-600",
          (!tone || tone === undefined) && "text-zinc-900 dark:text-zinc-100"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  )
}

function ColumnTable({ datasetId }: { datasetId: string }) {
  const ds = useWorkspace((s) => s.datasets[datasetId])
  if (!ds) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 text-left">
            <th className="px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Column</th>
            <th className="px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Type (DuckDB)</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Missing</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Distinct</th>
            <th className="px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Range</th>
            <th className="px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Sample values</th>
          </tr>
        </thead>
        <tbody>
          {ds.columns.map((c) => {
            const missingTone = c.missing === 0 ? "text-zinc-600 dark:text-zinc-300" : c.missingPercent < 10 ? "text-amber-600" : "text-red-600"
            const range =
              c.min !== undefined
                ? `${formatNumber(c.min)} – ${formatNumber(c.max ?? 0)}`
                : c.minDate !== undefined
                  ? `${c.minDate} → ${c.maxDate}`
                  : "—"
            return (
              <tr key={c.queryName} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:bg-zinc-900/50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 dark:text-zinc-500">{KIND_ICONS[c.kind]}</span>
                    <span className="font-medium text-zinc-800">{c.name}</span>
                    {c.queryName.toLowerCase() !== c.name.toLowerCase() && (
                      <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500" title="Query identifier">↔ {c.queryName}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="info" className="font-mono text-[10px]">{c.duckType}</Badge>
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", missingTone)}>
                  {c.missing > 0 ? `${formatNumber(c.missing)} (${formatPercent(c.missingPercent)})` : "0"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatNumber(c.distinct)}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{range}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.samples.slice(0, 3).map((s, i) => (
                      <span key={i} className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300 max-w-[140px] truncate" title={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PreviewGrid({ tableName }: { tableName: string }) {
  const [rows, setRows] = useState<ResultRow[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    runTrustedSql(`SELECT * FROM ${q(tableName)} LIMIT 50`)
      .then((out) => {
        if (!alive) return
        setRows(out.rows as ResultRow[])
        setColumns(out.columns.map((c) => c.name).filter((c) => c !== "__rowid"))
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Preview failed"))
    return () => {
      alive = false
    }
  }, [tableName])

  if (error) return <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
  if (!rows) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) return <div className="text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">No rows.</div>
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 text-left">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-zinc-100 dark:border-zinc-800 last:border-0", i % 2 === 1 && "bg-zinc-50 dark:bg-zinc-900/50")}>
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 text-zinc-700 dark:text-zinc-200" title={typeof r[c] === "string" ? String(r[c]) : undefined}>
                  {formatCellValue(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DatasetExplorer({ datasetId }: { datasetId: string }) {
  const ds = useWorkspace((s) => s.datasets[datasetId])
  const ensureDatasetLoaded = useWorkspace((s) => s.ensureDatasetLoaded)
  const [tableName, setTableName] = useState(0) // refresh preview key

  if (!ds) return <div className="p-8 text-sm text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">Dataset not found.</div>
  if (!ds.loaded || !ds.profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{ds.error ?? "The dataset is still loading into the local engine."}</p>
        <Button size="sm" variant="outline" onClick={() => void ensureDatasetLoaded(datasetId)}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry load
        </Button>
      </div>
    )
  }

  const p = ds.profile
  const quality =
    p.qualityScore >= 90 ? { tone: "good" as const, label: "Excellent" } : p.qualityScore >= 70 ? { tone: "warn" as const, label: "Needs attention" } : { tone: "bad" as const, label: "Poor quality" }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Table2 className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{ds.name}</h1>
            </div>
            <p className="mt-0.5 text-[12.5px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              Engine table <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 font-mono text-[11px]">{ds.tableName}</code> · uploaded locally
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTableName((k) => k + 1)}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Rows" value={formatNumber(p.rowCount)} sub={`${p.columnCount} columns`} />
          <Stat label="Duplicate rows" value={formatNumber(p.duplicateRows)} sub={`${p.rowsWithMissing} rows have missing`} tone={p.duplicateRows > 0 ? "warn" : undefined} />
          <Stat label="File size" value={formatBytes(p.byteSize)} sub={`${(p.byteSize / Math.max(1, p.rowCount)).toFixed(0)} B / row`} />
          <Stat label="Quality score" value={`${p.qualityScore}%`} sub={quality.label} tone={quality.tone} />
        </div>

        {p.issues.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
            <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-amber-800">
              <AlertCircle className="h-3.5 w-3.5" /> Data quality notes ({p.issues.length})
            </h3>
            <ul className="mt-1.5 space-y-1">
              {p.issues.slice(0, 8).map((issue, i) => (
                <li key={i} className="text-[12.5px] text-amber-700">• {issue}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">Column profile</h2>
          <ColumnTable datasetId={datasetId} />
        </section>

        <section className="space-y-2" key={tableName}>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            Data preview <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">(first 50 rows, read from DuckDB)</span>
          </h2>
          <PreviewGrid tableName={ds.tableName} />
        </section>
      </div>
    </div>
  )
}
