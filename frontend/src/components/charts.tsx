// Charts. Every chart takes real API data and shows an empty state when there is none:
// no placeholder numbers. Tooltips list every series with its value (and a total for stacks).
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as echarts from 'echarts/core'
import { BarChart as EBar, GaugeChart as EGauge, LineChart as ELine, PieChart as EPie } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import { BarChart3 } from 'lucide-react'
import { useIsDark } from '@/store/tenantWardenStore'
import { fmtDateTime, fmtDay } from '@/lib/format'
import { SEVERITY_COLOR } from '@/components/ui'

// Register only what these charts use — the full echarts bundle is ~1 MB
echarts.use([EBar, EGauge, ELine, EPie, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

function useChartTheme() {
  const dark = useIsDark()
  return useMemo(() => dark
    ? { text: '#c4c6d0', subtle: '#8e9099', grid: '#2e3137', tipBg: '#282a2f', tipBorder: '#44474f', tipText: '#e2e2e9', track: '#32353a',
        series: ['#8fb0ff', '#4db6ac', '#b39ddb', '#ffcc80', '#ef9a9a', '#90a4ae'] }
    : { text: '#454851', subtle: '#757882', grid: '#e6e8ee', tipBg: '#ffffff', tipBorder: '#d5d8e0', tipText: '#1a1c22', track: '#e7e9f0',
        series: ['#1f5bd8', '#00897b', '#7e57c2', '#f9a825', '#c62828', '#78909c'] },
  [dark])
}
type ChartTheme = ReturnType<typeof useChartTheme>

export function EChart({ option, height = 260 }: { option: EChartsCoreOption; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    const c = echarts.init(el.current!)
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [])
  useEffect(() => { chart.current?.setOption(option, true) }, [option])
  return <div ref={el} style={{ height }} className="w-full" />
}

export function EmptyChart({ height = 260, message = 'No data collected yet' }: { height?: number; message?: ReactNode }) {
  return (
    <div style={{ height }} className="flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-container-low text-on-surface-variant text-xs text-center px-6">
      <BarChart3 size={22} className="opacity-60" />
      {message}
    </div>
  )
}

// ── Shared option pieces ─────────────────────────────────────────────────────

interface TipParam { marker: string; seriesName: string; value: unknown; axisValue: string | number; axisValueLabel: string; seriesType: string }

function tooltip(T: ChartTheme, opts: { unit?: string; total?: string; title?: (axisValue: string | number) => string } = {}) {
  const unit = opts.unit ?? ''
  const val = (v: unknown) => (Array.isArray(v) ? v[1] : v) as number | null
  return {
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(127,127,127,0.08)' } },
    backgroundColor: T.tipBg, borderColor: T.tipBorder, borderWidth: 1, padding: [8, 12],
    textStyle: { color: T.tipText, fontSize: 12 },
    extraCssText: 'border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
    formatter: (raw: unknown) => {
      const params = raw as TipParam[]
      if (!params.length) return ''
      const head = opts.title ? opts.title(params[0].axisValue) : params[0].axisValueLabel
      const rows = params.map((p) => {
        const v = val(p.value)
        return `<div style="display:flex;justify-content:space-between;gap:16px;line-height:20px"><span>${p.marker}${p.seriesName}</span><b>${v === null || v === undefined ? '—' : `${Number(v).toLocaleString()}${unit}`}</b></div>`
      })
      if (opts.total) {
        const sum = params.filter((p) => p.seriesType === 'bar').reduce((a, p) => a + (val(p.value) ?? 0), 0)
        rows.push(`<div style="display:flex;justify-content:space-between;gap:16px;line-height:20px;margin-top:4px;border-top:1px solid ${T.tipBorder};padding-top:4px"><span>${opts.total}</span><b>${sum.toLocaleString()}</b></div>`)
      }
      return `<div style="font-weight:500;margin-bottom:4px">${head}</div>${rows.join('')}`
    },
  }
}

const legend = (T: ChartTheme) => ({
  bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16,
  textStyle: { color: T.text, fontSize: 11 },
})

const valueAxis = (T: ChartTheme, extra: Record<string, unknown> = {}) => ({
  type: 'value' as const, minInterval: 1,
  axisLabel: { color: T.subtle, fontSize: 11 },
  splitLine: { lineStyle: { color: T.grid } },
  ...extra,
})

const categoryAxis = (T: ChartTheme, data: string[]) => ({
  type: 'category' as const, data,
  axisLine: { lineStyle: { color: T.grid } }, axisTick: { show: false },
  axisLabel: { color: T.subtle, fontSize: 11, hideOverlap: true },
})

const timeAxis = (T: ChartTheme) => ({
  type: 'time' as const,
  axisLine: { lineStyle: { color: T.grid } }, axisTick: { show: false },
  axisLabel: { color: T.subtle, fontSize: 11, hideOverlap: true },
  splitLine: { show: false },
})

const GRID = { top: 16, right: 16, bottom: 44, left: 8, containLabel: true }

// ── Alerts per day, stacked by severity, with resolved alerts as a line ──────

export function AlertTrendChart({ data, height = 280 }: { data?: { date: string; critical: number; high: number; medium: number; low: number; resolved: number }[]; height?: number }) {
  const T = useChartTheme()
  const option = useMemo(() => data && {
    tooltip: tooltip(T, { total: 'New alerts' }),
    legend: legend(T), grid: GRID,
    xAxis: categoryAxis(T, data.map((d) => fmtDay(d.date))),
    yAxis: valueAxis(T),
    series: [
      ...(['critical', 'high', 'medium', 'low'] as const).map((sev, i) => ({
        name: sev[0].toUpperCase() + sev.slice(1), type: 'bar', stack: 'new', barMaxWidth: 22,
        data: data.map((d) => d[sev]), itemStyle: { color: SEVERITY_COLOR[sev], borderRadius: i === 3 ? [4, 4, 0, 0] : 0 },
        emphasis: { focus: 'series' },
      })),
      { name: 'Resolved', type: 'line', smooth: true, symbolSize: 6, data: data.map((d) => d.resolved),
        lineStyle: { width: 2, color: T.series[1] }, itemStyle: { color: T.series[1] } },
    ],
  }, [data, T])
  if (!data || data.every((d) => d.critical + d.high + d.medium + d.low + d.resolved === 0))
    return <EmptyChart height={height} message="No alerts in this period" />
  return <EChart option={option!} height={height} />
}

// ── Risky sign-ins per day by risk level ─────────────────────────────────────

export function SignInTrendChart({ data, height = 260 }: { data?: { date: string; high: number; medium: number; low: number }[]; height?: number }) {
  const T = useChartTheme()
  const option = useMemo(() => data && {
    tooltip: tooltip(T, { total: 'Risky sign-ins' }), legend: legend(T), grid: GRID,
    xAxis: categoryAxis(T, data.map((d) => fmtDay(d.date))), yAxis: valueAxis(T),
    series: (['high', 'medium', 'low'] as const).map((lvl, i) => ({
      name: `${lvl[0].toUpperCase()}${lvl.slice(1)} risk`, type: 'bar', stack: 'risk', barMaxWidth: 22,
      data: data.map((d) => d[lvl]), itemStyle: { color: SEVERITY_COLOR[lvl], borderRadius: i === 2 ? [4, 4, 0, 0] : 0 },
    })),
  }, [data, T])
  if (!data || data.every((d) => d.high + d.medium + d.low === 0))
    return <EmptyChart height={height} message="No risky sign-ins recorded in this period" />
  return <EChart option={option!} height={height} />
}

// ── Lines over time (posture history, secure score, compliance, agent metrics) ─

export interface TimeSeries { name: string; points: [string, number | null][]; color?: string; area?: boolean; dashed?: boolean; yAxis?: 0 | 1 }

export function TimeSeriesChart({ series, height = 260, unit = '', rightUnit = '', percent, empty }: {
  series: TimeSeries[]; height?: number; unit?: string; rightUnit?: string; percent?: boolean; empty?: ReactNode
}) {
  const T = useChartTheme()
  const hasRight = series.some((s) => s.yAxis === 1)
  const option = useMemo(() => ({
    tooltip: tooltip(T, { unit, title: (t) => fmtDateTime(new Date(Number(t)).toISOString()) }),
    legend: legend(T), grid: { ...GRID, right: hasRight ? 8 : 16 },
    xAxis: timeAxis(T),
    yAxis: [
      valueAxis(T, percent ? { max: 100, minInterval: 10, axisLabel: { color: T.subtle, fontSize: 11, formatter: '{value}%' } } : { axisLabel: { color: T.subtle, fontSize: 11, formatter: `{value}${unit}` } }),
      ...(hasRight ? [valueAxis(T, { max: 100, splitLine: { show: false }, axisLabel: { color: T.subtle, fontSize: 11, formatter: `{value}${rightUnit}` } })] : []),
    ],
    series: series.map((s, i) => {
      const color = s.color ?? T.series[i % T.series.length]
      return {
        name: s.name, type: 'line', showSymbol: s.points.length < 40, symbolSize: 5, sampling: 'lttb', connectNulls: true,
        yAxisIndex: s.yAxis ?? 0, data: s.points.map(([t, v]) => [t, v]),
        lineStyle: { width: s.dashed ? 1.5 : 2, color, type: s.dashed ? 'dashed' : 'solid' }, itemStyle: { color },
        areaStyle: s.area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}40` }, { offset: 1, color: `${color}00` }] } } : undefined,
      }
    }),
  }), [series, T, unit, rightUnit, percent, hasRight])
  if (series.every((s) => s.points.length === 0)) return <EmptyChart height={height} message={empty ?? 'No history yet — points appear after each collection'} />
  return <EChart option={option} height={height} />
}

// ── Donut with a centre figure and a value legend ────────────────────────────

export interface Slice { name: string; value: number; color?: string }

export function DonutChart({ data, height = 220, centerValue, centerLabel, empty }: {
  data: Slice[]; height?: number; centerValue?: ReactNode; centerLabel?: string; empty?: ReactNode
}) {
  const T = useChartTheme()
  const total = data.reduce((a, d) => a + d.value, 0)
  const option = useMemo(() => ({
    tooltip: {
      trigger: 'item', backgroundColor: T.tipBg, borderColor: T.tipBorder, textStyle: { color: T.tipText, fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
      formatter: (p: { marker: string; name: string; value: number; percent: number }) => `${p.marker}${p.name}<br/><b>${p.value.toLocaleString()}</b> · ${p.percent}%`,
    },
    legend: {
      orient: 'vertical', right: 0, top: 'middle', icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 10,
      textStyle: { color: T.text, fontSize: 12 },
      formatter: (name: string) => {
        const v = data.find((d) => d.name === name)?.value ?? 0
        return `${name}  ${v.toLocaleString()} (${total ? Math.round((v / total) * 100) : 0}%)`
      },
    },
    series: [{
      type: 'pie', radius: ['62%', '86%'], center: ['28%', '50%'], avoidLabelOverlap: true, padAngle: 2,
      itemStyle: { borderRadius: 6 }, label: { show: false }, labelLine: { show: false },
      data: data.map((d, i) => ({ ...d, itemStyle: { color: d.color ?? T.series[i % T.series.length] } })),
    }],
  }), [data, T, total])
  if (total === 0) return <EmptyChart height={height} message={empty} />
  return (
    <div className="relative">
      <EChart option={option} height={height} />
      {centerValue !== undefined && (
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none" style={{ left: '28%' }}>
          <div className="text-2xl text-on-surface leading-7">{centerValue}</div>
          {centerLabel && <div className="text-[11px] text-on-surface-variant">{centerLabel}</div>}
        </div>
      )}
    </div>
  )
}

// ── Horizontal bars (countries, OS, sources, methods) ────────────────────────

export interface BarDatum { label: string; value: number; secondary?: number; color?: string }

export function HBarChart({ data, height, name = 'Count', secondaryName, empty }: {
  data: BarDatum[]; height?: number; name?: string; secondaryName?: string; empty?: ReactNode
}) {
  const T = useChartTheme()
  const rows = [...data].sort((a, b) => a.value - b.value)
  const h = height ?? Math.max(140, rows.length * 30 + 40)
  const option = useMemo(() => ({
    tooltip: tooltip(T), grid: { top: 4, right: 40, bottom: secondaryName ? 36 : 4, left: 8, containLabel: true },
    legend: secondaryName ? legend(T) : undefined,
    xAxis: valueAxis(T, { splitLine: { lineStyle: { color: T.grid } } }),
    yAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: T.text, fontSize: 12 } },
    series: [
      { name, type: 'bar', barMaxWidth: 16, data: rows.map((r, i) => ({ value: r.value, itemStyle: { color: r.color ?? T.series[0], borderRadius: [0, 4, 4, 0] }, id: i })),
        label: { show: !secondaryName, position: 'right', color: T.subtle, fontSize: 11 } },
      ...(secondaryName ? [{ name: secondaryName, type: 'bar', barMaxWidth: 16, data: rows.map((r) => r.secondary ?? 0), itemStyle: { color: SEVERITY_COLOR.high, borderRadius: [0, 4, 4, 0] } }] : []),
    ],
  }), [rows, T, name, secondaryName])
  if (rows.length === 0) return <EmptyChart height={height ?? 180} message={empty} />
  return <EChart option={option} height={h} />
}

// ── Gauge (Secure Score) ─────────────────────────────────────────────────────

export function GaugeChart({ value, height = 200, suffix = '%' }: { value: number; height?: number; suffix?: string }) {
  const T = useChartTheme()
  const color = value >= 80 ? '#2e7d32' : value >= 60 ? '#f9a825' : '#c62828'
  const option = useMemo(() => ({
    series: [{
      type: 'gauge', startAngle: 205, endAngle: -25, min: 0, max: 100, radius: '95%', center: ['50%', '58%'],
      progress: { show: true, width: 16, roundCap: true, itemStyle: { color } },
      axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, T.track]] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
      detail: { valueAnimation: true, offsetCenter: [0, '0%'], fontSize: 34, fontWeight: 400, color: T.tipText, formatter: `{value}${suffix}` },
      data: [{ value }],
    }],
  }), [value, T, color, suffix])
  return <EChart option={option} height={height} />
}
