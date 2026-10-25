import { useNavigate } from 'react-router-dom'
import { Bell, Cpu, Fingerprint, KeyRound, Laptop2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useAlerts, useAlertTrend, useOverview, usePostureHistory, useRiskyUsers, useTenants, useTenantId } from '@/services/api/hooks'
import { AlertTrendChart, TimeSeriesChart } from '@/components/charts'
import { Banner, Button, Card, EmptyState, PageHeader, SeverityBadge, Skeleton, StatCard, StatusPill } from '@/components/ui'
import { fmtNumber, fmtPct, pct, timeAgo } from '@/lib/format'
import { SEVERITY_COLOR } from '@/components/ui'

export function OverviewPage() {
  const navigate = useNavigate()
  const tenantId = useTenantId()
  const { data: o, isLoading } = useOverview()
  const { data: trend } = useAlertTrend(14)
  const { data: posture } = usePostureHistory(30)
  const { data: recent } = useAlerts({ status: 'active', pageSize: 6 })
  const { data: risky } = useRiskyUsers(undefined, 1)
  const tenant = useTenants().data?.find((t) => t.id === tenantId)

  const openAlerts = o ? o.alerts.critical + o.alerts.high + o.alerts.medium + o.alerts.low : 0
  const score = o?.identity.secureScore ?? null

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={tenant ? <>Last collected {timeAgo(tenant.lastSyncAt)} from {tenant.domain}</> : 'Security posture across Microsoft 365 and your endpoints'}
      />

      {tenant?.lastSyncError && (
        <div className="mb-4">
          <Banner tone="error" icon={TriangleAlert} action={<Button size="sm" variant="text" onClick={() => navigate('/tenants')}>Check tenant</Button>}>
            The last collection failed: {tenant.lastSyncError}
          </Banner>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <StatCard label="Open alerts" icon={Bell} tone={o?.alerts.critical ? 'error' : 'primary'} loading={isLoading}
          value={fmtNumber(openAlerts)} onClick={() => navigate('/alerts')}
          detail={o && <>{o.alerts.critical} critical · {o.alerts.high} high</>} />
        <StatCard label="Risky users" icon={Fingerprint} tone={o?.identity.riskyHigh ? 'error' : 'primary'} loading={isLoading}
          value={fmtNumber(o?.identity.riskyUsers)} onClick={() => navigate('/identity')}
          detail={o && <>{o.identity.riskyHigh} high · {o.identity.riskyMedium} medium</>} />
        <StatCard label="Non-compliant devices" icon={Laptop2} tone={o?.devices.nonCompliant ? 'warning' : 'success'} loading={isLoading}
          value={fmtNumber(o?.devices.nonCompliant)} onClick={() => navigate('/devices')}
          detail={o && <>of {o.devices.total} managed devices</>} />
        <StatCard label="Secure Score" icon={ShieldCheck} tone={score === null ? 'neutral' : score >= 70 ? 'success' : 'warning'} loading={isLoading}
          value={fmtPct(score)} onClick={() => navigate('/security')}
          detail={score === null ? 'Not collected (needs SecurityEvents.Read.All)' : 'Microsoft Secure Score'} />
        <StatCard label="MFA registered" icon={KeyRound} tone={o?.identity.mfaPercent === null ? 'neutral' : (o?.identity.mfaPercent ?? 0) >= 90 ? 'success' : 'warning'} loading={isLoading}
          value={fmtPct(o?.identity.mfaPercent)} onClick={() => navigate('/identity')}
          detail={o && (o.identity.mfaTotal ? <>{fmtNumber(o.identity.mfaRegistered)} of {fmtNumber(o.identity.mfaTotal)} users</> : 'Needs AuditLog.Read.All')} />
        <StatCard label="Agents online" icon={Cpu} tone={o && o.agents.total > 0 && o.agents.online < o.agents.total ? 'warning' : 'primary'} loading={isLoading}
          value={o ? `${o.agents.online}/${o.agents.total}` : '—'} onClick={() => navigate('/agents')}
          detail={o && (o.agents.total ? <>{pct(o.agents.online, o.agents.total)}% reporting</> : 'No agents installed')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Alerts per day" subtitle="New alerts by severity over the last 14 days, and how many were resolved">
          <AlertTrendChart data={trend} />
        </Card>
        <Card title="Needs attention" subtitle="Newest open alerts" flush
          action={<Button size="sm" variant="text" onClick={() => navigate('/alerts')}>All alerts</Button>}>
          {!recent ? <div className="px-5 pb-5"><Skeleton rows={5} /></div> : recent.items.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No open alerts" body="Alert rules run every minute; new findings show up here." />
          ) : (
            <ul className="pb-2">
              {recent.items.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate(`/alerts?id=${a.id}`)}
                    className="state-layer w-full text-left px-5 py-2.5 flex items-start gap-3">
                    <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: SEVERITY_COLOR[a.severity] }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-on-surface truncate">{a.title}</span>
                      <span className="block text-xs text-on-surface-variant">{a.source.replace('_', ' ')} · {timeAgo(a.createdAt)}</span>
                    </span>
                    <SeverityBadge severity={a.severity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Posture over time" subtitle="Risky users and non-compliant devices (left axis) and Secure Score (right axis), one point per collection">
          <TimeSeriesChart
            rightUnit="%"
            series={[
              { name: 'High-risk users', color: SEVERITY_COLOR.critical, points: (posture ?? []).map((p) => [p.capturedAt, p.riskyHigh]) },
              { name: 'Medium-risk users', color: SEVERITY_COLOR.medium, points: (posture ?? []).map((p) => [p.capturedAt, p.riskyMedium]) },
              { name: 'Non-compliant devices', color: SEVERITY_COLOR.high, points: (posture ?? []).map((p) => [p.capturedAt, p.devicesNonCompliant]) },
              { name: 'Secure Score', yAxis: 1, dashed: true, points: (posture ?? []).filter((p) => p.secureScore !== null).map((p) => [p.capturedAt, p.secureScore]) },
            ]}
          />
        </Card>
        <Card title="Riskiest users" subtitle="Entra ID Identity Protection" flush
          action={<Button size="sm" variant="text" onClick={() => navigate('/identity')}>Identity</Button>}>
          {!risky ? <div className="px-5 pb-5"><Skeleton rows={4} /></div> : risky.items.length === 0 ? (
            <EmptyState icon={Fingerprint} title="No risky users" body="Identity Protection (Entra ID P2) reports no users at risk." />
          ) : (
            <ul className="pb-2">
              {risky.items.slice(0, 6).map((u) => (
                <li key={u.id} className="px-5 py-2.5 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface-variant text-xs flex items-center justify-center shrink-0">
                    {(u.displayName || u.userPrincipalName).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-on-surface truncate">{u.displayName || u.userPrincipalName}</span>
                    <span className="block text-xs text-on-surface-variant truncate">{u.riskDetail ?? 'risk detected'}{u.countryCode ? ` · ${u.countryCode}` : ''}</span>
                  </span>
                  <StatusPill status={u.riskLevel === 'high' ? 'active' : 'investigating'} label={u.riskLevel} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
