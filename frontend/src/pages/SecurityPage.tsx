import { useState } from 'react'
import { Activity, ExternalLink, ShieldAlert, ShieldCheck, Siren } from 'lucide-react'
import { useIncidents, useSecureScoreHistory, useSecuritySummary, useServiceHealth } from '@/services/api/hooks'
import { GaugeChart, TimeSeriesChart, EmptyChart } from '@/components/charts'
import { Card, Chip, DataTable, EmptyState, KeyValues, PageHeader, SeverityBadge, StatCard, StatusPill } from '@/components/ui'
import { fmtDateTime, fmtNumber, timeAgo } from '@/lib/format'

export function SecurityPage() {
  const { data: s, isLoading } = useSecuritySummary()
  const { data: history } = useSecureScoreHistory(90)
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open')
  const { data: incidents, isLoading: incidentsLoading } = useIncidents(status)
  const { data: health } = useServiceHealth()

  const score = s?.secureScore
  const change = score && score.percentage7dAgo !== null ? score.percentage - score.percentage7dAgo : null
  const unhealthy = (health ?? []).filter((h) => !/operational|restored|resolved/i.test(h.status))

  return (
    <div>
      <PageHeader title="Security" subtitle="Microsoft Secure Score, Defender XDR incidents and Microsoft 365 service health" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Open incidents" icon={Siren} tone={s?.incidents.open ? 'error' : 'success'} loading={isLoading}
          value={fmtNumber(s?.incidents.open)} detail={s && <>{s.incidents.high} high · {s.incidents.medium} medium · {s.incidents.low} low</>} />
        <StatCard label="New in 7 days" icon={ShieldAlert} loading={isLoading} value={fmtNumber(s?.incidents.new7d)} />
        <StatCard label="Resolved in 7 days" icon={ShieldCheck} tone="success" loading={isLoading} value={fmtNumber(s?.incidents.resolved7d)} />
        <StatCard label="Service issues" icon={Activity} tone={unhealthy.length ? 'warning' : 'success'} loading={!health}
          value={health ? unhealthy.length : '—'} detail={health?.length ? `${health.length} services tracked` : 'needs ServiceHealth.Read.All'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Secure Score" subtitle={score ? `Recorded ${timeAgo(score.recordedAt)}` : 'Microsoft Defender'}>
          {score ? (
            <>
              <GaugeChart value={score.percentage} />
              <KeyValues items={[
                ['Points', `${fmtNumber(Math.round(score.currentScore))} of ${fmtNumber(Math.round(score.maxScore))}`],
                ['Change (7 days)', change === null ? '—' : <span className={change >= 0 ? 'text-success' : 'text-error'}>{change >= 0 ? '+' : ''}{change} pts</span>],
                ['Licensed users', fmtNumber(score.licensedUsers)],
                ['Active users', fmtNumber(score.activeUsers)],
              ]} />
            </>
          ) : <EmptyChart height={240} message="Secure Score not collected yet. Grant SecurityEvents.Read.All and run a collection." />}
        </Card>
        <Card className="xl:col-span-2" title="Secure Score history" subtitle="Last 90 days">
          <TimeSeriesChart percent height={300} empty="No Secure Score history yet"
            series={[{ name: 'Secure Score', area: true, points: (history ?? []).map((p) => [p.recordedAt, p.percentage]) }]} />
        </Card>
      </div>

      <Card flush className="mb-4" title="Defender XDR incidents" subtitle="Incidents updated in the last 30 days; high and medium ones also raise alerts"
        action={<div className="flex gap-1">{(['open', 'resolved', 'all'] as const).map((v) => <Chip key={v} selected={status === v} onClick={() => setStatus(v)}>{v}</Chip>)}</div>}>
        <DataTable rows={incidents} loading={incidentsLoading} rowKey={(i) => i.id}
          empty={<EmptyState icon={ShieldCheck} title="No incidents" body="Defender XDR reports no incidents for this filter (needs SecurityIncident.Read.All)." />}
          columns={[
            { key: 'sev', header: 'Severity', render: (i) => <SeverityBadge severity={i.severity === 'informational' ? 'info' : i.severity} /> },
            { key: 'name', header: 'Incident', render: (i) => (
              <div className="min-w-0 max-w-[420px]">
                <div className="font-medium truncate">{i.displayName}</div>
                <div className="text-xs text-on-surface-variant">#{i.incidentId} · {i.alertCount} alert{i.alertCount === 1 ? '' : 's'}{i.classification && ` · ${i.classification}`}</div>
              </div>
            ) },
            { key: 'status', header: 'Status', render: (i) => <StatusPill status={i.status} /> },
            { key: 'owner', header: 'Assigned to', render: (i) => <span className="text-xs">{i.assignedTo ?? '—'}</span> },
            { key: 'updated', header: 'Updated', render: (i) => <span className="text-xs text-on-surface-variant" title={fmtDateTime(i.lastUpdateAt)}>{timeAgo(i.lastUpdateAt ?? i.createdAt)}</span> },
            { key: 'link', header: '', align: 'right', render: (i) => i.webUrl && (
              <a href={i.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Defender <ExternalLink size={12} /></a>
            ) },
          ]} />
      </Card>

      <Card flush title="Microsoft 365 service health" subtitle="Latest status reported by Microsoft for each service">
        <DataTable rows={health} rowKey={(h) => h.service}
          empty={<EmptyState icon={Activity} title="No service health data" body="Needs ServiceHealth.Read.All." />}
          columns={[
            { key: 'service', header: 'Service', render: (h) => <span className="font-medium">{h.service}</span> },
            { key: 'status', header: 'Status', render: (h) => <StatusPill status={h.status} label={h.status.replace(/([a-z])([A-Z])/g, '$1 $2')} /> },
            { key: 'detail', header: 'Detail', render: (h) => <span className="text-xs text-on-surface-variant">{h.detail ?? '—'}</span> },
            { key: 'at', header: 'Checked', align: 'right', render: (h) => <span className="text-xs text-on-surface-variant">{timeAgo(h.recordedAt)}</span> },
          ]} />
      </Card>
    </div>
  )
}
