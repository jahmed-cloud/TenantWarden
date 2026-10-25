// Material 3-style building blocks. Colours come from the theme roles in index.css, so
// nothing here needs separate dark-mode classes.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { clsx as cx } from 'clsx'
import { Check, ChevronLeft, ChevronRight, Copy, Inbox, Loader2, X, type LucideIcon } from 'lucide-react'
import toast from 'react-hot-toast'

export { cx }

// ── Layout ───────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-normal text-on-surface">{title}</h1>
        {subtitle && <p className="text-sm text-on-surface-variant mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

interface CardProps {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Drop the body padding (tables that run edge to edge) */
  flush?: boolean
}

export function Card({ title, subtitle, action, children, className, flush }: CardProps) {
  return (
    <section className={cx('bg-surface-container-lowest rounded-2xl shadow-e1 min-w-0', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-medium text-on-surface">{title}</h2>}
            {subtitle && <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center gap-1 shrink-0">{action}</div>}
        </header>
      )}
      <div className={cx(!flush && 'px-5 pb-5', !flush && !(title || action) && 'pt-5')}>{children}</div>
    </section>
  )
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'

const TONE_CONTAINER: Record<Tone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  primary: 'bg-primary-container text-on-primary-container',
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error:   'bg-error-container text-on-error-container',
  info:    'bg-info-container text-on-info-container',
}

interface StatCardProps {
  label: string
  value: ReactNode
  icon?: LucideIcon
  tone?: Tone
  /** Secondary line under the value, e.g. a breakdown */
  detail?: ReactNode
  /** Percentage change vs the previous period; `goodWhenUp` decides the colour */
  change?: number | null
  goodWhenUp?: boolean
  onClick?: () => void
  loading?: boolean
}

export function StatCard({ label, value, icon: Icon, tone = 'primary', detail, change, goodWhenUp = false, onClick, loading }: StatCardProps) {
  const good = change !== null && change !== undefined && change !== 0 && (change > 0) === goodWhenUp
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cx(
        'state-layer text-left bg-surface-container-lowest rounded-2xl shadow-e1 p-4 flex flex-col gap-3 min-w-0 disabled:cursor-default',
        onClick && 'hover:shadow-e2 transition-shadow',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-on-surface-variant tracking-wide">{label}</span>
        {Icon && (
          <span className={cx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', TONE_CONTAINER[tone])}>
            <Icon size={18} />
          </span>
        )}
      </div>
      {loading ? (
        <span className="h-8 w-20 rounded-lg bg-surface-container-high animate-pulse" />
      ) : (
        <span className="text-[28px] leading-8 font-normal text-on-surface truncate">{value}</span>
      )}
      {(detail || (change !== null && change !== undefined)) && (
        <span className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
          {change !== null && change !== undefined && (
            <span className={cx('px-1.5 py-0.5 rounded-md font-medium',
              change === 0 ? TONE_CONTAINER.neutral : good ? TONE_CONTAINER.success : TONE_CONTAINER.error)}>
              {change > 0 ? '+' : ''}{change}%
            </span>
          )}
          {detail}
        </span>
      )}
    </button>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: LucideIcon
  loading?: boolean
  size?: 'sm' | 'md'
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  filled:   'bg-primary text-on-primary shadow-sm hover:shadow-e1',
  tonal:    'bg-secondary-container text-on-secondary-container',
  outlined: 'border border-outline text-primary',
  text:     'text-primary',
  danger:   'bg-error text-on-error',
}

export function Button({ variant = 'filled', icon: Icon, loading, size = 'md', className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'state-layer inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-wide transition-shadow',
        'disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        size === 'md' ? 'h-10 px-5 text-sm' : 'h-8 px-3.5 text-xs',
        (Icon || loading) && (size === 'md' ? 'pl-4' : 'pl-3'),
        BUTTON_VARIANTS[variant], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'md' ? 18 : 14} className="animate-spin" /> : Icon && <Icon size={size === 'md' ? 18 : 14} />}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, onClick, className, active, size = 20 }: {
  icon: LucideIcon; label: string; onClick?: () => void; className?: string; active?: boolean; size?: number
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx('state-layer w-10 h-10 rounded-full inline-flex items-center justify-center shrink-0',
        active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant', className)}
    >
      <Icon size={size} />
    </button>
  )
}

// ── Chips, badges, tabs ──────────────────────────────────────────────────────

export function Chip({ selected, onClick, children, count }: { selected?: boolean; onClick?: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('state-layer h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border',
        selected ? 'bg-secondary-container text-on-secondary-container border-transparent' : 'border-outline-variant text-on-surface-variant')}
    >
      {selected && <Check size={14} />}
      {children}
      {count !== undefined && <span className="opacity-70">{count}</span>}
    </button>
  )
}

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap', TONE_CONTAINER[tone], className)}>
      {children}
    </span>
  )
}

// Chart and badge colours per severity (charts can't read CSS classes)
export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#c62828', high: '#ef6c00', medium: '#f9a825', low: '#2e7d32', info: '#607d8b',
}
const SEVERITY_TONE: Record<string, Tone> = { critical: 'error', high: 'warning', medium: 'warning', low: 'success', info: 'neutral' }

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Pill tone={SEVERITY_TONE[severity] ?? 'neutral'}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.info }} />
      {severity}
    </Pill>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  active: 'error', acknowledged: 'info', investigating: 'primary', resolved: 'success', suppressed: 'neutral',
  online: 'success', offline: 'neutral', degraded: 'warning', provisioning: 'info',
  compliant: 'success', noncompliant: 'error', ingraceperiod: 'warning', unknown: 'neutral',
  enabled: 'success', disabled: 'neutral', enabledforreportingbutnotenforced: 'info',
  paused: 'warning', error: 'error', inprogress: 'primary', redirected: 'neutral',
  healthy: 'success', serviceoperational: 'success', servicedegradation: 'warning', serviceinterruption: 'error',
  pass: 'success', partial: 'warning', fail: 'error', at_risk: 'error', not_assessed: 'neutral', not_applicable: 'neutral',
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const key = status?.toLowerCase().replace(/[\s-]/g, '')
  return <Pill tone={STATUS_TONE[key] ?? STATUS_TONE[status] ?? 'neutral'}>{label ?? status}</Pill>
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-1 border-b border-outline-variant mb-5 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx('state-layer relative h-12 px-4 text-sm font-medium whitespace-nowrap',
            value === t.id ? 'text-primary' : 'text-on-surface-variant')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs opacity-70">{t.count}</span>}
          {value === t.id && <span className="absolute left-3 right-3 bottom-0 h-[3px] rounded-t-full bg-primary" />}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex h-8 rounded-full border border-outline overflow-hidden">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('state-layer px-3 text-xs font-medium inline-flex items-center gap-1',
            i > 0 && 'border-l border-outline',
            value === o.value ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface')}
        >
          {value === o.value && <Check size={12} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Overlays ─────────────────────────────────────────────────────────────────

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

export function Dialog({ open, onClose, title, children, actions, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode; wide?: boolean
}) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('bg-surface-container-high text-on-surface rounded-3xl shadow-e3 w-full max-h-[90vh] flex flex-col',
          wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <h2 className="text-2xl font-normal px-6 pt-6 pb-4">{title}</h2>
        <div className="px-6 overflow-y-auto flex-1 text-sm text-on-surface-variant">{children}</div>
        {actions && <div className="flex justify-end gap-2 px-6 py-5">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode
  confirmLabel?: string; danger?: boolean; loading?: boolean
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      actions={<>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'filled'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      {body}
    </Dialog>
  )
}

/** Side sheet for record details (alerts, agents). */
export function Sheet({ open, onClose, title, subtitle, children, actions }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode
}) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={onClose}>
      <aside
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-surface-container-low w-full max-w-2xl h-full shadow-e3 flex flex-col rounded-l-3xl"
      >
        <header className="flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-normal text-on-surface break-words">{title}</h2>
            {subtitle && <div className="text-sm text-on-surface-variant mt-1">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">{children}</div>
        {actions && <footer className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-outline-variant">{actions}</footer>}
      </aside>
    </div>
  )
}

/** Small popover menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  useEscape(open, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      {trigger(() => setOpen((v) => !v))}
      {open && (
        <div className={cx('absolute z-50 mt-1 min-w-[220px] py-2 rounded-xl bg-surface-container shadow-e2',
          align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon: Icon, children, onClick, active }: { icon?: LucideIcon; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('state-layer w-full h-11 px-4 flex items-center gap-3 text-sm text-left', active ? 'text-primary font-medium' : 'text-on-surface')}>
      {Icon && <Icon size={18} className="text-on-surface-variant" />}
      <span className="flex-1 truncate">{children}</span>
      {active && <Check size={16} />}
    </button>
  )
}

// ── Form fields ──────────────────────────────────────────────────────────────

const FIELD = 'w-full h-11 rounded-lg border border-outline bg-transparent px-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary'

export function TextField({ label, hint, value, onChange, type = 'text', placeholder, autoFocus, mono, onEnter }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string
  placeholder?: string; autoFocus?: boolean; mono?: boolean; onEnter?: () => void
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        className={cx(FIELD, mono && 'font-mono')}
      />
      {hint && <span className="block text-[11px] text-on-surface-variant mt-1">{hint}</span>}
    </label>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options, hint }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(FIELD.replace('bg-transparent', 'bg-surface-container-high'), 'pr-8')}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="block text-[11px] text-on-surface-variant mt-1">{hint}</span>}
    </label>
  )
}

export function SearchField({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full sm:w-64 rounded-full bg-surface-container-high px-4 text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary"
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative w-[52px] h-8 rounded-full border-2 transition-colors shrink-0',
        checked ? 'bg-primary border-primary' : 'bg-surface-container-highest border-outline')}>
      <span className={cx('absolute top-1/2 -translate-y-1/2 rounded-full transition-all',
        checked ? 'left-[22px] w-6 h-6 bg-on-primary' : 'left-1.5 w-4 h-4 bg-outline')} />
    </button>
  )
}

// ── Data display ─────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (row: T) => string
  onRowClick?: (row: T) => void; loading?: boolean; empty?: ReactNode
}) {
  if (loading && !rows) return <Skeleton rows={5} />
  if (!rows || rows.length === 0) return <>{empty ?? <EmptyState title="Nothing to show yet" />}</>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outline-variant">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-4 py-2.5 text-xs font-medium text-on-surface-variant whitespace-nowrap',
                c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx('border-b border-outline-variant/60 last:border-0', onRowClick && 'cursor-pointer hover:bg-on-surface/[0.04]')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-3 text-on-surface align-middle', c.className,
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 text-xs text-on-surface-variant">
      <span>Page {page} of {totalPages} · {total.toLocaleString()} total</span>
      <IconButton icon={ChevronLeft} label="Previous page" onClick={() => page > 1 && onChange(page - 1)} />
      <IconButton icon={ChevronRight} label="Next page" onClick={() => page < totalPages && onChange(page + 1)} />
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <span className="w-12 h-12 rounded-2xl bg-surface-container-high text-on-surface-variant flex items-center justify-center mb-3">
        <Icon size={22} />
      </span>
      <p className="text-sm font-medium text-on-surface">{title}</p>
      {body && <p className="text-xs text-on-surface-variant mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ rows = 3, height = 'h-10' }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className={cx(height, 'rounded-lg bg-surface-container-high animate-pulse')} />)}
    </div>
  )
}

export function Meter({ value, max = 100, warnAt = 70, badAt = 90 }: { value: number | null | undefined; max?: number; warnAt?: number; badAt?: number }) {
  if (value === null || value === undefined) return <span className="text-on-surface-variant">—</span>
  const pctValue = Math.min(100, (value / max) * 100)
  const color = pctValue >= badAt ? 'bg-error' : pctValue >= warnAt ? 'bg-warning' : 'bg-primary'
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
        <div className={cx('h-full rounded-full', color)} style={{ width: `${pctValue}%` }} />
      </div>
      <span className="text-xs tabular-nums text-on-surface-variant w-9 text-right">{Math.round(value)}%</span>
    </div>
  )
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-on-surface-variant">{k}</dt>
          <dd className="text-on-surface min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="rounded-xl bg-inverse-surface text-inverse-on-surface text-xs">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="opacity-70">{label}</span>
        <button type="button" className="state-layer inline-flex items-center gap-1 px-2 py-1 rounded-md"
          onClick={() => navigator.clipboard.writeText(code).then(() => toast.success('Copied'))}>
          <Copy size={12} /> Copy
        </button>
      </div>
      <pre className="px-3 pb-3 pt-1 overflow-x-auto font-mono whitespace-pre-wrap break-all leading-relaxed">{code}</pre>
    </div>
  )
}

export function Banner({ tone = 'info', icon: Icon, children, action }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-2xl px-4 py-3 text-sm', TONE_CONTAINER[tone])}>
      {Icon && <Icon size={18} className="mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  )
}
