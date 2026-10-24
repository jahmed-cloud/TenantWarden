// ─── Overview ─────────────────────────────────────────────────────────────────
import { useNavigate } from 'react-router-dom'
import { useOverviewSummary, useAlerts } from '@/services/api/hooks'
import { MetricCard, Panel, SeverityBadge, Button, PageHeader } from '@/components/shared/ui'
import { AlertTriangle, Shield, Cpu, Laptop2 } from 'lucide-react'

export function OverviewPage() {
  const nav           = useNavigate()
  const { data: sum } = useOverviewSummary()
  const { data: alts } = useAlerts({ status: 'active', pageSize: '5' })

  return (
    <div>
      <PageHeader title="Overview" subtitle="Security posture across all connected tenants" />

      {/* AI Insight banner */}
      {sum && sum.identity.riskyUsers > 5 && (
        <div className="mb-5 p-4 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl">
          <div className="flex items-start gap-3">
            <span className="text-purple-600 dark:text-purple-400 text-lg leading-none mt-0.5">✦</span>
            <div>
              <div className="text-sm font-medium text-purple-900 dark:text-purple-200 mb-1">AI Security Insight</div>
              <div className="text-xs text-purple-700 dark:text-purple-300 leading-relaxed">
                {sum.identity.riskyUsers} risky users detected — possible credential stuffing. Recommend enabling Conditional Access for high-risk countries and triggering MFA re-registration for affected accounts.
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="secondary" size="sm" onClick={() => nav('/identity')} className="text-[11px]">View risky users</Button>
                <Button variant="secondary" size="sm" className="text-[11px]">Enable CA policy</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard label="Risky users"           value={sum?.identity.riskyUsers ?? '—'} color="red"    trend="up"   delta="↑ spike detected"  onClick={() => nav('/identity')} />
        <MetricCard label="Active alerts"          value={(sum?.alerts.critical ?? 0) + (sum?.alerts.high ?? 0)} color="red" trend="up" delta={`${sum?.alerts.critical ?? 0} critical`} onClick={() => nav('/alerts')} />
        <MetricCard label="Non-compliant devices"  value={sum?.devices.nonCompliant ?? '—'} color="yellow" trend="up" delta="Needs remediation" onClick={() => nav('/devices')} />
        <MetricCard label="Secure score"           value={`${sum?.identity.secureScore ?? '—'}/100`} color="green" trend="down" delta="↑ improving" onClick={() => nav('/security')} />
      </div>

      {/* Alerts + Service health */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Panel title="Active alerts" action={<Button size="sm" onClick={() => nav('/alerts')}>View all</Button>}>
          <div className="space-y-2">
            {alts?.items.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer" onClick={() => nav('/alerts')}>
                <div className="mt-0.5"><SeverityBadge severity={a.severity} /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{a.title}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{a.source} · {new Date(a.createdAt).toLocaleTimeString()}</div>
                </div>
              </div>
            )) ?? <div className="text-xs text-gray-400 py-4 text-center">No active alerts</div>}
          </div>
        </Panel>

        <Panel title="Agent fleet">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{sum?.agents.online ?? '—'}</div>
              <div className="text-[11px] text-green-600 dark:text-green-400">Online</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{sum?.agents.total ?? '—'}</div>
              <div className="text-[11px] text-gray-400">Total agents</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{sum?.agents.windows ?? '—'}</div>
              <div className="text-[11px] text-gray-400">Windows</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{sum?.agents.linux ?? '—'}</div>
              <div className="text-[11px] text-gray-400">Linux</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
