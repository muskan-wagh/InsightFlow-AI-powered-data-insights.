"use client"

import { useEffect, useState } from "react"
import { useWorkspace } from "@/store/workspace"
import type { ChatSessionState } from "@/store/workspace"
import { WorkspaceSidebar } from "@/components/layout/workspace-sidebar"
import { ChatPanel } from "@/components/chat/chat-panel"
import { DatasetExplorer } from "@/components/dataset/dataset-explorer"
import { InsightsView } from "@/components/analytics/insights-view"
import { UploadZone } from "@/components/upload/upload-zone"
import { Skeleton } from "@/components/ui/skeleton"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { Table2, Lightbulb, MessageSquare } from "lucide-react"

function ViewSwitcher() {
  const view = useWorkspace((s) => s.view)
  const setView = useWorkspace((s) => s.setView)
  const activeDatasetId = useWorkspace((s) => s.activeDatasetId)
  const ds = useWorkspace((s) => (activeDatasetId ? s.datasets[activeDatasetId] : undefined))

  const items = [
    { id: "chat" as const, label: "Analysis", icon: MessageSquare },
    { id: "explorer" as const, label: "Dataset", icon: Table2 },
    { id: "insights" as const, label: "Insights", icon: Lightbulb },
  ]
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setView(it.id)}
          disabled={it.id !== "chat" && !ds}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-40",
            view === it.id ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 hover:text-zinc-800"
          )}
        >
          <it.icon className="h-3 w-3" />
          {it.label}
        </button>
      ))}
    </div>
  )
}

function TopBar() {
  const activeDatasetId = useWorkspace((s) => s.activeDatasetId)
  const ds = useWorkspace((s) => (activeDatasetId ? s.datasets[activeDatasetId] : undefined))
  return (
    <header className="flex h-12 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <ViewSwitcher />
      </div>
      <div className="flex items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
        {ds && (
          <>
            <span className="hidden sm:inline">Querying</span>
            <code className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-200">{ds.tableName}</code>
            <span className="hidden md:inline">
              {ds.rowCount.toLocaleString()} rows · {ds.columnCount} cols
            </span>
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}

function NoDatasetOnboarding() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Upload your first dataset</h2>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
            Drop one or more CSV files. They are parsed, profiled and loaded into DuckDB right here in your browser — nothing leaves your machine.
          </p>
        </div>
        <UploadZone />
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Supported: .csv / .tsv · max 25 MB per file · malformed files are rejected with clear errors
        </p>
      </div>
    </div>
  )
}

function ActiveView({ session }: { session?: ChatSessionState }) {
  const view = useWorkspace((s) => s.view)
  const activeDatasetId = useWorkspace((s) => s.activeDatasetId)
  const datasetOrder = useWorkspace((s) => s.datasetOrder)

  if (!activeDatasetId && datasetOrder.length === 0) {
    return <NoDatasetOnboarding />
  }
  if (view === "explorer" && activeDatasetId) return <DatasetExplorer datasetId={activeDatasetId} />
  if (view === "insights" && activeDatasetId) return <InsightsView datasetId={activeDatasetId} />
  if (session) return <ChatPanel session={session} />
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
      Create a new analysis from the sidebar.
    </div>
  )
}

export function WorkspaceShell() {
  const bootstrap = useWorkspace((s) => s.bootstrap)
  const booted = useWorkspace((s) => s.booted)
  const sessionOrder = useWorkspace((s) => s.sessionOrder)
  const sessionId = useWorkspace((s) => s.activeSessionId)
  const fallbackSessionId = sessionId ?? sessionOrder[sessionOrder.length - 1]
  const session = useWorkspace((s) => (fallbackSessionId ? s.sessions[fallbackSessionId] : undefined))
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) void bootstrap()
  }, [hydrated, bootstrap])

  if (!hydrated) {
    return <div className="flex h-screen items-center justify-center"><Skeleton className="h-6 w-40 rounded-full" /></div>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-900/60">
      <WorkspaceSidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1">
          <ActiveView session={session} />
        </main>
      </div>
    </div>
  )
}
