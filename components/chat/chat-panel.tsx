"use client"

import { useEffect, useRef } from "react"
import { MessageSquarePlus, Sparkles } from "lucide-react"
import { useWorkspace } from "@/store/workspace"
import type { ChatSessionState } from "@/store/workspace"
import { MessageItem } from "@/components/chat/message-item"
import { Composer } from "@/components/chat/composer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function EmptyState({ session }: { session: ChatSessionState }) {
  const datasetId = session.datasetIds[0]
  const dataset = useWorkspace((s) => (datasetId ? s.datasets[datasetId] : undefined))
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 text-indigo-500">
        <Sparkles className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Ask your data anything</h2>
        <p className="mt-1 max-w-sm text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
          {dataset
            ? `Questions run as real read-only SQL against “${dataset.name}” (${dataset.rowCount.toLocaleString()} rows) — every number in the answer comes from the executed result.`
            : "Upload a CSV to begin the analysis."}
        </p>
      </div>
    </div>
  )
}

export function ChatPanel({ session }: { session: ChatSessionState }) {
  const busy = useWorkspace((s) => s.busySessionIds[session.id] ?? false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [session.messages.length, session.messages[session.messages.length - 1]?.status])

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-5 py-6">
          {session.messages.length === 0 && <EmptyState session={session} />}
          {session.messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
        </div>
      </div>
      <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-3xl px-5 py-3">
          <Composer session={session} />
        </div>
      </div>
      {busy && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div className="h-full w-1/3 animate-[fade-in_1s_ease-in-out_infinite_alternate] bg-indigo-500/80" /></div>}
    </div>
  )
}

export function NewAnalysisButton() {
  const createSession = useWorkspace((s) => s.createSession)
  const activeDataset = useWorkspace((s) => s.activeDatasetId)
  const className = cn("w-full justify-start gap-2")
  return (
    <Button size="sm" className={className} onClick={() => createSession(activeDataset ?? undefined)} disabled={!activeDataset}>
      <MessageSquarePlus className="h-4 w-4" />
      New analysis
    </Button>
  )
}
