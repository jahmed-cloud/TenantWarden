// Formatting and export helpers shared by every page.

export function timeAgo(value?: string | null): string {
  if (!value) return 'never'
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 30 * 86_400) return `${Math.round(seconds / 86_400)} d ago`
  return fmtDate(value)
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "25 Oct" for chart axes. */
export function fmtDay(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function fmtNumber(value?: number | null): string {
  return value === null || value === undefined ? '—' : value.toLocaleString()
}

export function fmtPct(value?: number | null, digits = 0): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}%`
}

export function fmtDuration(seconds?: number | null): string {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function fmtHours(hours?: number | null): string {
  if (hours === null || hours === undefined) return '—'
  return hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`
}

export function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null
}

/** Change against a previous period, e.g. "+12% vs previous 30 days". */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0
  return Math.round(((current - previous) / previous) * 100)
}

function save(blob: Blob, filename: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n')
  save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

export function downloadJson(data: unknown, filename: string) {
  save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}
