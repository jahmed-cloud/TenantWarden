import { useState } from 'react'
import { Panel, PageHeader, Button, MetricCard } from '@/components/shared/ui'
import { RiskTrendChart, SignInChart } from '@/components/dashboard/Charts'
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react'

type Range = '7d' | '30d' | '90d' | '180d'

const RANGE_OPTIONS: { label: string; value: Range }[] = [
  { label: '7 days',    value: '7d'   },
  { label: '30 days',   value: '30d'  },
  { label: '90 days',   value: '90d'  },
  { label: '180 days',  value: '180d' },
]

const COUNTRY_DATA = [
  { name: 'Brazil',  events: 423, pct: 88, color: '#ef4444' },
  { name: 'Russia',  events: 312, pct: 65, color: '#f97316' },
  { name: 'Vietnam', events: 248, pct: 52, color: '#f59e0b' },
  { name: 'Nigeria', events: 91,  pct: 19, color: '#3b82f6' },
  { name: 'Ukraine', events: 78,  pct: 16, color: '#3b82f6' },
  { name: 'China',   events: 54,  pct: 11, color: '#6b7280' },
]

const AI_INSIGHTS = [
  {
    type: 'anomaly',
    icon: AlertTriangle,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50',
    title: 'Anomaly detected — Jun 24',
    body: 'Risky user count spiked 240% above 30-day baseline (z-score: 3.4). Pattern consistent with credential stuffing from 3 countries. Automated CA policy was not active.',
    actions: ['View affected users', 'Enable CA policy'],
  },
  {
    type: 'trend',
    icon: TrendingUp,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50',
    title: 'MFA adoption — positive trend',
    body: 'MFA coverage increased from 89% to 94% over 30 days (+5 pts). Current pace forecasts 97% by end of quarter. Remaining 6% are in Operations and Sales departments.',
    actions: ['View MFA gaps'],
  },
  {
    type: 'forecast',
    icon: Sparkles,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/50',
    title: 'Secure Score forecast',
    body: 'Based on current remediation velocity, Secure Score is projected to reach 78/100 in 30 days (+6 pts). Top opportunities: Enable SSPR (6 pts), Configure ATP Safe Links (4 pts).',
    actions: ['View recommendations'],
  },
  {
    type: 'positive',
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50',
    title: 'Alert resolution time improved',
    body: 'Mean time to resolve (MTTR) dropped from 4.2 hours to 1.8 hours this month (−57%). Critical alert acknowledgment time averaged 8 minutes vs 23 minutes last month.',
    actions: ['View SLA report'],
  },
]

export function AnalyticsPageFull() {
  const [range, setRange] = useState<Range>('30d')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        subtitle="Historical trends, anomaly detection, forecasting"
        action={
          <div className="flex gap-1">
            {RANGE_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setRange(o.value)}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                  range === o.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Risky sign-ins"    value="1,082"   delta="↑ 240% spike Jun 24" trend="up"   color="red" />
        <MetricCard label="Alerts generated"  value="47"      delta="↓ 12% vs last period" trend="down" color="green" />
        <MetricCard label="MTTR (avg)"         value="1.8h"    delta="↓ 57% improvement"  trend="down" color="green" />
        <MetricCard label="Baseline deviation" value="3.4σ"    delta="Anomaly threshold: 2.5σ" trend="up" color="red" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Risk score trend">
          <RiskTrendChart />
          <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">Anomaly detected Jun 24 — z-score 3.4 above 30-day baseline</p>
        </Panel>

        <Panel title="Top risky countries — {range}">
          <div className="space-y-3 mt-1">
            {COUNTRY_DATA.map(c => (
              <div key={c.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-700 dark:text-gray-300">{c.name}</span>
                  <span className="text-gray-500">{c.events} events</span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                  <div className="h-full rounded-full transition-all" style={{ width: `${c.pct}%`, background: c.color }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Panel title="Sign-in volume trend">
          <SignInChart />
        </Panel>

        <Panel title="Alert severity over time">
          <div className="flex flex-col items-center justify-center h-40 text-xs text-gray-500">
            <span className="text-2xl mb-2">📊</span>
            Historical alert breakdown chart — populated after 7+ days of data
          </div>
        </Panel>
      </div>

      {/* AI Insights */}
      <div>
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-purple-600 dark:text-purple-400" />
          AI-generated insights
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {AI_INSIGHTS.map((insight, i) => {
            const Icon = insight.icon
            return (
              <div key={i} className={`p-4 border rounded-xl ${insight.bg}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className={insight.color} />
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{insight.title}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{insight.body}</p>
                <div className="flex gap-2 mt-3">
                  {insight.actions.map(a => (
                    <Button key={a} size="sm" className="text-[11px] border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">{a}</Button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
