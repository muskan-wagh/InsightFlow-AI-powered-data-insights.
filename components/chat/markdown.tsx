"use client"

import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

/** Compact markdown for chat answers — tight spacing, no giant headings. */
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[13.5px] leading-relaxed prose-sm max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 text-zinc-700 dark:text-zinc-200">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{children}</strong>,
          em: ({ children }) => <em className="text-zinc-600 dark:text-zinc-300">{children}</em>,
          ul: ({ children }) => <ul className="mb-2 space-y-1 last:mb-0 list-disc pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 space-y-1 last:mb-0 list-decimal pl-4">{children}</ol>,
          li: ({ children }) => <li className="text-zinc-700 dark:text-zinc-200">{children}</li>,
          h1: ({ children }) => <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5 text-sm">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5 text-sm">{children}</h3>,
          h3: ({ children }) => <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1 text-[13px]">{children}</h4>,
          code: ({ children, className }) => {
            const isBlock = /language-/.test(className ?? "")
            if (isBlock) {
              return <code className="block font-mono text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-md p-3 overflow-x-auto text-zinc-800">{children}</code>
            }
            return <code className="font-mono text-[12px] bg-zinc-100 dark:bg-zinc-800 rounded px-1 py-0.5 text-zinc-800">{children}</code>
          },
          pre: ({ children }) => <pre className="bg-transparent">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-200 dark:border-zinc-800 pl-3 text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 italic">{children}</blockquote>,
          a: ({ children, href }) => <a href={href} className="text-indigo-600 underline underline-offset-2">{children}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
