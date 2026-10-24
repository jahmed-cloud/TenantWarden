import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, GaugeChart, LineChart, PieChart, SankeyChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkPointComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import type { CSSProperties } from 'react'
import { useTenantWardenStore } from '@/store/tenantWardenStore'

// Register only what these charts use — the full echarts bundle is ~1 MB
echarts.use([BarChart, GaugeChart, LineChart, PieChart, SankeyChart,
  GridComponent, LegendComponent, MarkPointComponent, TooltipComponent, CanvasRenderer])

function ReactECharts(props: { option: EChartsOption; style?: CSSProperties; notMerge?: boolean }) {
  return <ReactEChartsCore echarts={echarts} {...props} />
}

// ── Palette ────────────────────────────────────────────────────────────────────

const C = {
  blue:    '#3b82f6',
  red:     '#ef4444',
  amber:   '#f59e0b',
  green:   '#22c55e',
  purple:  '#8b5cf6',
  gray:    '#6b7280',
  bg:      'transparent',
}

/** Chart chrome colours for the active theme (light by default). */
function useChartColors() {
  const theme = useTenantWardenStore((st) => st.theme)
  const dark  = theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  return dark
    ? { grid: '#1f2937', text: '#9ca3af', tipBg: '#111827', tipBorder: '#374151', tipText: '#f9fafb', strong: '#f9fafb', track: '#1f2937', sliceBorder: '#111827' }
    : { grid: '#e5e7eb', text: '#6b7280', tipBg: '#ffffff', tipBorder: '#e5e7eb', tipText: '#111827', strong: '#111827', track: '#f3f4f6', sliceBorder: '#ffffff' }
}

// ── Sign-in activity line chart ────────────────────────────────────────────────

export function SignInChart({ data }: { data?: { date: string; total: number; risky: number }[] }) {
  const T = useChartColors()
  const days   = data?.map(d => d.date)  ?? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const totals = data?.map(d => d.total) ?? [420, 380, 510, 490, 380, 220, 610]
  const risky  = data?.map(d => d.risky) ?? [8, 5, 12, 9, 4, 3, 48]

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    legend: { data: ['Total sign-ins', 'Risky sign-ins'], textStyle: { color: T.text, fontSize: 11 }, bottom: 0 },
    grid: { top: 8, right: 8, bottom: 44, left: 40, containLabel: false },
    xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: T.grid } }, axisLabel: { color: T.text, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: T.text, fontSize: 11 }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
    series: [
      { name: 'Total sign-ins', type: 'bar', data: totals, itemStyle: { color: C.blue, borderRadius: [2,2,0,0] }, barMaxWidth: 28 },
      { name: 'Risky sign-ins', type: 'line', data: risky, smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { color: C.red, width: 2 }, itemStyle: { color: C.red }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(239,68,68,0.2)' }, { offset: 1, color: 'rgba(239,68,68,0)' }] } } },
    ],
  }
  return <ReactECharts option={option} style={{ height: 160 }} notMerge />
}

// ── Secure score gauge ─────────────────────────────────────────────────────────

export function SecureScoreGauge({ score = 72, max = 100 }: { score?: number; max?: number }) {
  const T = useChartColors()
  const pct     = score / max
  const color   = pct >= 0.8 ? C.green : pct >= 0.6 ? C.amber : C.red

  const option: EChartsOption = {
    backgroundColor: C.bg,
    series: [{
      type:       'gauge',
      startAngle: 210,
      endAngle:   -30,
      min: 0, max,
      progress: { show: true, width: 14, itemStyle: { color } },
      axisLine:   { lineStyle: { width: 14, color: [[1, T.track]] } },
      axisTick:   { show: false },
      splitLine:  { show: false },
      axisLabel:  { show: false },
      pointer:    { show: false },
      detail:     { valueAnimation: true, fontSize: 26, fontWeight: 600, color: T.strong, formatter: `{value}`, offsetCenter: [0, 0] },
      title:      { show: true, offsetCenter: [0, '55%'], color: T.text, fontSize: 11 },
      data:       [{ value: score, name: `/ ${max}` }],
    }],
  }
  return <ReactECharts option={option} style={{ height: 180 }} notMerge />
}

// ── Alert severity donut ───────────────────────────────────────────────────────

export function AlertDonut({ counts }: { counts?: { critical: number; high: number; medium: number; low: number } }) {
  const T = useChartColors()
  const c = counts ?? { critical: 2, high: 3, medium: 4, low: 1 }
  const total = c.critical + c.high + c.medium + c.low

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'item', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 }, formatter: '{b}: {c} ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center', textStyle: { color: T.text, fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: ['50%', '78%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: T.sliceBorder, borderWidth: 2 },
      label: { show: true, position: 'center', formatter: () => `${total}\nalerts`, color: T.strong, fontSize: 13, fontWeight: 600, lineHeight: 20 },
      emphasis: { label: { show: true } },
      data: [
        { value: c.critical, name: 'Critical', itemStyle: { color: C.red } },
        { value: c.high,     name: 'High',     itemStyle: { color: '#f97316' } },
        { value: c.medium,   name: 'Medium',   itemStyle: { color: C.amber } },
        { value: c.low,      name: 'Low',      itemStyle: { color: C.green } },
      ],
    }],
  }
  return <ReactECharts option={option} style={{ height: 180 }} notMerge />
}

// ── Risk trend area chart ──────────────────────────────────────────────────────

export function RiskTrendChart({ values }: { values?: number[] }) {
  const T = useChartColors()
  const v    = values ?? [12,15,11,18,14,13,16,20,14,12,11,15,18,22,19,16,14,12,11,14,16,18,15,12,14,18,16,22,48,24]
  const days = Array.from({ length: v.length }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (v.length - 1 - i))
    return `${d.getMonth()+1}/${d.getDate()}`
  })

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    grid: { top: 8, right: 8, bottom: 24, left: 36 },
    xAxis: { type: 'category', data: days, axisLabel: { color: T.text, fontSize: 10, interval: 4 }, axisLine: { lineStyle: { color: T.grid } }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: T.text, fontSize: 10 }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
    series: [{
      type: 'line', data: v, smooth: true, symbol: 'none',
      lineStyle: { color: C.purple, width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(139,92,246,0.3)' }, { offset: 1, color: 'rgba(139,92,246,0)' }] } },
      markPoint: { data: [{ type: 'max', name: 'Peak', itemStyle: { color: C.red }, symbolSize: 28, label: { fontSize: 10, color: '#fff' } }] },
    }],
  }
  return <ReactECharts option={option} style={{ height: 150 }} notMerge />
}

// ── Agent CPU heatmap grid ─────────────────────────────────────────────────────

export function AgentCpuBars({ agents }: { agents?: { hostname: string; cpu: number; mem: number }[] }) {
  const T = useChartColors()
  const items = agents ?? [
    { hostname: 'SRV-DC01',   cpu: 12, mem: 42 },
    { hostname: 'APP-SRV-02', cpu: 44, mem: 68 },
    { hostname: 'web-prod-01',cpu: 28, mem: 51 },
    { hostname: 'db-primary', cpu: 61, mem: 78 },
    { hostname: 'mail-01',    cpu: 8,  mem: 35 },
  ]

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 }, axisPointer: { type: 'shadow' } },
    legend: { data: ['CPU %', 'Memory %'], textStyle: { color: T.text, fontSize: 11 }, bottom: 0 },
    grid: { top: 8, right: 8, bottom: 44, left: 100 },
    xAxis: { type: 'value', max: 100, axisLabel: { color: T.text, fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: items.map(a => a.hostname), axisLabel: { color: T.text, fontSize: 11 }, axisLine: { lineStyle: { color: T.grid } }, splitLine: { show: false } },
    series: [
      { name: 'CPU %',    type: 'bar', data: items.map(a => a.cpu), itemStyle: { color: (p: any) => p.data > 80 ? C.red : p.data > 60 ? C.amber : C.blue, borderRadius: [0,3,3,0] }, barMaxWidth: 16 },
      { name: 'Memory %', type: 'bar', data: items.map(a => a.mem), itemStyle: { color: (p: any) => p.data > 85 ? C.red : p.data > 70 ? C.amber : C.purple, borderRadius: [0,3,3,0] }, barMaxWidth: 16 },
    ],
  }
  return <ReactECharts option={option} style={{ height: 200 }} notMerge />
}

// ── MFA coverage bar chart ─────────────────────────────────────────────────────

export function MfaCoverageChart({ data }: { data?: { dept: string; pct: number }[] }) {
  const T = useChartColors()
  const items = data ?? [
    { dept: 'Engineering', pct: 98 },
    { dept: 'Finance',     pct: 91 },
    { dept: 'HR',          pct: 88 },
    { dept: 'Sales',       pct: 86 },
    { dept: 'Operations',  pct: 79 },
    { dept: 'Legal',       pct: 73 },
  ]

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 }, formatter: (p: any) => `${p[0].name}: ${p[0].value}%` },
    grid: { top: 8, right: 40, bottom: 24, left: 90 },
    xAxis: { type: 'value', max: 100, axisLabel: { color: T.text, fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
    yAxis: { type: 'category', data: items.map(d => d.dept), axisLabel: { color: T.text, fontSize: 11 }, axisLine: { lineStyle: { color: T.grid } }, splitLine: { show: false } },
    series: [{
      type: 'bar',
      data: items.map(d => ({ value: d.pct, itemStyle: { color: d.pct >= 95 ? C.green : d.pct >= 85 ? C.blue : C.amber, borderRadius: [0,3,3,0] } })),
      barMaxWidth: 16,
      label: { show: true, position: 'right', color: T.text, fontSize: 11, formatter: '{c}%' },
    }],
  }
  return <ReactECharts option={option} style={{ height: 200 }} notMerge />
}

// ── Posture trend (risky users + secure score over time) ───────────────────────

export function PostureTrendChart({ data }: {
  data?: { capturedAt: string; riskyHigh: number; riskyMedium: number; secureScore: number | null }[]
}) {
  const T = useChartColors()
  const points = data ?? []
  const labels = points.map(d => new Date(d.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  const high   = points.map(d => d.riskyHigh)
  const medium = points.map(d => d.riskyMedium)
  const score  = points.map(d => d.secureScore ?? null)

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    legend: { data: ['High risk users', 'Medium risk users', 'Secure Score %'], textStyle: { color: T.text, fontSize: 11 }, bottom: 0 },
    grid: { top: 10, right: 44, bottom: 44, left: 40, containLabel: false },
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: T.grid } }, axisLabel: { color: T.text, fontSize: 10 }, splitLine: { show: false } },
    yAxis: [
      { type: 'value', name: 'Users', nameTextStyle: { color: T.text, fontSize: 10 }, axisLabel: { color: T.text, fontSize: 10 }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
      { type: 'value', name: 'Score', min: 0, max: 100, position: 'right', nameTextStyle: { color: T.text, fontSize: 10 }, axisLabel: { color: T.text, fontSize: 10 }, splitLine: { show: false }, axisLine: { show: false } },
    ],
    series: [
      { name: 'High risk users',   type: 'line', data: high,   smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: C.red, width: 2 },   itemStyle: { color: C.red } },
      { name: 'Medium risk users', type: 'line', data: medium, smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: C.amber, width: 2 }, itemStyle: { color: C.amber } },
      { name: 'Secure Score %',    type: 'line', yAxisIndex: 1, data: score, smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: C.green, width: 2, type: 'dashed' }, itemStyle: { color: C.green }, connectNulls: true },
    ],
  }
  return <ReactECharts option={option} style={{ height: 200 }} notMerge />
}

// ── Compliance score trend (one line per framework) ────────────────────────────

export function ComplianceTrendChart({ data }: {
  data?: { frameworkId: string; score: number; capturedAt: string }[]
}) {
  const T = useChartColors()
  const points = data ?? []
  // group by framework
  const byFw = new Map<string, { x: string[]; y: number[] }>()
  const labelSet = new Set<string>()
  for (const p of points) {
    const label = new Date(p.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    labelSet.add(label)
    if (!byFw.has(p.frameworkId)) byFw.set(p.frameworkId, { x: [], y: [] })
    byFw.get(p.frameworkId)!.x.push(label)
    byFw.get(p.frameworkId)!.y.push(p.score)
  }
  const labels = Array.from(labelSet)
  const names: Record<string, string> = { iso27001: 'ISO 27001', nist_csf: 'NIST CSF', soc2: 'SOC 2' }
  const colors: Record<string, string> = { iso27001: C.blue, nist_csf: C.purple, soc2: C.green }

  const series = Array.from(byFw.entries()).map(([fw, d]) => ({
    name: names[fw] ?? fw, type: 'line' as const, data: d.y, smooth: true,
    symbol: 'circle', symbolSize: 4, lineStyle: { color: colors[fw] ?? C.gray, width: 2 }, itemStyle: { color: colors[fw] ?? C.gray },
  }))

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    legend: { data: series.map(s => s.name), textStyle: { color: T.text, fontSize: 11 }, bottom: 0 },
    grid: { top: 10, right: 12, bottom: 44, left: 36, containLabel: false },
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: T.grid } }, axisLabel: { color: T.text, fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: T.text, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } }, axisLine: { show: false } },
    series,
  }
  return <ReactECharts option={option} style={{ height: 200 }} notMerge />
}

// ── Device compliance donut ─────────────────────────────────────────────────────

export function DeviceComplianceDonut({ compliant, nonCompliant }: { compliant: number; nonCompliant: number }) {
  const T = useChartColors()
  const total = compliant + nonCompliant
  const pctCompliant = total ? Math.round((compliant / total) * 100) : 0
  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'item', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['62%', '85%'], avoidLabelOverlap: false,
      label: { show: false },
      data: [
        { value: compliant,    name: 'Compliant',     itemStyle: { color: C.green } },
        { value: nonCompliant, name: 'Non-compliant', itemStyle: { color: C.red } },
      ],
    }],
  }
  return (
    <div className="relative">
      <ReactECharts option={option} style={{ height: 180 }} notMerge />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{pctCompliant}%</span>
        <span className="text-[11px] text-gray-500">compliant</span>
      </div>
    </div>
  )
}

// ── Device OS breakdown — horizontal bars ───────────────────────────────────────

export function DeviceOsBarChart({ data }: { data?: { os: string; count: number }[] }) {
  const T = useChartColors()
  const rows = (data ?? []).slice().sort((a, b) => b.count - a.count)
  const colors: Record<string, string> = {
    Windows: C.blue, macOS: C.gray, iOS: '#0ea5e9', Android: C.green, Linux: C.amber,
  }
  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    grid: { top: 8, right: 24, bottom: 8, left: 70, containLabel: false },
    xAxis: { type: 'value', axisLabel: { color: T.text, fontSize: 10 }, splitLine: { lineStyle: { color: T.grid, type: 'dashed' } } },
    yAxis: { type: 'category', data: rows.map(r => r.os), axisLabel: { color: T.text, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: 14, data: rows.map(r => ({ value: r.count, itemStyle: { color: colors[r.os] ?? C.purple, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: T.text, fontSize: 11 },
    }],
  }
  return <ReactECharts option={option} style={{ height: Math.max(120, rows.length * 34) }} notMerge />
}

// ── Auth methods Sankey (matches Microsoft Zero Trust Assessment layout) ────────

const METHOD_LABEL: Record<string, string> = {
  passKeyDeviceBound: 'Passkey', passKeyDeviceBoundAuthenticator: 'Passkey',
  windowsHelloForBusiness: 'WHfB', fido2: 'FIDO2',
  microsoftAuthenticatorPush: 'Authenticator', softwareOneTimePasscode: 'Software OTP',
  hardwareOneTimePasscode: 'Hardware OTP', mobilePhone: 'Phone',
  alternateMobilePhone: 'Alt. phone', email: 'Email', none: 'None registered',
}
const CATEGORY_LABEL: Record<string, string> = {
  phish_resistant: 'Phish resistant', phishable: 'Phishable', single_factor: 'Single factor',
}
const CATEGORY_COLOR: Record<string, string> = {
  phish_resistant: C.green, phishable: C.amber, single_factor: C.red,
}

export function AuthMethodsSankey({ data }: { data?: { method: string; category: string; userCount: number }[] }) {
  const T = useChartColors()
  const rows = data ?? []
  if (rows.length === 0) {
    return <div className="h-48 flex items-center justify-center text-xs text-gray-500">No auth method data collected yet</div>
  }

  const categories = Array.from(new Set(rows.map(r => r.category)))
  const nodes = [
    { name: 'Users' },
    ...categories.map(cat => ({ name: CATEGORY_LABEL[cat] ?? cat, itemStyle: { color: CATEGORY_COLOR[cat] } })),
    ...rows.map(r => ({ name: METHOD_LABEL[r.method] ?? r.method })),
  ]
  // dedupe node names (Sankey needs unique node identities)
  const seen = new Set<string>()
  const uniqueNodes = nodes.filter(n => (seen.has(n.name) ? false : (seen.add(n.name), true)))

  const links = [
    ...categories.map(cat => ({
      source: 'Users', target: CATEGORY_LABEL[cat] ?? cat,
      value: rows.filter(r => r.category === cat).reduce((a, r) => a + r.userCount, 0),
    })),
    ...rows.map(r => ({
      source: CATEGORY_LABEL[r.category] ?? r.category,
      target: METHOD_LABEL[r.method] ?? r.method,
      value: r.userCount,
    })),
  ]

  const option: EChartsOption = {
    backgroundColor: C.bg,
    tooltip: { trigger: 'item', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 } },
    series: [{
      type: 'sankey',
      data: uniqueNodes,
      links,
      emphasis: { focus: 'adjacency' },
      lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
      label: { color: T.text, fontSize: 11 },
      nodeWidth: 12,
      nodeGap: 10,
    }],
  }
  return <ReactECharts option={option} style={{ height: 260 }} notMerge />
}
