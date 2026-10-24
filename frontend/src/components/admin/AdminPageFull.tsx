import { useState } from 'react'
import { Panel, Button, StatusBadge, DataTable, PageHeader } from '@/components/shared/ui'
import { Key, Bell, Users, Activity, Shield, Settings, Plus, Copy, CheckCircle } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import toast from 'react-hot-toast'

type AdminTab = 'notifications' | 'rbac' | 'apikeys' | 'audit' | 'stack'

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell    },
  { id: 'rbac',          label: 'RBAC',          icon: Users   },
  { id: 'apikeys',       label: 'API Keys',      icon: Key     },
  { id: 'audit',         label: 'Audit log',     icon: Activity },
  { id: 'stack',         label: 'Stack',         icon: Settings },
]

const CHANNEL_ICONS: Record<string, string> = {
  teams: '💬', slack: '⚡', email: '📧', pagerduty: '🚨', webhook: '🔗', servicenow: '🎫', jira: '📋',
}

// Role definitions are static by design (they mirror the DB enum);
// user counts come live from /v1/users/role-summary
const ROLES = [
  { role: 'super_admin',     label: 'Super Admin',  scope: 'All tenants',   color: 'text-red-600 dark:text-red-400' },
  { role: 'org_admin',       label: 'Org Admin',  scope: 'Organisation',  color: 'text-orange-600 dark:text-orange-400' },
  { role: 'security_admin',  label: 'Security Admin',  scope: 'Org-wide',      color: 'text-amber-600 dark:text-amber-400' },
  { role: 'soc_analyst',     label: 'SOC Analyst',  scope: 'Read + alerts', color: 'text-blue-600 dark:text-blue-400' },
  { role: 'global_reader',   label: 'Global Reader', scope: 'Read-only',     color: 'text-gray-500 dark:text-gray-400' },
  { role: 'helpdesk',        label: 'Helpdesk',  scope: 'Devices + users', color: 'text-gray-500 dark:text-gray-400' },
  { role: 'auditor',         label: 'Auditor',  scope: 'Compliance',    color: 'text-purple-600 dark:text-purple-400' },
  { role: 'viewer',          label: 'Viewer', scope: 'Dashboard only',color: 'text-gray-500' },
]


const STACK = [
  { layer: 'Frontend',      tech: 'React 18 + TypeScript + Vite 5',    status: 'ok' },
  { layer: 'Backend API',   tech: 'ASP.NET Core 9 + Hangfire',          status: 'ok' },
  { layer: 'Auth Service',  tech: 'ASP.NET Core 9 + MSAL + JWT',        status: 'ok' },
  { layer: 'Collector',     tech: 'Node.js 20 + Microsoft Graph SDK',   status: 'ok' },
  { layer: 'Alert Engine',  tech: 'Node.js 20 + Redis pub/sub',         status: 'ok' },
  { layer: 'Analytics',     tech: 'Node.js 20 + z-score detection',     status: 'ok' },
  { layer: 'Notifications', tech: 'Node.js 20 + Teams/Slack/Email',     status: 'ok' },
  { layer: 'Agent Gateway', tech: 'ASP.NET Core 9 + WebSocket hub',     status: 'ok' },
  { layer: 'Agents',        tech: 'Go 1.22 + gopsutil (cross-platform)','status': 'ok' },
  { layer: 'PostgreSQL',    tech: 'PostgreSQL 16 + Dapper',             status: 'ok' },
  { layer: 'ClickHouse',    tech: 'ClickHouse 24 + MergeTree',          status: 'ok' },
  { layer: 'Redis',         tech: 'Redis 7 + pub/sub + streams',        status: 'ok' },
  { layer: 'Object Storage',tech: 'MinIO',                              status: 'ok' },
  { layer: 'Reverse Proxy', tech: 'Nginx + TLS + rate limiting',        status: 'ok' },
  { layer: 'Observability', tech: 'Prometheus + Grafana + Loki',        status: 'ok' },
]

export function AdminPageFull() {
  const [activeTab, setActiveTab] = useState<AdminTab>('notifications')
  const queryClient  = useQueryClient()
  const activeTenant = useTenantWardenStore((s) => s.activeTenant)
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => (await apiClient.get('/v1/channels')).data as any[],
  })
  const [showAdd, setShowAdd] = useState(false)
  const [cf, setCf] = useState({ name: '', type: 'email', target: '', minSeverity: 'medium' })

  // Live data — replaces the previous hardcoded arrays
  const { data: roleSummary = [] } = useQuery({
    queryKey: ['role-summary'],
    queryFn: async () => (await apiClient.get('/v1/users/role-summary')).data as any[],
  })
  const { data: auditEntries = [] } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await apiClient.get('/v1/audit?limit=50')).data as any[],
  })

  async function addChannel() {
    if (!cf.name || !cf.target) { toast.error('Fill in name and target'); return }
    if (!activeTenant?.id)      { toast.error('Select a tenant first (top-left dropdown)'); return }
    const config =
        cf.type === 'email'      ? { recipients: cf.target.split(',').map(s => s.trim()).filter(Boolean) }
      : cf.type === 'pagerduty'  ? { routingKey: cf.target }
      : cf.type === 'servicenow' ? { assignmentGroup: cf.target }
      : cf.type === 'jira'       ? { projectKey: cf.target }
      : { webhookUrl: cf.target }
    try {
      await apiClient.post('/v1/channels', {
        tenantId: activeTenant.id, name: cf.name, type: cf.type, config, minSeverity: cf.minSeverity,
      })
      toast.success('Channel added')
      setShowAdd(false); setCf({ name: '', type: 'email', target: '', minSeverity: 'medium' })
      queryClient.invalidateQueries({ queryKey: ['channels'] })
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed to add channel') }
  }
  async function testChannel(id: string) {
    try { await apiClient.post(`/v1/channels/${id}/test`); toast.success('Test alert sent — check the channel') }
    catch { toast.error('Test failed') }
  }
  async function deleteChannel(id: string) {
    try { await apiClient.delete(`/v1/channels/${id}`); toast.success('Channel removed'); queryClient.invalidateQueries({ queryKey: ['channels'] }) }
    catch { toast.error('Delete failed') }
  }
  const [copied, setCopied]       = useState(false)

  function copyApiKey() {
    navigator.clipboard.writeText('grd_demo_key_replace_with_real').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Administration" subtitle="RBAC, notifications, API keys, audit log, platform health" />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setShowAdd(v => !v)}><Plus size={12} />Add channel</Button>
          </div>

          {showAdd && (
            <div className="p-3.5 bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Channel name" value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })}
                  className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500" />
                <select value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })}
                  className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 outline-none">
                  <option value="email">Email (SMTP)</option><option value="teams">Microsoft Teams</option>
                  <option value="slack">Slack</option><option value="webhook">Webhook</option>
                  <option value="pagerduty">PagerDuty</option><option value="servicenow">ServiceNow</option>
                  <option value="jira">Jira</option>
                </select>
              </div>
              <input placeholder={
                  cf.type === 'email'      ? 'Recipients (comma-separated)'
                : cf.type === 'pagerduty'  ? 'Routing key'
                : cf.type === 'servicenow' ? 'Assignment group (uses .env instance/creds)'
                : cf.type === 'jira'       ? 'Project key (e.g. SEC) — uses .env url/creds'
                : 'Webhook URL'}
                value={cf.target} onChange={(e) => setCf({ ...cf, target: e.target.value })}
                className="w-full text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500" />
              <div className="flex items-center justify-between">
                <select value={cf.minSeverity} onChange={(e) => setCf({ ...cf, minSeverity: e.target.value })}
                  className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 outline-none">
                  <option value="critical">Critical only</option><option value="high">High +</option>
                  <option value="medium">Medium +</option><option value="low">Low +</option><option value="info">All</option>
                </select>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
                  <Button size="sm" variant="primary" onClick={addChannel}>Save channel</Button>
                </div>
              </div>
            </div>
          )}

          {channels.length === 0 && !showAdd && (
            <p className="text-xs text-gray-500 py-4 text-center">No notification channels configured yet — click "Add channel" to create one.</p>
          )}

          {(channels as any[]).map(ch => (
            <div key={ch.id} className="flex items-center gap-4 p-3.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-gray-200 dark:hover:border-gray-700 transition-colors">
              <span className="text-xl flex-shrink-0">{CHANNEL_ICONS[ch.type] ?? '🔔'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{ch.name}</span>
                  <StatusBadge status={ch.isEnabled ? 'online' : 'offline'} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{ch.type} · Min severity: {ch.minSeverity}</div>
              </div>
              <Button size="sm" onClick={() => testChannel(ch.id)}>Test</Button>
              <button onClick={() => deleteChannel(ch.id)} className="text-gray-400 dark:text-gray-600 hover:text-red-600 dark:hover:text-red-400 text-xs">Remove</button>
            </div>
          ))}
        </div>
      )}

      {/* RBAC tab */}
      {activeTab === 'rbac' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="primary" size="sm"><Plus size={12} />Invite user</Button>
          </div>
          <Panel>
            <div className="space-y-1">
              {ROLES.map(r => {
                const live = (roleSummary as any[]).find(x => x.role === r.role)
                const count = live?.users ?? 0
                return (
                <div key={r.role} className="flex items-center gap-4 py-3 border-b border-gray-200 dark:border-gray-800/60 last:border-0">
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${r.color}`}>{r.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{r.scope}</div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{count} user{count !== 1 ? 's' : ''}</div>
                </div>
                )
              })}
            </div>
          </Panel>
        </div>
      )}

      {/* API Keys tab */}
      {activeTab === 'apikeys' && (
        <div className="space-y-4">
          <Panel title="Active API keys" action={<Button variant="primary" size="sm"><Plus size={12} />Generate key</Button>}>
            <div className="space-y-3">
              {[
                { name: 'Monitoring integration', created: 'Jun 1, 2026', lastUsed: '2 min ago',  perms: ['read', 'events'] },
                { name: 'SIEM connector',          created: 'May 15, 2026', lastUsed: '1h ago',    perms: ['read', 'events'] },
                { name: 'CI/CD pipeline',          created: 'Apr 3, 2026',  lastUsed: '3 days ago', perms: ['read'] },
              ].map((k, i) => (
                <div key={i} className="flex items-center gap-4 p-3 bg-gray-100 dark:bg-gray-800/40 rounded-lg border border-gray-200 dark:border-gray-800">
                  <Key size={14} className="text-gray-500 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{k.name}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">Created {k.created} · Last used {k.lastUsed}</div>
                    <div className="flex gap-1.5 mt-1.5">
                      {k.perms.map(p => <span key={p} className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">{p}</span>)}
                    </div>
                  </div>
                  <code className="text-[11px] font-mono text-gray-500">grd_••••••••••••</code>
                  <button onClick={copyApiKey} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                    {copied ? <CheckCircle size={14} className="text-green-600 dark:text-green-400" /> : <Copy size={14} />}
                  </button>
                  <button className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400">Revoke</button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* Audit log tab */}
      {activeTab === 'audit' && (
        <Panel title="Audit log — most recent 50 events">
          {auditEntries.length === 0 && (
            <p className="text-xs text-gray-500 py-4 text-center">
              No audit events recorded yet. Events appear here as users sign in and make changes.
            </p>
          )}
          <DataTable
            columns={[
              { key: 'createdAt', header: 'Time',     width: '150px', render: (r: any) => <span className="text-gray-500">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</span> },
              { key: 'userEmail', header: 'User',     width: '25%',   render: (r: any) => <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{r.userEmail}</span> },
              { key: 'action',    header: 'Action',   width: '20%',   render: (r: any) => <code className="text-xs text-blue-600 dark:text-blue-400">{r.action}</code> },
              { key: 'resource',  header: 'Resource', width: '20%' },
              { key: 'ipAddress', header: 'IP',       width: '110px', render: (r: any) => <span className="text-gray-500 font-mono text-xs">{r.ipAddress ?? '—'}</span> },
              { key: 'success',   header: 'Result',   width: '70px',  render: (r: any) => <span className={r.success ? 'text-green-600 dark:text-green-400 text-xs' : 'text-red-600 dark:text-red-400 text-xs'}>{r.success ? '✓ OK' : '✗ Fail'}</span> },
            ] as any}
            data={auditEntries as any[]}
            keyField="id"
          />
        </Panel>
      )}

      {/* Stack tab */}
      {activeTab === 'stack' && (
        <Panel title="Technology stack — current deployment">
          <div className="grid grid-cols-2 gap-2">
            {STACK.map(s => (
              <div key={s.layer} className="flex items-center justify-between p-2.5 bg-gray-100 dark:bg-gray-800/40 rounded-lg border border-gray-200 dark:border-gray-800/60">
                <div>
                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{s.layer}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.tech}</div>
                </div>
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
