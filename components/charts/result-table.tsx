"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ResultRow } from "@/types"
import { cn } from "@/lib/utils"
import { formatCellValue, formatNumber } from "@/lib/format"

export function ResultTable({ rows, columns, maxRows = 50 }: { rows: ResultRow[]; columns: string[]; maxRows?: number }) {
  const [expanded, setExpanded] = useState(false)
  const limit = expanded ? rows.length : Math.min(rows.length, maxRows)
  const visible = rows.slice(0, limit)
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">The query returned no rows.</div>
  }
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
              {columns.map((c) => (
                <th key={c} className="px-2.5 py-1.5 text-left font-medium text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className={cn("border-b border-zinc-100 dark:border-zinc-800 last:border-0", i % 2 === 1 && "bg-zinc-50 dark:bg-zinc-900/50")}>
                {columns.map((c) => {
                  const v = row[c]
                  return (
                    <td
                      key={c}
                      className={cn(
                        "px-2.5 py-1.5 text-zinc-700 dark:text-zinc-200 whitespace-nowrap",
                        typeof v === "number" && "tabular-nums text-right"
                      )}
                      title={typeof v === "string" && v.length > 40 ? v : undefined}
                    >
                      {typeof v === "number" ? formatNumber(v) : formatCellValue(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-1 transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Collapse table" : `Show all ${rows.length.toLocaleString()} rows`}
        </button>
      )}
    </div>
  )
}
