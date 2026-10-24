// ─── Alerts page ──────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useAlerts, useAcknowledgeAlert, useResolveAlert } from '@/services/api/hooks'
import { MetricCard, PageHeader, Panel, SeverityBadge, StatusBadge, Button, DataTable } from '@/components/shared/ui'
import { Filter } from 'lucide-react'
import { apiClient } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { useQuery } from '@tanstack/react-query'
import { DeviceComplianceDonut, DeviceOsBarChart } from '@/components/dashboard/Charts'
import toast from 'react-hot-toast'

export function AlertsPage() {
  const [severity, setSeverity]     = useState('')
  const [status,   setStatus]       = useState('active')
  const [search,   setSearch]       = useState('')
  const { data, isLoading }         = useAlerts({ severity, status, search })
  const acknowledge                 = useAcknowledgeAlert()
  const resolve                     = useResolveAlert()

  const columns = [
    { key: 'severity', header: 'Severity', width: '90px',  render: (r: any) => <SeverityBadge severity={r.severity} /> },
    { key: 'title',    header: 'Alert',    width: '35%',   render: (r: any) => <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.title}</div> },
    { key: 'source',   header: 'Source',   width: '100px' },
    { key: 'status',   header: 'Status',   width: '110px', render: (r: any) => <StatusBadge status={r.status} /> },
    { key: 'createdAt',header: 'Time',     width: '100px', render: (r: any) => <span className="text-gray-400">{new Date(r.createdAt).toLocaleTimeString()}</span> },
    { key: 'actions',  header: '',         width: '160px', render: (r: any) => (
      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
        {r.status === 'active' && <Button size="sm" onClick={() => acknowledge.mutate({ id: r.id })}>Ack</Button>}
        {r.status !== 'resolved' && <Button size="sm" onClick={() => resolve.mutate({ id: r.id, resolution: 'Resolved by analyst' })}>Resolve</Button>}
      </div>
    )},
  ]

  return (
    <div>
      <PageHeader title="Alert center" subtitle="All active, acknowledged, and resolved alerts" action={<Button variant="primary" size="sm">Configure rules</Button>} />

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5">
          <Filter size={12} className="text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alerts..." className="text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 w-40 placeholder:text-gray-400" />
        </div>
        {(['', 'critical', 'high', 'medium', 'low'] as const).map(s => (
          <button key={s} onClick={() => setSeverity(s)} className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${severity === s ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
            {s || 'All'}
          </button>
        ))}
        <select value={status} onChange={e => setStatus(e.target.value)} className="ml-auto text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 outline-none">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <Panel>
        <DataTable columns={columns as any} data={data?.items ?? []} keyField="id" loading={isLoading} />
        {data && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
            <span>{data.total} total alerts</span>
            <span>Page {data.page} of {data.totalPages}</span>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ─── Identity page ─────────────────────────────────────────────────────────────

import { useRiskyUsers, useIdentitySummary, useResetPassword } from '@/services/api/hooks'

export function IdentityPage() {
  const { data: summary }             = useIdentitySummary()
  const { data: riskyUsers, isLoading } = useRiskyUsers()
  const resetPwd                      = useResetPassword()
  const tenantId                      = useTenantWardenStore(s => s.activeTenant?.id ?? '')

  const riskColumns = [
    { key: 'userPrincipalName', header: 'User',       width: '35%', render: (r: any) => <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.userPrincipalName}</div> },
    { key: 'riskLevel',         header: 'Risk level', width: '100px', render: (r: any) => <SeverityBadge severity={r.riskLevel} /> },
    { key: 'riskDetail',        header: 'Risk type',  width: '30%' },
    { key: 'countryCode',       header: 'Country',    width: '80px', render: (r: any) => r.countryCode ?? '—' },
    { key: 'actions',           header: '',           width: '130px', render: (r: any) => (
      <Button size="sm" onClick={(e) => { e.stopPropagation(); resetPwd.mutate({ userId: r.id, tenantId }) }}>
        Reset password
      </Button>
    )},
  ]

  return (
    <div>
      <PageHeader title="Identity — Entra ID" subtitle="Risky users, sign-ins, MFA, Conditional Access" action={<Button variant="primary" size="sm" onClick={() => apiClient.post('/v1/collect').then(() => toast.success('Identity scan started')).catch(() => toast.error('Trigger failed'))}>Run identity scan</Button>} />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard label="Total users"      value={summary?.totalUsers ?? '—'} />
        <MetricCard label="Risky users"      value={summary?.riskyUsers ?? '—'} color="red" trend="up" delta="Needs review" />
        <MetricCard label="MFA enabled"      value={`${summary?.mfaPercent ?? '—'}%`} color="green" trend="down" delta="Improving" />
        <MetricCard label="CA policies"      value={summary?.caPolicies ?? '—'} />
      </div>

      <Panel title="Risky users — action required">
        <DataTable columns={riskColumns as any} data={riskyUsers?.items ?? []} keyField="id" loading={isLoading} />
      </Panel>
    </div>
  )
}

// ─── Devices page ──────────────────────────────────────────────────────────────

import { useDevices } from '@/services/api/hooks'

export function DevicesPage() {
  const { data, isLoading } = useDevices()
  const tenantId = useTenantWardenStore(s => s.activeTenant?.id ?? '')
  const { data: summary } = useQuery({
    queryKey: ['device-summary', tenantId],
    queryFn: async () => (await apiClient.get(`/v1/devices/summary?tenantId=${tenantId}`)).data as any,
    enabled: !!tenantId,
  })

  const columns = [
    { key: 'deviceName',        header: 'Device',        width: '25%', render: (r: any) => <div className="font-medium text-gray-900 dark:text-gray-100">{r.deviceName}</div> },
    { key: 'userPrincipalName', header: 'User',          width: '25%', render: (r: any) => <div className="truncate">{r.userPrincipalName}</div> },
    { key: 'operatingSystem',   header: 'OS',            width: '15%' },
    { key: 'osVersion',         header: 'Version',       width: '12%' },
    { key: 'complianceState',   header: 'Compliance',    width: '120px', render: (r: any) => <StatusBadge status={r.complianceState} /> },
    { key: 'lastSyncDateTime',  header: 'Last sync',     width: '120px', render: (r: any) => <span className="text-gray-400">{r.lastSyncDateTime ? new Date(r.lastSyncDateTime).toLocaleDateString() : '—'}</span> },
  ]

  const nonCompliant = data?.items.filter(d => d.complianceState !== 'compliant').length ?? 0

  return (
    <div>
      <PageHeader title="Devices — Intune" subtitle="Device compliance, BitLocker, patch status" action={<Button variant="primary" size="sm">Sync Intune</Button>} />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard label="Total devices"       value={data?.total ?? '—'} />
        <MetricCard label="Compliant"           value={data ? data.total - nonCompliant : '—'} color="green" />
        <MetricCard label="Non-compliant"       value={nonCompliant} color="red" trend="up" delta="Needs remediation" />
        <MetricCard label="Compliance rate"     value={data ? `${Math.round(((data.total - nonCompliant) / data.total) * 100)}%` : '—'} color="green" />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-4 mb-5">
          <Panel title="Device compliance">
            <DeviceComplianceDonut
              compliant={summary.compliance?.compliant ?? 0}
              nonCompliant={summary.compliance?.nonCompliant ?? 0}
            />
            <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400">
              <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Compliant</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Non-compliant</span>
            </div>
          </Panel>
          <Panel title="Devices by platform">
            <DeviceOsBarChart data={summary.byOs ?? []} />
          </Panel>
        </div>
      )}

      <Panel title="All managed devices">
        <DataTable columns={columns as any} data={data?.items ?? []} keyField="id" loading={isLoading} />
      </Panel>
    </div>
  )
}

// ─── Agents page ───────────────────────────────────────────────────────────────

import { useAgents, useAgentStats } from '@/services/api/hooks'

export function AgentsPage() {
  const { data: agents, isLoading } = useAgents()
  const { data: stats }             = useAgentStats()

  const platformIcon = (p: string) => ({ windows: '🪟', linux: '🐧', macos: '🍎', docker: '🐳', kubernetes: '⎈' })[p] ?? '💻'

  const columns = [
    { key: 'hostname',        header: 'Host',      width: '28%', render: (r: any) => (
      <div className="flex items-center gap-2">
        <span>{platformIcon(r.platform)}</span>
        <div>
          <div className="font-medium text-gray-900 dark:text-gray-100">{r.hostname}</div>
          <div className="text-[10px] text-gray-400">{r.version}</div>
        </div>
      </div>
    )},
    { key: 'status',          header: 'Status',    width: '90px', render: (r: any) => <StatusBadge status={r.status} /> },
    { key: 'osName',          header: 'OS',        width: '15%' },
    { key: 'cpuPercent',      header: 'CPU',       width: '70px', render: (r: any) => r.cpuPercent != null ? `${r.cpuPercent.toFixed(1)}%` : '—' },
    { key: 'memoryPercent',   header: 'Memory',    width: '70px', render: (r: any) => r.memoryPercent != null ? `${r.memoryPercent.toFixed(1)}%` : '—' },
    { key: 'lastHeartbeatAt', header: 'Last seen', width: '100px', render: (r: any) => <span className="text-gray-400">{r.lastHeartbeatAt ? new Date(r.lastHeartbeatAt).toLocaleTimeString() : '—'}</span> },
  ]

  return (
    <div>
      <PageHeader title="Agents" subtitle="TenantWarden agents deployed across your infrastructure" action={<Button variant="primary" size="sm">Deploy agent</Button>} />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard label="Total agents"  value={stats?.total ?? '—'} />
        <MetricCard label="Online"        value={stats?.online ?? '—'} color="green" />
        <MetricCard label="Windows"       value={stats?.windows ?? '—'} />
        <MetricCard label="Linux"         value={stats?.linux ?? '—'} />
      </div>

      <Panel title="Agent fleet">
        <DataTable columns={columns as any} data={agents ?? []} keyField="id" loading={isLoading} />
      </Panel>

      {/* Download section */}
      <Panel title="Deploy a new agent" className="mt-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { platform: 'Windows', icon: '🪟', file: 'tenantwarden-agent.exe', cmd: '.\\tenantwarden-agent.exe start' },
            { platform: 'Linux',   icon: '🐧', file: 'tenantwarden-agent-linux-amd64', cmd: './tenantwarden-agent start' },
            { platform: 'Docker',  icon: '🐳', file: 'Docker image',  cmd: 'docker run tenantwarden/agent:latest start' },
          ].map(d => (
            <div key={d.platform} className="p-3.5 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="text-xl mb-2">{d.icon}</div>
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100 mb-1">{d.platform}</div>
              <div className="text-[10px] text-gray-400 mb-3">{d.file}</div>
              <code className="block text-[10px] bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded text-gray-600 dark:text-gray-400 font-mono break-all">{d.cmd}</code>
              <Button size="sm" className="mt-2 w-full justify-center" onClick={() => window.open(`/downloads/${d.file}`, '_blank')}>Download</Button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
