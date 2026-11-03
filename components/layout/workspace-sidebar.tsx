"use client"

import Link from "next/link"
import {
  Database,
  Compass,
  KeyRound,
  Lightbulb,
  MessageSquare,
  Plus,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { useWorkspace } from "@/store/workspace"
import { UploadZone } from "@/components/upload/upload-zone"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatBytes, relativeTime } from "@/lib/format"

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
          <path d="M16 7h6v6" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">InsightFlow</span>
    </Link>
  )
}

function DatasetItem({ id }: { id: string }) {
  const ds = useWorkspace((s) => s.datasets[id])
  const active = useWorkspace((s) => s.activeDatasetId === id)
  const setActiveDataset = useWorkspace((s) => s.setActiveDataset)
  const setView = useWorkspace((s) => s.setView)
  const removeDataset = useWorkspace((s) => s.removeDataset)

  if (!ds) return null

  const qualityColor =
    ds.profile.qualityScore >= 90 ? "bg-emerald-500" : ds.profile.qualityScore >= 70 ? "bg-amber-500" : "bg-red-500"

  return (
    <div
      className={cn(
        "group relative rounded-lg border px-2.5 py-2 transition-colors",
        active ? "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm" : "border-transparent hover:bg-zinc-100 dark:bg-zinc-800/70"
      )}
    >
      <button
        onClick={() => {
          setActiveDataset(id)
          setView("chat")
        }}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
            <Table2 className="h-3 w-3" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">{ds.name}</span>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", qualityColor)} title={`Data quality ${ds.profile.qualityScore}%`} />
          <span
            role="button"
            tabIndex={0}
            aria-label="Remove dataset"
            className="opacity-0 group-hover:opacity-100 text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-all"
            onClick={(e) => {
              e.stopPropagation()
              void removeDataset(id)
              toast("Dataset removed", { description: ds.name })
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.click()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 pl-8 text-[11px] text-zinc-400 dark:text-zinc-500">
          <span>{ds.rowCount.toLocaleString()} rows</span>
          <span>·</span>
          <span>{ds.columnCount} cols</span>
          <span>·</span>
          <span>{formatBytes(ds.byteSize)}</span>
          {ds.error && (
            <>
              <span>·</span>
              <RetryChip datasetId={id} />
            </>
          )}
        </div>
      </button>
      <div className="mt-1 flex items-center gap-1 pl-8">
        <button
          onClick={() => {
            setActiveDataset(id)
            setView("explorer")
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
            active ? "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800" : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-800 hover:text-zinc-700 dark:text-zinc-200"
          )}
        >
          <Compass className="h-3 w-3" /> Explore
        </button>
        <span className="text-zinc-200">|</span>
        <button
          onClick={() => {
            setActiveDataset(id)
            setView("insights")
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
            active ? "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800" : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-800 hover:text-zinc-700 dark:text-zinc-200"
          )}
        >
          <Lightbulb className="h-3 w-3" /> Insights
        </button>
      </div>
    </div>
  )
}

function RetryChip({ datasetId }: { datasetId: string }) {
  const ensureDatasetLoaded = useWorkspace((s) => s.ensureDatasetLoaded)
  const ds = useWorkspace((s) => s.datasets[datasetId])
  if (!ds) return null
  return (
    <button
      className="text-red-500 hover:text-red-600 underline underline-offset-2"
      onClick={(e) => {
        e.stopPropagation()
        void ensureDatasetLoaded(datasetId)
      }}
    >
      reload
    </button>
  )
}

function SessionItem({ id }: { id: string }) {
  const session = useWorkspace((s) => s.sessions[id])
  const active = useWorkspace((s) => s.activeSessionId === id)
  const setActiveSession = useWorkspace((s) => s.setActiveSession)
  if (!session) return null
  return (
    <button
      onClick={() => setActiveSession(id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-white dark:bg-zinc-900 shadow-sm border border-zinc-200 dark:border-zinc-800" : "border border-transparent hover:bg-zinc-100 dark:bg-zinc-800/70"
      )}
    >
      <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", active ? "text-indigo-500" : "text-zinc-400 dark:text-zinc-500")} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-700 dark:text-zinc-200">{session.title}</span>
      <span className="shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">{relativeTime(session.updatedAt)}</span>
    </button>
  )
}

function AiStatus() {
  const configured = useWorkspace((s) => s.aiConfigured)
  const booted = useWorkspace((s) => s.booted)
  const model = useWorkspace((s) => s.aiModel)
  if (!booted) return null
  if (configured) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 text-[11px] text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="truncate max-w-[170px]">AI connected · {model || "model"}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>Serve-side key from .env.local — never exposed to the browser</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return (
    <button
      onClick={() =>
        toast("AI not configured", {
          description: "Add OPENROUTER_API_KEY=your-key to .env.local and restart. SQL, charts, profiling and anomaly detection work without it.",
        })
      }
      className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-left text-[11px] text-amber-700 hover:bg-amber-50"
    >
      <KeyRound className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">AI key missing — click to learn how to enable narratives</span>
    </button>
  )
}

export function WorkspaceSidebar() {
  const datasetOrder = useWorkspace((s) => s.datasetOrder)
  const sessionOrder = useWorkspace((s) => s.sessionOrder)
  const createSession = useWorkspace((s) => s.createSession)
  const activeDataset = useWorkspace((s) => s.activeDatasetId)

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70">
      <div className="flex items-center justify-between px-3.5 pt-4 pb-3">
        <Brand />
        <Link href="/" className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:text-zinc-200" title="Back to landing">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 10.182V22h18V10.182L12 2z" />
          </svg>
        </Link>
      </div>

      <div className="px-3.5 pb-3">
        <Button size="sm" className="w-full" onClick={() => createSession(activeDataset ?? undefined)} disabled={!activeDataset}>
          <Plus className="h-4 w-4" /> New analysis
        </Button>
      </div>

      <div className="px-3.5 pb-2">
        <UploadZone compact />
      </div>

      <div className="mt-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 pb-4">
        <DatasetsSection datasetOrder={datasetOrder} />
        <ConversationsSection sessionOrder={sessionOrder} />
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 p-3.5">
        <AiStatus />
      </div>
    </aside>
  )
}

function DatasetsSection({ datasetOrder }: { datasetOrder: string[] }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        <Database className="h-3 w-3" /> Datasets
        <Badge variant="outline" className="ml-auto">{datasetOrder.length}</Badge>
      </h3>
      <div className="space-y-1">
        {datasetOrder.length === 0 && <p className="px-1 pt-1 text-[12px] text-zinc-400 dark:text-zinc-500">No datasets yet — drop a CSV above.</p>}
        {datasetOrder.map((id) => (
          <DatasetItem key={id} id={id} />
        ))}
      </div>
    </section>
  )
}

function ConversationsSection({ sessionOrder }: { sessionOrder: string[] }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        <Sparkles className="h-3 w-3" /> Conversations
        <Badge variant="outline" className="ml-auto">{sessionOrder.length}</Badge>
      </h3>
      <div className="space-y-1">
        {sessionOrder.length === 0 && <p className="px-1 pt-1 text-[12px] text-zinc-400 dark:text-zinc-500">Start a new analysis to create one.</p>}
        {sessionOrder.map((id) => (
          <SessionItem key={id} id={id} />
        ))}
      </div>
    </section>
  )
}
