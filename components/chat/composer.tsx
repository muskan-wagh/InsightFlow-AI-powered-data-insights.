"use client"

import { useEffect, useRef, useState } from "react"
import { SendHorizonal, Square } from "lucide-react"
import { useWorkspace } from "@/store/workspace"
import type { ChatSessionState } from "@/store/workspace"
import { cn } from "@/lib/utils"

export function Composer({ session }: { session: ChatSessionState }) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busy = useWorkspace((s) => s.busySessionIds[session.id] ?? false)
  const aiConfigured = useWorkspace((s) => s.aiConfigured)
  const booted = useWorkspace((s) => s.booted)
  const sendAnalysis = useWorkspace((s) => s.sendAnalysis)

  const datasetId = session.datasetIds[0]
  const dataset = useWorkspace((s) => (datasetId ? s.datasets[datasetId] : undefined))

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0"
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [value])

  const submit = async () => {
    const question = value.trim()
    if (!question || busy) return
    setValue("")
    await sendAnalysis(question, session.id)
  }

  const disabled = !dataset || !dataset.loaded

  return (
    <div className="space-y-2">
      {dataset && dataset.loaded && (dataset.suggestions.length ?? 0) > 0 && session.messages.length < 2 && (
        <div className="flex flex-wrap gap-1.5">
          {dataset.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => sendAnalysis(s, session.id)}
              disabled={busy}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 hover:text-zinc-900 dark:text-zinc-100 disabled:opacity-50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm focus-within:border-zinc-300 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={1}
          placeholder={
            disabled
              ? "Upload a dataset to start asking questions…"
              : "Ask anything about your data — e.g. “Which region generated the highest revenue?”"
          }
          className="w-full resize-none bg-transparent px-3.5 py-3 pr-12 text-[13.5px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:text-zinc-500 focus:outline-none max-h-40"
          disabled={disabled}
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || busy || value.trim().length === 0}
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            value.trim().length > 0 && !busy && !disabled
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-700"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
          )}
          aria-label={busy ? "Stop" : "Send"}
        >
          {busy ? <Square className="h-3.5 w-3.5" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex items-center justify-between px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        <span>
          {dataset && !dataset.loaded
            ? "Dataset is re-loading into the engine…"
            : disabled
              ? "No dataset attached to this analysis"
              : `Querying ${dataset?.name} · read-only SQL enforced`}
        </span>
        {!aiConfigured && booted ? (
          <span className="text-amber-600">
            AI not configured — answers are data-only. Add OPENROUTER_API_KEY to .env.local
          </span>
        ) : (
          <span>Enter to send · Shift+Enter for newline</span>
        )}
      </div>
    </div>
  )
}
