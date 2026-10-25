// Query results as a table or a chart (chosen from the column types).
import type { QueryResult } from '@/services/api/hooks'
import { DataTable, EmptyState, type Column } from '@/components/ui'
import { EmptyChart, HBarChart, TimeSeriesChart, type TimeSeries } from '@/components/charts'
import { fmtDateTime } from '@/lib/format'

type Row = Record<string, unknown>

export function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined) return '—'
  if (type === 'time' && typeof value === 'string') return fmtDateTime(value)
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function ResultTable({ result }: { result: QueryResult }) {
  const columns: Column<Row & { __i: number }>[] = result.columns.map((c) => ({
    key: c.name, header: c.name, align: c.type === 'number' ? 'right' : 'left',
    className: c.type === 'json' || c.name === 'message' ? 'max-w-[520px]' : undefined,
    render: (r) => {
      const text = formatCell(r[c.name], c.type)
      return <span className={c.type === 'json' ? 'font-mono text-[11px] break-all' : c.name === 'message' ? 'text-xs break-words' : 'text-xs whitespace-nowrap'}>{text}</span>
    },
  }))
  const rows = result.rows.map((r, i) => ({ ...r, __i: i }))
  return <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.__i)} empty={<EmptyState title="No rows" body="Nothing matched in this time range." />} />
}

/** Time column + numbers → lines (one per group); text group + number → bars. */
export function chartable(result: QueryResult): 'time' | 'bar' | null {
  const time = result.columns.find((c) => c.type === 'time')
  const nums = result.columns.filter((c) => c.type === 'number')
  if (time && nums.length) return 'time'
  if (result.summarized && result.groupBy.length && nums.length) return 'bar'
  return null
}

export function ResultChart({ result, empty }: { result: QueryResult; empty?: string }) {
  const kind = chartable(result)
  if (result.rows.length === 0) return <EmptyChart message={empty ?? 'No rows in this time range'} />
  if (!kind) return <EmptyChart message="Summarize by a time bin or a column to get a chart, e.g. | summarize count() by bin(occurred_at, 1h)" />
  const nums = result.columns.filter((c) => c.type === 'number')

  if (kind === 'time') {
    const time = result.columns.find((c) => c.type === 'time')!.name
    const groups = result.columns.filter((c) => c.type === 'text' && result.groupBy.includes(c.name)).map((c) => c.name)
    const num = nums[0].name
    let series: TimeSeries[]
    if (groups.length) {
      // One line per group value of the first number column
      const byGroup = new Map<string, [string, number | null][]>()
      for (const r of result.rows) {
        const key = groups.map((g) => String(r[g] ?? '—')).join(' / ')
        if (!byGroup.has(key)) byGroup.set(key, [])
        byGroup.get(key)!.push([String(r[time]), r[num] as number])
      }
      series = [...byGroup.entries()].slice(0, 12).map(([name, points]) => ({ name, points: points.sort((a, b) => a[0].localeCompare(b[0])) }))
    } else {
      series = nums.slice(0, 6).map((c) => ({
        name: c.name, area: nums.length === 1,
        points: result.rows.map((r) => [String(r[time]), r[c.name] as number] as [string, number | null]).sort((a, b) => a[0].localeCompare(b[0])),
      }))
    }
    return <TimeSeriesChart series={series} height={320} />
  }

  const num = nums[0].name
  const data = result.rows.slice(0, 25).map((r) => ({ label: result.groupBy.map((g) => String(r[g] ?? '—')).join(' / '), value: Number(r[num] ?? 0) }))
  return <HBarChart data={data} name={num} />
}
