"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ChartSpec, ResultRow } from "@/types"
import { formatNumber } from "@/lib/format"

export const CHART_COLORS = ["#6366f1", "#14b8a6", "#f97316", "#a855f7", "#ec4899", "#0ea5e9", "#84cc16", "#f59e0b"]

const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "#71717a" },
  stroke: "#e4e4e7",
}

function downSample(rows: ResultRow[], max = 120): ResultRow[] {
  if (rows.length <= max) return rows
  const stride = Math.ceil(rows.length / max)
  return rows.filter((_, i) => i % stride === 0)
}

function prepare(spec: ChartSpec, rows: ResultRow[]): ResultRow[] {
  const numeric = typeof rows[0]?.[spec.y] === "number"
  const sorted = numeric ? [...rows] : rows
  if (spec.kind === "pie") {
    // aggregate to top 7 + Other for readability
    const top = sorted.slice(0, 7)
    const rest = sorted.slice(7)
    if (rest.length > 0) {
      const other = rest.reduce((a, r) => a + (Number(r[spec.y]) || 0), 0)
      return [...top, { [spec.x]: "Other", [spec.y]: other }]
    }
    return top
  }
  return downSample(sorted)
}

function ChartTooltip({ active, payload, label, labelKey }: { active?: boolean; payload?: { name?: string; color?: string; value?: number | string }[]; label?: string | number; labelKey?: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 shadow-md text-xs">
      {label != null && labelKey !== "pie" && (
        <div className="font-medium text-zinc-900 dark:text-zinc-100 mb-1 max-w-[240px] truncate">{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="capitalize">{p.name}</span>
          <span className="ml-auto font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">{formatNumber(Number(p.value))}</span>
        </div>
      ))}
    </div>
  )
}

export function ChartFrame({ spec, rows, height = 260 }: { spec: ChartSpec; rows: ResultRow[]; height?: number }) {
  const data = useMemo(() => prepare(spec, rows), [spec, rows])
  const margin = { top: 8, right: 12, bottom: 4, left: 4 }

  if (spec.kind === "pie") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart margin={margin}>
          <Pie
            data={data}
            dataKey={spec.y}
            nameKey={spec.x}
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip labelKey="pie" />} />
          <Legend
            iconSize={8}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "#71717a" }}
          />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (spec.kind === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey={spec.x} {...AXIS_PROPS} type="number" name={spec.x} />
          <YAxis dataKey={spec.y} {...AXIS_PROPS} type="number" name={spec.y} width={54} />
          <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={CHART_COLORS[0]} fillOpacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>
    )
  }

  if (spec.kind === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey={spec.x} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={54} tickFormatter={(v) => formatNumber(Number(v))} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey={spec.y}
            name={spec.yLabel ?? spec.y}
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (spec.kind === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={margin}>
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey={spec.x} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={54} tickFormatter={(v) => formatNumber(Number(v))} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey={spec.y} name={spec.yLabel ?? spec.y} stroke={CHART_COLORS[0]} fill="url(#areaFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  // bar (default); horizontal when labels are long
  const longLabels = data.some((r) => String(r[spec.x] ?? "").length > 14)
  if (longLabels) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 34 + 40)}>
        <BarChart data={data} layout="vertical" margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
          <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => formatNumber(Number(v))} />
          <YAxis type="category" dataKey={spec.x} {...AXIS_PROPS} width={128} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(99,102,241,0.06)" }} />
          <Bar dataKey={spec.y} name={spec.yLabel ?? spec.y} fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis dataKey={spec.x} {...AXIS_PROPS} interval="preserveStartEnd" />
        <YAxis {...AXIS_PROPS} width={54} tickFormatter={(v) => formatNumber(Number(v))} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(99,102,241,0.06)" }} />
        <Bar dataKey={spec.y} name={spec.yLabel ?? spec.y} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={42} />
      </BarChart>
    </ResponsiveContainer>
  )
}
