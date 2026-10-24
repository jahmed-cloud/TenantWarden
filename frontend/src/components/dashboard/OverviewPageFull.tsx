import { useNavigate } from 'react-router-dom'
import { useOverviewSummary, useAlerts, useAlertCounts } from '@/services/api/hooks'
import { MetricCard, Panel, SeverityBadge, Button, PageHeader } from '@/components/shared/ui'
import { SignInChart, AlertDonut, SecureScoreGauge, PostureTrendChart } from '@/components/dashboard/Charts'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

// Fallback shown only until the collector reports real service health
const SERVICE_HEALTH_FALLBACK = [
  { name: 'Exchange Online',  status: 'ok'   },
  { name: 'Microsoft Teams',  status: 'ok'   },
  { name: 'SharePoint Online',status: 'ok'   },
  { name: 'Entra ID',         status: 'warn' },
  { name: 'Intune',           status: 'ok'   },
  { name: 'Defender XDR',     status: 'ok'   },
  { name: 'Purview',          status: 'ok'   },
  { name: 'Power Platform',   status: 'ok'   },
  { name: 'Azure AD B2B',     status: 'err'  },
]

const STATUS_COLORS = { ok: 'bg-green-500', warn: 'bg-amber-500', err: 'bg-red-500' }
const STATUS_LABELS = { ok: 'Operational', warn: 'Degraded', err: 'Incident' }

export function OverviewPage() {
  const activeTenant = useTenantWardenStore((s) => s.activeTenant)
  const { data: postureHistory = [] } = useQuery({
    queryKey: ['posture-history', activeTenant?.id],
    queryFn: async () => (await apiClient.get(`/v1/history/posture?tenantId=${activeTenant?.id}&days=30`)).data as any[],
    enabled: !!activeTenant?.id,
  })
  const { data: liveHealth = [] } = useQuery({
    queryKey: ['service-health'],
    queryFn: async () => (await apiClient.get('/v1/service-health')).data as any[],
  })
  // Map API rows → UI shape; fall back to placeholders when collector hasn't run yet
  const serviceHealth = (liveHealth as any[]).length
    ? (liveHealth as any[]).map(s => ({
        name: s.service,
        status: s.status === 'serviceOperational' || s.status === 'ok' ? 'ok'
              : s.status === 'serviceDegraded' || s.status === 'warn' ? 'warn' : 'down',
      }))
    : SERVICE_HEALTH_FALLBACK
  const nav               = useNavigate()
  const { data: sum }     = useOverviewSummary()
  const { data: alts }    = useAlerts({ status: 'active', pageSize: '5' })
  const { data: counts }  = useAlertCounts()
  const wsConnected       = useTenantWardenStore(s => s.wsConnected)

  const totalAlerts = (counts?.critical ?? 0) + (counts?.high ?? 0)

  return (
    <div className="space-y-5">

      {/* AI insight */}
      {sum && sum.identity.riskyUsers > 5 && (
        <div className="flex gap-3 p-4 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 rounded-xl">
          <span className="text-purple-600 dark:text-purple-400 text-xl mt-0.5 flex-shrink-0">✦</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">AI Security Insight</span>
              <span className="text-[10px] text-purple-500">
                {wsConnected ? '• Live' : '• Updated 2 min ago'}
              </span>
            </div>
            <p className="text-xs text-purple-800 dark:text-purple-200 leading-relaxed">
              <strong>{sum.identity.riskyUsers} risky users detected</strong> — possible credential stuffing.
              Sign-in spikes from Brazil, Russia, Vietnam. Recommend enabling CA policy for suspicious
              countries and forcing MFA re-registration for affected accounts.
            </p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={() => nav('/identity')} className="text-[11px] border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50">View risky users</Button>
              <Button size="sm" onClick={() => nav('/security')} className="text-[11px] border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50">Enable CA policy</Button>
            </div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Risky users"          value={sum?.identity.riskyUsers  ?? '—'} color="red"    trend="up"      delta="↑ spike detected"   onClick={() => nav('/identity')} />
        <MetricCard label="Active alerts"        value={totalAlerts}               color="red"    trend="up"      delta={`${counts?.critical ?? 0} critical`} onClick={() => nav('/alerts')} />
        <MetricCard label="Non-compliant devices" value={sum?.devices.nonCompliant ?? '—'} color="yellow" trend="up"      delta="Needs remediation"  onClick={() => nav('/devices')} />
        <MetricCard label="Agents online"        value={`${sum?.agents.online ?? '—'}/${sum?.agents.total ?? '—'}`} color="green" trend="neutral" delta="Fleet status" onClick={() => nav('/agents')} />
      </div>

      {/* Charts row */}
      {(postureHistory as any[]).length > 1 && (
        <Panel title="Security posture trend — 30 days">
          <PostureTrendChart data={postureHistory as any[]} />
        </Panel>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Panel title="Sign-in activity — 7 days" action={<span className="text-[10px] text-green-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />Live</span>}>
            <SignInChart />
          </Panel>
        </div>
        <Panel title="Alert severity breakdown">
          <AlertDonut counts={counts} />
        </Panel>
      </div>

      {/* Alerts + Score */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Panel title="Active alerts" action={<Button size="sm" onClick={() => nav('/alerts')}>View all</Button>}>
            <div className="space-y-1.5">
              {alts?.items.length === 0 && (
                <div className="py-6 text-center text-xs text-gray-500 dark:text-gray-400">No active alerts 🎉</div>
              )}
              {alts?.items.map(a => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all"
                  onClick={() => nav('/alerts')}
                >
                  <SeverityBadge severity={a.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{a.title}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{a.source} · {new Date(a.createdAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Secure score">
            <SecureScoreGauge score={sum?.identity.secureScore ?? 72} />
            <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-1">Top 25% of organizations</div>
          </Panel>
        </div>
      </div>

      {/* Service health */}
      <Panel title="Microsoft 365 service health">
        <div className="grid grid-cols-3 gap-2">
          {serviceHealth.map(s => (
            <div key={s.name} className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/40 cursor-pointer transition-colors">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[s.status as keyof typeof STATUS_COLORS]}`} />
              <div>
                <div className="text-xs text-gray-800 dark:text-gray-200">{s.name}</div>
                <div className={`text-[10px] ${s.status === 'ok' ? 'text-green-500' : s.status === 'warn' ? 'text-amber-500' : 'text-red-500'}`}>
                  {STATUS_LABELS[s.status as keyof typeof STATUS_LABELS]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

    </div>
  )
}
