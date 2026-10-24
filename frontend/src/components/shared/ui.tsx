import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── MetricCard ────────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:   string
  value:   string | number
  delta?:  string
  trend?:  'up' | 'down' | 'neutral'
  color?:  'default' | 'red' | 'green' | 'yellow' | 'blue'
  onClick?: () => void
}

export function MetricCard({ label, value, delta, trend, color = 'default', onClick }: MetricCardProps) {
  const colorMap = {
    default: 'text-gray-900 dark:text-gray-100',
    red:     'text-red-600 dark:text-red-400',
    green:   'text-green-600 dark:text-green-400',
    yellow:  'text-amber-600 dark:text-amber-400',
    blue:    'text-blue-600 dark:text-blue-400',
  }

  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4',
        onClick && 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-700 transition-colors',
      )}
    >
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{label}</div>
      <div className={clsx('text-2xl font-semibold', colorMap[color])}>{value}</div>
      {delta && (
        <div className={clsx(
          'flex items-center gap-1 mt-1 text-xs',
          trend === 'up'   ? 'text-red-500'   :
          trend === 'down' ? 'text-green-500' : 'text-gray-400',
        )}>
          {trend === 'up'      && <TrendingUp size={11} />}
          {trend === 'down'    && <TrendingDown size={11} />}
          {trend === 'neutral' && <Minus size={11} />}
          {delta}
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface PanelProps {
  title?:    string
  action?:   ReactNode
  children:  ReactNode
  className?: string
}

export function Panel({ title, action, children, className }: PanelProps) {
  return (
    <div className={clsx('bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl', className)}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

// ── SeverityBadge ─────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400',
  high:     'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400',
  medium:   'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
  low:      'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400',
  info:     'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

export function SeverityBadge({ severity }: { severity: string }) {
  const s = severity as Severity
  return (
    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium', SEVERITY_STYLES[s] ?? SEVERITY_STYLES.info)}>
      {severity}
    </span>
  )
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:        'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400',
    acknowledged:  'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400',
    investigating: 'bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400',
    resolved:      'bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400',
    online:        'bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400',
    offline:       'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    compliant:     'bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400',
    noncompliant:  'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400',
  }
  return (
    <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium', styles[status] ?? styles.resolved)}>
      {status}
    </span>
  )
}

// ── DataTable ─────────────────────────────────────────────────────────────────

interface Column<T> {
  key:     string
  header:  string
  render?: (row: T) => ReactNode
  width?:  string
}

interface DataTableProps<T> {
  columns:   Column<T>[]
  data:      T[]
  keyField:  keyof T
  onRowClick?: (row: T) => void
  loading?:  boolean
}

export function DataTable<T extends object>({
  columns, data, keyField, onRowClick, loading,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            {columns.map(col => (
              <th
                key={col.key}
                className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400"
                style={col.width ? { width: col.width } : {}}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr
              key={String(row[keyField])}
              className={clsx(
                'border-b border-gray-50 dark:border-gray-800/50',
                onRowClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50',
              )}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map(col => (
                <td key={col.key} className="py-2.5 px-3 text-gray-700 dark:text-gray-300">
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-400">No records found</div>
      )}
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  'primary' | 'secondary' | 'danger'
  size?:     'sm' | 'md'
  children:  ReactNode
}

export function Button({ variant = 'secondary', size = 'sm', children, className, ...rest }: ButtonProps) {
  const base    = 'inline-flex items-center gap-1.5 font-medium rounded-md transition-colors disabled:opacity-50'
  const sizes   = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2' }
  const variants = {
    primary:   'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600',
    secondary: 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700',
    danger:    'bg-red-600 hover:bg-red-700 text-white border border-red-600',
  }
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  )
}

// ── PageHeader ────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
