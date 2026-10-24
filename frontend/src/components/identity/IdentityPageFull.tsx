import { useState } from 'react'
import { useRiskyUsers, useIdentitySummary, useResetPassword } from '@/services/api/hooks'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { MetricCard, Panel, SeverityBadge, Button, DataTable, PageHeader } from '@/components/shared/ui'
import { MfaCoverageChart, AuthMethodsSankey } from '@/components/dashboard/Charts'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { RefreshCw, UserX, Key, Globe, Clock } from 'lucide-react'

interface SignInEvent {
  time:    string
  user:    string
  detail:  string
  type:    'success' | 'risky' | 'blocked' | 'info'
}

const RECENT_SIGNINS: SignInEvent[] = [
  { time: '2 min ago',  user: 'jdoe@contoso.com',    detail: 'Failed — password spray (Brazil)',          type: 'blocked' },
  { time: '8 min ago',  user: 'akim@contoso.com',     detail: 'MFA success — iOS Teams (US)',              type: 'success' },
  { time: '14 min ago', user: 'asmith@contoso.com',   detail: 'Risky — impossible travel: Moscow → NYC',   type: 'risky'   },
  { time: '22 min ago', user: 'guest@fabrikam.com',    detail: 'CA policy triggered — external access',     type: 'info'    },
  { time: '45 min ago', user: 'admin@contoso.com',     detail: 'New CA policy applied',                     type: 'info'    },
  { time: '1 hr ago',   user: 'mlee@contoso.com',      detail: 'Risky sign-in — atypical travel (Vietnam)', type: 'risky'   },
]

const DOT_COLOR = { success: 'bg-green-500', risky: 'bg-amber-500', blocked: 'bg-red-500', info: 'bg-blue-500' }

export function IdentityPageFull() {
  const { data: summary }               = useIdentitySummary()
  const { data: riskyUsers, isLoading } = useRiskyUsers()
  const [resettingId, setResettingId]   = useState<string | null>(null)
  const resetPwd                        = useResetPassword()
  const tenantId                        = useTenantWardenStore(s => s.activeTenant?.id ?? '')

  const { data: authMethodsAll } = useQuery({
    queryKey: ['auth-methods', tenantId, 'all_users'],
    queryFn: async () => (await apiClient.get(`/v1/identity/auth-methods?tenantId=${tenantId}&scope=all_users`)).data as any[],
    enabled: !!tenantId,
  })
  const { data: authMethodsPriv } = useQuery({
    queryKey: ['auth-methods', tenantId, 'privileged_users'],
    queryFn: async () => (await apiClient.get(`/v1/identity/auth-methods?tenantId=${tenantId}&scope=privileged_users`)).data as any[],
    enabled: !!tenantId,
  })

  async function handleReset(userId: string) {
    setResettingId(userId)
    try { await resetPwd.mutateAsync({ userId, tenantId }) }
    finally { setResettingId(null) }
  }

  const columns = [
    {
      key: 'userPrincipalName', header: 'User', width: '30%',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-medium flex-shrink-0">
            {r.displayName?.slice(0, 2).toUpperCase() ?? '??'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{r.userPrincipalName}</div>
            <div className="text-[10px] text-gray-500">{r.displayName}</div>
          </div>
        </div>
      ),
    },
    { key: 'riskLevel',  header: 'Risk',    width: '90px', render: (r: any) => <SeverityBadge severity={r.riskLevel} /> },
    { key: 'riskDetail', header: 'Reason',  width: '25%' },
    {
      key: 'countryCode', header: 'Location', width: '90px',
      render: (r: any) => r.countryCode
        ? <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400"><Globe size={11} />{r.countryCode}</span>
        : <span className="text-gray-400 dark:text-gray-600">—</span>,
    },
    {
      key: 'actions', header: '', width: '180px',
      render: (r: any) => (
        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
          <Button
            size="sm"
            onClick={() => handleReset(r.id)}
            className="text-[11px]"
          >
            {resettingId === r.id ? <RefreshCw size={10} className="animate-spin" /> : <Key size={10} />}
            Reset pwd
          </Button>
          <Button size="sm" className="text-[11px]">
            <UserX size={10} />
            Dismiss
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Identity — Entra ID"
        subtitle="Risky users, sign-ins, MFA, Conditional Access"
        action={<Button variant="primary" size="sm">Run identity scan</Button>}
      />

      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Total users"  value={summary?.totalUsers ?? '—'} />
        <MetricCard label="Risky users"  value={summary?.riskyUsers ?? '—'} color="red"   trend="up"   delta="↑ spike" />
        <MetricCard label="MFA enabled"  value={`${summary?.mfaPercent ?? '—'}%`} color="green" trend="down" delta="Improving" />
        <MetricCard label="CA policies"  value={summary?.caPolicies ?? '—'} />
      </div>

      <Panel title="Risky users — immediate action required">
        <DataTable
          columns={columns as any}
          data={riskyUsers?.items ?? []}
          keyField="id"
          loading={isLoading}
        />
        {riskyUsers && riskyUsers.total > riskyUsers.items.length && (
          <div className="mt-3 text-center">
            <Button size="sm">Load more ({riskyUsers.total - riskyUsers.items.length} remaining)</Button>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-4">
        <Panel title="MFA coverage by department">
          <MfaCoverageChart />
        </Panel>

        <Panel title="Privileged users — auth methods">
          <AuthMethodsSankey data={authMethodsPriv} />
          <p className="text-[11px] text-gray-500 mt-2">Strongest authentication method registered by admin/privileged users.</p>
        </Panel>

        <Panel title="All users — auth methods">
          <AuthMethodsSankey data={authMethodsAll} />
          <p className="text-[11px] text-gray-500 mt-2">Strongest authentication method registered by all users.</p>
        </Panel>

        <Panel title="Recent sign-in events">
          <div className="space-y-0">
            {RECENT_SIGNINS.map((e, i) => (
              <div key={i} className="flex gap-3 py-2.5 border-b border-gray-200 dark:border-gray-800/60 last:border-0">
                <div className="flex-shrink-0 flex items-center gap-1.5 w-20">
                  <Clock size={10} className="text-gray-400 dark:text-gray-600" />
                  <span className="text-[10px] text-gray-500">{e.time}</span>
                </div>
                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${DOT_COLOR[e.type]}`} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{e.user}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{e.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
