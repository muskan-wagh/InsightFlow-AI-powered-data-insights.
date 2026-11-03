"use client"

import dynamicImport from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

// DuckDB-Wasm must never run on the server — load the whole shell client-side.
const WorkspaceShell = dynamicImport(
  () => import("@/components/layout/workspace-shell").then((m) => m.WorkspaceShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-900/60">
        <Skeleton className="h-6 w-44 rounded-full" />
      </div>
    ),
  }
)

export default function WorkspacePage() {
  return <WorkspaceShell />
}
