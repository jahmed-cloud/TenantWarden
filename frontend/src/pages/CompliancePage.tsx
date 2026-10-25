import { useMemo, useState } from 'react'
import { ChevronRight, ClipboardCheck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useComplianceHistory, useControls, useFrameworks, type Framework } from '@/services/api/hooks'
import { TimeSeriesChart } from '@/components/charts'
import { Card, EmptyState, PageHeader, Skeleton, StatCard, StatusPill, cx } from '@/components/ui'

export function CompliancePage() {
  const { data: frameworks, isLoading } = useFrameworks()
  const { data: history } = useComplianceHistory(90)
  const [open, setOpen] = useState<string | null>(null)

  const overall = frameworks?.length ? Math.round(frameworks.reduce((a, f) => a + f.score, 0) / frameworks.length) : null
  const series = useMemo(() => (frameworks ?? []).map((f) => ({
    name: f.name, points: (history ?? []).filter((h) => h.frameworkId === f.id).map((h) => [h.capturedAt, h.score] as [string, number]),
  })), [frameworks, history])

  return (
    <div>
      <PageHeader title="Compliance" subtitle="Framework scores computed from live signals: Conditional Access, MFA, device compliance and encryption, risky users and Secure Score" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Overall" icon={ClipboardCheck} tone={overall === null ? 'neutral' : overall >= 80 ? 'success' : 'warning'} loading={isLoading} value={overall === null ? '—' : `${overall}%`} detail="average across frameworks" />
        <StatCard label="Frameworks" icon={ClipboardCheck} loading={isLoading} value={frameworks?.length ?? '—'} />
        <StatCard label="Compliant" icon={ShieldCheck} tone="success" loading={isLoading} value={frameworks?.filter((f) => f.status === 'compliant').length ?? '—'} detail="score of 80% or more" />
        <StatCard label="At risk" icon={ShieldAlert} tone="error" loading={isLoading} value={frameworks?.filter((f) => f.status === 'at_risk').length ?? '—'} />
      </div>

      <Card className="mb-4" title="Score history" subtitle="Last 90 days, one point per assessment">
        <TimeSeriesChart percent series={series} empty="Scores are recorded after each analytics cycle" />
      </Card>

      <Card flush title="Frameworks" subtitle="Open a framework to see each control and the evidence behind it. Partial controls count as half.">
        {isLoading ? <div className="p-5"><Skeleton rows={3} /></div> : !frameworks?.length ? (
          <EmptyState icon={ClipboardCheck} title="No assessment yet" body="The analytics engine scores frameworks after the first collection." />
        ) : (
          <ul>
            {frameworks.map((f) => <FrameworkRow key={f.id} f={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}

function FrameworkRow({ f, open, onToggle }: { f: Framework; open: boolean; onToggle: () => void }) {
  const { data: controls, isLoading } = useControls(open ? f.id : null)
  const color = f.score >= 80 ? 'bg-success' : f.score >= 60 ? 'bg-warning' : 'bg-error'
  return (
    <li className="border-t border-outline-variant first:border-0">
      <button type="button" onClick={onToggle} className="state-layer w-full flex items-center gap-4 px-5 py-4 text-left">
        <ChevronRight size={18} className={cx('text-on-surface-variant transition-transform', open && 'rotate-90')} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-on-surface">{f.name}</span>
          <span className="block text-xs text-on-surface-variant">{f.controlsPassing} controls passing</span>
        </span>
        <span className="hidden sm:block w-40 h-2 rounded-full bg-surface-container-highest overflow-hidden">
          <span className={cx('block h-full rounded-full', color)} style={{ width: `${f.score}%` }} />
        </span>
        <span className="w-12 text-right text-base tabular-nums">{f.score}%</span>
        <StatusPill status={f.status} label={f.status.replace('_', ' ')} />
      </button>
      {open && (
        <div className="px-5 pb-4">
          {isLoading ? <Skeleton rows={4} height="h-8" /> : (
            <ul className="rounded-xl bg-surface-container-low divide-y divide-outline-variant/60">
              {controls?.map((c) => (
                <li key={c.ref} className="flex items-start gap-3 px-4 py-2.5">
                  <StatusPill status={c.status} label={c.status.replace('_', ' ')} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-on-surface"><span className="font-mono text-xs text-on-surface-variant mr-2">{c.ref}</span>{c.title}</span>
                    {c.detail && <span className="block text-xs text-on-surface-variant mt-0.5">{c.detail}</span>}
                  </span>
                  {c.category && <span className="text-[11px] text-on-surface-variant">{c.category}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
