import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  Database,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Table2,
  TrendingUp,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"

const FEATURES = [
  {
    icon: Database,
    title: "Real SQL, not hallucinated numbers",
    body: "Questions compile into read-only DuckDB SQL that runs on your actual rows. The model writes the query — the engine computes the answer.",
  },
  {
    icon: FileSpreadsheet,
    title: "Drop any CSV, any schema",
    body: "Multi-file uploads, mixed schemas, messy headers, malformed rows. Files are validated and profiled before a single query runs.",
  },
  {
    icon: TrendingUp,
    title: "Charts that fit the data",
    body: "The visualization is chosen from the shape of the executed result — trends, breakdowns, rankings and scatter analysis, rendered with Recharts.",
  },
  {
    icon: ShieldCheck,
    title: "Statistical anomaly detection",
    body: "IQR fences and 3σ z-scores computed on real columns. Every flagged row ships with the exact fence values that caught it.",
  },
  {
    icon: MessageSquareText,
    title: "Context-aware follow-ups",
    body: "“Now show its monthly trend” — InsightFlow keeps conversation context per dataset and resolves what “it” refers to.",
  },
  {
    icon: Lock,
    title: "Your data never leaves the browser",
    body: "Parsing, profiling and storage run client-side. The only server call is the LLM proxy — no key is ever exposed to the client.",
  },
]

const STEPS = [
  { n: "01", title: "Upload a CSV", body: "Drag it in. Every column is type-detected and profiled — missing values, duplicates, ranges." },
  { n: "02", title: "Ask in plain English", body: "The schema guides the model to a validated, read-only SQL query against your table." },
  { n: "03", title: "Get the verified answer", body: "Actual rows → chart, table and a narrative grounded in the executed results." },
]

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-100 dark:border-zinc-800 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
                <path d="M16 7h6v6" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">InsightFlow</span>
            <Badge variant="outline" className="ml-1 hidden sm:inline-flex">AI Data Analyst</Badge>
          </div>
          <div className="flex items-center gap-3">
            <a href="#features" className="hidden text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:text-zinc-100 sm:block">Features</a>
            <a href="#how" className="hidden text-[13px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:text-zinc-100 sm:block">How it works</a>
            <ThemeToggle />
            <Button size="sm" asChild>
              <Link href="/workspace">
                Open workspace <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.10),transparent)]"
        />
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-5 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1 text-[12px] text-zinc-600 dark:text-zinc-300">
              <Sparkles className="h-3 w-3 text-indigo-500" />
              DuckDB-Wasm executes every query on real data
            </div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-6xl">
              Chat with your data.
              <span className="block bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                Get answers you can trust.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 sm:text-base">
              Upload one or more CSV files and ask questions in plain English. InsightFlow turns them into
              read-only SQL, executes them on DuckDB inside your browser, and explains the verified results —
              with charts, anomaly detection and business insights.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="h-11 px-6" asChild>
                <Link href="/workspace">
                  <FileSpreadsheet className="h-4 w-4" />
                  Upload a dataset — it&apos;s free
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-6" asChild>
                <Link href="/workspace">
                  Try the sample data <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-[12px] text-zinc-400 dark:text-zinc-500">
              Sample datasets: <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">sales_orders.csv</code> ·{" "}
              <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">customers.csv</code> ·{" "}
              <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">returns_refunds.csv</code> in <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">/datasets</code>
            </p>
          </div>

          {/* Product visual */}
          <div className="relative mx-auto mt-14 max-w-4xl">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)]">
              <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70">
                <div className="flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 px-4 py-2.5">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="ml-3 flex items-center gap-1.5 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                    <Lock className="h-3 w-3" /> localhost:3000/workspace
                  </span>
                </div>
                <div className="grid grid-cols-[200px_1fr] max-md:grid-cols-1">
                  {/* sidebar mock */}
                  <div className="hidden border-r border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 md:block">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Datasets</div>
                    {["sales_orders.csv", "customers.csv", "returns_refunds.csv"].map((f, i) => (
                      <div key={f} className={`mt-1.5 flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] ${i === 0 ? "border-zinc-200 dark:border-zinc-800 shadow-sm" : "border-transparent"}`}>
                        <Table2 className="h-3 w-3 text-zinc-400 dark:text-zinc-500" />
                        <span className="truncate text-zinc-700 dark:text-zinc-200">{f}</span>
                        <span className={`ml-auto h-1.5 w-1.5 rounded-full ${i === 2 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    ))}
                    <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Conversations</div>
                    <div className="mt-1.5 flex items-center gap-2 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[11px] shadow-sm">
                      <MessageSquareText className="h-3 w-3 text-indigo-500" />
                      <span className="truncate text-zinc-700 dark:text-zinc-200">Q3 revenue by region</span>
                    </div>
                  </div>
                  {/* chat mock */}
                  <div className="p-4">
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[12px] text-zinc-50">
                        Which region generated the highest revenue, and how did West trend by month?
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
                        <TrendingUp className="h-3 w-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold">InsightFlow</div>
                        <p className="mt-1 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">West</span> leads with{" "}
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">$432,180</span> — 37.1% of total revenue.
                          Its monthly revenue grew steadily through 2025 with a dip in March…
                        </p>
                        <div className="mt-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-3 py-1.5">
                            <BarChart3 className="h-3 w-3 text-zinc-400 dark:text-zinc-500" />
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Chart · Table · SQL</span>
                            <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">2,146 rows · 38 ms</span>
                          </div>
                          <div className="flex h-28 items-end gap-1.5 px-3 pb-2 pt-3">
                            {[34, 28, 44, 62, 55, 49, 74, 66, 60, 84, 72, 92].map((h, i) => (
                              <div key={i} className="flex-1 rounded-t-sm bg-gradient-to-t from-indigo-500/70 to-indigo-400/90" style={{ height: `${h}%` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-8 left-1/2 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-zinc-300/60 to-transparent"
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 dark:bg-zinc-900/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
              An analytical engine with a conversational UI
            </h2>
            <p className="mt-3 text-[15px] text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
              Not a chatbot that invents numbers — a data product that computes them.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)]">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 transition-colors group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600">
                  <f.icon className="h-4 w-4" />
                </div>
                <h3 className="mt-3.5 text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">Three steps to the first insight</h2>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative pl-14">
                <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 font-mono text-[13px] font-semibold text-indigo-600">
                  {s.n}
                </span>
                <h3 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI config note */}
      <section className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 dark:bg-zinc-900/40 py-14">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
            <KeyRound className="h-4 w-4" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Bring your own model key</h2>
          <p className="max-w-xl text-[13.5px] leading-relaxed text-zinc-500 dark:text-zinc-400 dark:text-zinc-500">
            InsightFlow reads <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">OPENROUTER_API_KEY</code> from{" "}
            <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">.env.local</code> on the server — it is never shipped to the browser.
            Any OpenRouter model works via <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">OPENROUTER_MODEL</code>. CSV analysis,
            charts, profiling and anomaly detection run fully without a key.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
            <span className="text-[12px] text-zinc-400 dark:text-zinc-500">Works with free-tier models · one corrective retry on failed SQL</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-900 px-8 py-14 text-center">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(99,102,241,0.25),transparent)]" />
            <span className="relative flex h-10 w-10 mx-auto items-center justify-center rounded-xl bg-white/10 dark:bg-white/10 text-white">
              <Layers className="h-5 w-5" />
            </span>
            <h2 className="relative mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Stop reading CSVs. Start asking them.
            </h2>
            <p className="relative mx-auto mt-3 max-w-md text-[14px] text-zinc-400 dark:text-zinc-500">
              Your datasets stay in your browser — the engine, the charts and the conversation.
            </p>
            <Button size="lg" className="relative mt-7 h-11 bg-white dark:bg-zinc-900 px-6 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200" asChild>
              <Link href="/workspace">
                Open the workspace <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-100 dark:border-zinc-800 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-[12px] text-zinc-400 dark:text-zinc-500">
          <span>© 2026 InsightFlow — AI-powered data insights</span>
          <span className="flex items-center gap-4">
            <span>Next.js · DuckDB-Wasm · Recharts · OpenRouter</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
