"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  Database,
  HelpCircle,
  Loader2,
  Table as TableIcon,
  TerminalSquare,
  TrendingUp,
} from "lucide-react"
import type { AnalysisMessage } from "@/types"
import { Markdown } from "@/components/chat/markdown"
import { ChartFrame } from "@/components/charts/chart-frame"
import { ResultTable } from "@/components/charts/result-table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          // clipboard unavailable
        }
      }}
      className="inline-flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-200 transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

/** The result card: Chart | Table | SQL tabs rendered from executed data. */
function ResultPanel({ message }: { message: AnalysisMessage }) {
  const result = message.result
  if (!result) return null
  const chart = message.chart
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <Tabs defaultValue={chart ? "chart" : "table"}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
          <TabsList>
            {chart && (
              <TabsTrigger value="chart">
                <BarChart3 className="h-3 w-3" /> Chart
              </TabsTrigger>
            )}
            <TabsTrigger value="table">
              <TableIcon className="h-3 w-3" /> Table
            </TabsTrigger>
            <TabsTrigger value="sql">
              <TerminalSquare className="h-3 w-3" /> SQL
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            <Database className="h-3 w-3" />
            {formatNumber(result.rowCount)} rows · {result.durationMs} ms
          </div>
        </div>
        <div className="p-3">
          {chart && (
            <TabsContent value="chart">
              <ChartFrame spec={chart} rows={result.rows} />
            </TabsContent>
          )}
          <TabsContent value="table">
            <ResultTable rows={result.rows} columns={result.columns} />
          </TabsContent>
          <TabsContent value="sql">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {result.truncated ? "Executed with a 500-row result cap" : "Executed SQL (read-only)"}
                </span>
                <CopyButton text={result.rawSql} />
              </div>
              <pre className="font-mono text-[11.5px] leading-relaxed bg-zinc-950 text-zinc-100 rounded-lg p-3 overflow-x-auto whitespace-pre">
                {result.rawSql}
              </pre>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

export function MessageItem({ message }: { message: AnalysisMessage }) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 text-zinc-50 px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  const isError = message.status === "error"
  const isClarification = message.kind === "clarification"

  return (
    <div className="flex gap-2.5 animate-fade-in">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
          isError
            ? "border-red-200 bg-red-50 text-red-600"
            : isClarification
              ? "border-amber-200 bg-amber-50 text-amber-600"
              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200"
        )}
      >
        {isError ? <AlertTriangle className="h-3.5 w-3.5" /> : isClarification ? <HelpCircle className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">InsightFlow</span>
          {message.status === "streaming" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> analyzing…
            </span>
          )}
          {message.status === "done" && message.result && (
            <Badge variant="secondary" className="text-[10px]">
              {formatNumber(message.result.rowCount)} rows · SQL executed
            </Badge>
          )}
        </div>
        <div
          className={cn(
            "mt-1",
            isError && "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700",
            isClarification && "rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[13px] text-amber-800"
          )}
        >
          {message.content ? (
            <Markdown>{message.content}</Markdown>
          ) : message.status === "streaming" && !message.result ? (
            <div className="flex items-center gap-2 py-1 text-[13px] text-zinc-400 dark:text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running analysis…
            </div>
          ) : null}
        </div>
        {message.takeaways && message.takeaways.length > 0 && (
          <ul className="mt-2 space-y-1">
            {message.takeaways.map((t, i) => (
              <li key={i} className="flex gap-1.5 text-[12.5px] text-zinc-600 dark:text-zinc-300">
                <span className="text-indigo-500 mt-[3px]">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
        {message.result && <ResultPanel message={message} />}
      </div>
    </div>
  )
}
