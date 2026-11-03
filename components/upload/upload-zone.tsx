"use client"

import { useCallback, useRef, useState } from "react"
import { CloudUpload, FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useWorkspace } from "@/store/workspace"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

export function UploadZone({ compact = false }: { compact?: boolean }) {
  const uploadFiles = useWorkspace((s) => s.uploadFiles)
  const uploadingCount = useWorkspace((s) => s.uploadingCount)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const issues = await uploadFiles(list)
      for (const issue of issues) {
        if (issue.code === "ok") {
          toast.success(issue.file.replace(/\.[^.]+$/, ""), { description: issue.message })
        } else if (issue.code === "warning") {
          toast.warning(issue.file, { description: issue.message })
        } else {
          toast.error(issue.file, { description: issue.message })
        }
      }
    },
    [uploadFiles]
  )

  const busy = uploadingCount > 0

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors",
        compact ? "px-3 py-4" : "px-6 py-10",
        dragging ? "border-indigo-400 bg-indigo-50/60" : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:border-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files)
          e.target.value = ""
        }}
      />
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
      ) : (
        <FileSpreadsheet className={cn("text-zinc-400 dark:text-zinc-500", compact ? "h-4 w-4" : "h-5 w-5")} />
      )}
      <div className={cn("text-zinc-600 dark:text-zinc-300", compact ? "text-xs" : "text-sm")}>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">Drop CSV files</span> or click to upload
      </div>
      {!compact && (
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
          <CloudUpload className="h-3 w-3" /> up to 25 MB each · 5 datasets · parsed & profiled locally in your browser
        </div>
      )}
      {busy && <div className="text-[11px] text-indigo-500">Processing {uploadingCount} file(s)…</div>}
    </div>
  )
}
