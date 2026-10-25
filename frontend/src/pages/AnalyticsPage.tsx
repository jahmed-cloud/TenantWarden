import { useState } from 'react'
import { Activity, Bell, CheckCircle2, Clock, Globe2, Timer, TrendingDown, TrendingUp } from 'lucide-react'
import { useAlertTrend, useAnalytics, useSignInTrend } from '@/services/api/hooks'
import { AlertTrendChart, DonutChart, SignInTrendChart } from '@/components/charts'
import { Banner, Card, DataTable, EmptyState, KeyValues, PageHeader, Segmented, StatCard } from '@/components/ui'
import { delta, fmtHours, fmtNumber, timeAgo } from '@/lib/format'

const SOURCE_LABEL: Record<string, string> = { entra_id: 'Entra ID', defender: 'Defender', intune: 'Intune', agent: 'Agents', purview: 'Purview', exchange: 'Exchange', teams: 'Teams', sharepoint: 'SharePoint', custom: 'Custom' }

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const { data: a, isLoading } = useAnalytics(days)
  const { data: trend } = useAlertTrend(days)
  const { data: signIns } = useSignInTrend(days)
  const k = a?.kpis
  const an = a?.anomaly

  return (
    <div>
      <PageHeader title="Analytics" subtitle="How alert volume, response times and sign-in risk are changing"
        actions={<Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <StatCard label="Alerts raised" icon={Bell} loading={isLoading} value={fmtNumber(k?.alerts)} change={k ? delta(k.alerts, k.alertsPrev) : null} detail="vs previous period" />
        <StatCard label="Risky sign-ins" icon={Globe2} loading={isLoading} value={fmtNumber(k?.riskySignIns)} change={k ? delta(k.riskySignIns, k.riskySignInsPrev) : null} detail="vs previous period" />
        <StatCard label="Resolved" icon={CheckCircle2} tone="success" loading={isLoading} value={fmtNumber(k?.resolved)} detail={`in ${days} days`} />
        <StatCard label="Still open" icon={Activity} tone={k?.openAlerts ? 'warning' : 'success'} loading={isLoading} value={fmtNumber(k?.openAlerts)} />
        <StatCard label="Time to acknowledge" icon={Timer} loading={isLoading} value={k?.mttaMinutes === null || k?.mttaMinutes === undefined ? '—' : fmtHours(k.mttaMinutes / 60)} detail="mean, acknowledged alerts" />
        <StatCard label="Time to resolve" icon={Clock} loading={isLoading} value={fmtHours(k?.mttrHours)} detail="mean, resolved alerts" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Alerts per day" subtitle="New alerts by severity and resolutions">
          <AlertTrendChart data={trend} />
        </Card>
        <Card title="Where alerts come from">
          <DonutChart height={260} data={(a?.bySource ?? []).map((s) => ({ name: SOURCE_LABEL[s.source] ?? s.source, value: s.count }))}
            centerValue={fmtNumber(a?.bySource.reduce((n, s) => n + s.count, 0))} centerLabel="alerts" empty="No alerts in this period" />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Risky-user anomaly detection" subtitle={an ? `Checked ${timeAgo(an.updatedAt)} by the analytics engine` : 'Daily risky-user counts compared with their own baseline'}>
          {!an ? <EmptyState icon={Activity} title="Waiting for a baseline" body="The analytics engine needs a few days of posture history before it can score today against the baseline." /> : (
            <div className="space-y-4">
              <Banner tone={an.anomaly.isAnomaly ? 'error' : 'success'} icon={an.anomaly.direction === 'drop' ? TrendingDown : TrendingUp}>
                {an.insight?.title ?? an.anomaly.message}
              </Banner>
              <KeyValues items={[
                ['Today', fmtNumber(an.anomaly.currentValue)],
                ['Baseline', `${an.anomaly.baselineMean} ± ${an.anomaly.baselineStd}`],
                ['z-score', an.anomaly.score.toFixed(2)],
                ['Trend', `${an.trend.direction} (${an.trend.percentChange > 0 ? '+' : ''}${an.trend.percentChange}%)`],
                ['Forecast in 7 days', fmtNumber(an.trend.forecast7d)],
              ]} />
              {an.insight && (
                <div className="text-sm">
                  <p className="text-on-surface mb-2">{an.insight.description}</p>
                  <ul className="list-disc pl-5 space-y-1 text-on-surface-variant">{an.insight.recommendedActions.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Card>
        <Card className="xl:col-span-2" title="Risky sign-ins per day">
          <SignInTrendChart data={signIns} />
        </Card>
      </div>

      <Card flush className="mt-4" title="Users with the most risky sign-ins" subtitle={`Last ${days} days`}>
        <DataTable rows={a?.topUsers} rowKey={(u) => u.user}
          empty={<EmptyState icon={Globe2} title="No risky sign-ins in this period" />}
          columns={[
            { key: 'user', header: 'User', render: (u) => <span className="font-medium">{u.user}</span> },
            { key: 'signIns', header: 'Risky sign-ins', align: 'right', render: (u) => fmtNumber(u.signIns) },
            { key: 'high', header: 'High risk', align: 'right', render: (u) => <span className={u.high ? 'text-error font-medium' : ''}>{fmtNumber(u.high)}</span> },
            { key: 'countries', header: 'Countries', align: 'right', render: (u) => fmtNumber(u.countries) },
            { key: 'last', header: 'Last', align: 'right', render: (u) => <span className="text-xs text-on-surface-variant">{timeAgo(u.lastSeen)}</span> },
          ]} />
      </Card>
    </div>
  )
}
