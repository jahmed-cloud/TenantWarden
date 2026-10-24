// ─── Security page ─────────────────────────────────────────────────────────────

import { MetricCard, Panel, SeverityBadge, StatusBadge, Button, DataTable, PageHeader } from '@/components/shared/ui'
import { ComplianceTrendChart } from '@/components/dashboard/Charts'
import { apiClient } from '@/services/api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useState } from 'react'

export function SecurityPage() {
  const navigate = useNavigate()
  const score = 72
  const items = [
    { id: '1', ref: '#INC-2341', title: 'Password spray attack',       severity: 'high',   entities: '12 users',      status: 'active',     assigned: 'SOC Team' },
    { id: '2', ref: '#INC-2340', title: 'Suspicious app consent',      severity: 'medium', entities: '1 app, 3 users', status: 'acknowledged', assigned: 'Alex K.' },
    { id: '3', ref: '#INC-2338', title: 'Phishing campaign detected',  severity: 'medium', entities: '28 emails',     status: 'resolved',   assigned: 'Alex K.' },
  ]
  const cats = [{ n: 'Identity', v: 81 }, { n: 'Devices', v: 68 }, { n: 'Apps', v: 74 }, { n: 'Data', v: 62 }]

  return (
    <div>
      <PageHeader title="Security — Defender XDR" subtitle="Secure Score, incidents, threat intelligence" action={<Button variant="primary" size="sm" onClick={() => navigate('/alerts')}>View incidents</Button>} />

      <div className="grid grid-cols-2 gap-4 mb-5">
        <Panel>
          <div className="flex items-center gap-6">
            <div className="relative w-24 h-24">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="8"/>
                <circle cx="50" cy="50" r="40" fill="none" stroke="#22c55e" strokeWidth="8" strokeDasharray={`${score * 2.513} 251.3`} strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="text-3xl font-semibold text-gray-900 dark:text-gray-100">{score}</div>
              <div className="text-xs text-gray-500 mt-0.5">Secure Score / 100</div>
              <div className="text-xs text-green-600 mt-1.5">↑ 4 pts this week</div>
              <div className="text-xs text-gray-400 mt-0.5">Industry avg: 54 · Top 25%</div>
            </div>
          </div>
        </Panel>
        <Panel title="Score by category">
          <div className="space-y-3 mt-1">
            {cats.map(c => (
              <div key={c.n}>
                <div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-400"><span>{c.n}</span><span>{c.v}%</span></div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full"><div className="h-full rounded-full bg-blue-500" style={{ width: `${c.v}%` }} /></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Active incidents">
        <DataTable
          columns={[
            { key: 'ref',      header: 'ID',       width: '100px', render: (r: any) => <code className="text-xs">{r.ref}</code> },
            { key: 'title',    header: 'Incident',  width: '40%',   render: (r: any) => <div className="font-medium text-gray-900 dark:text-gray-100">{r.title}</div> },
            { key: 'severity', header: 'Severity',  width: '90px',  render: (r: any) => <SeverityBadge severity={r.severity} /> },
            { key: 'entities', header: 'Entities',  width: '120px' },
            { key: 'status',   header: 'Status',    width: '110px', render: (r: any) => <StatusBadge status={r.status} /> },
            { key: 'assigned', header: 'Assigned',  width: '100px' },
          ] as any}
          data={items}
          keyField="id"
        />
      </Panel>
    </div>
  )
}

// ─── Tenants page ──────────────────────────────────────────────────────────────

import { useTenants } from '@/services/api/hooks'
import { useTenantWardenStore } from '@/store/tenantWardenStore'

export function TenantsPage() {
  const { data: tenants, isLoading } = useTenants()
  const queryClient = useQueryClient()
  const [showConnect, setShowConnect] = useState(false)
  const [tf, setTf] = useState({ displayName: '', domain: '', azureTenantId: '', clientId: '', clientSecret: '' })
  const [saving, setSaving] = useState(false)

  async function connectTenant() {
    if (!tf.displayName || !tf.azureTenantId || !tf.clientId || !tf.clientSecret) {
      toast.error('Fill in all fields'); return
    }
    setSaving(true)
    try {
      await apiClient.post('/v1/tenants', {
        ...tf,
        domain: tf.domain || tf.displayName.toLowerCase().replace(/\s+/g, '') + '.onmicrosoft.com',
        enabledModules: ['identity', 'defender', 'intune', 'compliance'],
      })
      toast.success('Tenant connected — collection starts within a minute')
      setShowConnect(false)
      setTf({ displayName: '', domain: '', azureTenantId: '', clientId: '', clientSecret: '' })
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      apiClient.post('/v1/collect').catch(() => {})
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to connect tenant (super_admin required)')
    } finally { setSaving(false) }
  }
  const { setActiveTenant }          = useTenantWardenStore()

  return (
    <div>
      <PageHeader title="Tenant management" subtitle="Multi-tenant Microsoft 365 environments" action={<Button variant="primary" size="sm" onClick={() => setShowConnect(true)}>Connect tenant</Button>} />
      {showConnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowConnect(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-[92vw] max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Connect Microsoft 365 tenant</h3>
            <p className="text-xs text-gray-500">From your Azure App Registration (see docs for required Graph permissions + admin consent).</p>
            {([
              ['displayName', 'Display name (e.g. Contoso Ltd)'],
              ['domain', 'Domain (contoso.com) — optional'],
              ['azureTenantId', 'Directory (tenant) ID'],
              ['clientId', 'Application (client) ID'],
              ['clientSecret', 'Client secret value'],
            ] as const).map(([k, ph]) => (
              <input key={k} type={k === 'clientSecret' ? 'password' : 'text'} placeholder={ph}
                value={tf[k]} onChange={(e) => setTf({ ...tf, [k]: e.target.value })}
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500" />
            ))}
            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" onClick={() => setShowConnect(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={connectTenant} disabled={saving}>{saving ? 'Connecting…' : 'Connect tenant'}</Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {isLoading && <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />}
        {tenants?.map(t => (
          <div key={t.id} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-semibold flex-shrink-0">
              {t.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.displayName}</div>
                <StatusBadge status={t.status} />
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {t.userCount.toLocaleString()} users · {t.domain} · {t.lastSyncAt ? `Synced ${new Date(t.lastSyncAt).toLocaleTimeString()}` : 'Not synced'}
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {t.enabledModules.map(m => (
                  <span key={m} className="px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">{m}</span>
                ))}
              </div>
            </div>
            <Button size="sm" onClick={() => setActiveTenant(t as any)}>Switch to</Button>
          </div>
        ))}

        <button className="w-full p-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-xs text-gray-400 hover:border-gray-400 dark:hover:border-gray-600 hover:text-gray-500 transition-colors flex items-center justify-center gap-2">
          <span className="text-lg leading-none">+</span> Connect new tenant
        </button>
      </div>
    </div>
  )
}

// ─── Analytics page ────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const countries = [
    { name: 'Brazil',  count: 423, pct: 88 },
    { name: 'Russia',  count: 312, pct: 65 },
    { name: 'Vietnam', count: 248, pct: 52 },
    { name: 'Nigeria', count: 91,  pct: 19 },
    { name: 'Ukraine', count: 78,  pct: 16 },
  ]
  const bars = [12,15,11,18,14,13,16,20,14,12,11,15,18,22,19,16,14,12,11,14,16,18,15,12,14,18,16,22,48,24]
  const max  = Math.max(...bars)

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Historical trends, anomaly detection, forecasting" action={
        <select className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 outline-none">
          <option>Last 30 days</option><option>Last 90 days</option><option>Last 180 days</option>
        </select>
      } />

      <div className="grid grid-cols-2 gap-4">
        <Panel title="Risk score trend — 30 days">
          <div className="flex items-end gap-0.5 h-28">
            {bars.map((v, i) => (
              <div key={i} className="flex-1 rounded-sm transition-opacity hover:opacity-80" style={{ height: `${(v / max) * 100}%`, background: i >= 28 ? '#ef4444' : i >= 25 ? '#f59e0b' : '#3b82f6', opacity: i >= 28 ? 1 : 0.55 }} />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-gray-400">
            <span>Jun 1</span><span>Jun 15</span><span>Jun 26</span>
          </div>
          <div className="mt-2 text-[11px] text-red-500">Anomaly detected Jun 24 — spike in risky sign-ins</div>
        </Panel>

        <Panel title="Top risky countries — 30 days">
          <div className="space-y-3 mt-1">
            {countries.map(c => (
              <div key={c.name}>
                <div className="flex justify-between text-xs mb-1 text-gray-700 dark:text-gray-300">
                  <span>{c.name}</span>
                  <span className="text-gray-400">{c.count} events</span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: c.pct > 70 ? '#ef4444' : c.pct > 40 ? '#f59e0b' : '#3b82f6' }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ─── Compliance page ───────────────────────────────────────────────────────────

export function CompliancePage() {
  const activeTenant = useTenantWardenStore((s) => s.activeTenant)
  const tenantId = activeTenant?.id

  const { data: frameworks = [], isLoading, refetch } = useQuery({
    queryKey: ['compliance-frameworks', tenantId],
    queryFn: async () => (await apiClient.get(`/v1/compliance/frameworks?tenantId=${tenantId}`)).data as any[],
    enabled: !!tenantId,
  })

  const { data: complianceHistory = [] } = useQuery({
    queryKey: ['compliance-history', tenantId],
    queryFn: async () => (await apiClient.get(`/v1/history/compliance?tenantId=${tenantId}&days=90`)).data as any[],
    enabled: !!tenantId,
  })

  const [openFw, setOpenFw] = useState<string | null>(null)
  const { data: controls = [], isLoading: controlsLoading } = useQuery({
    queryKey: ['compliance-controls', tenantId, openFw],
    queryFn: async () => (await apiClient.get(`/v1/compliance/controls?tenantId=${tenantId}&frameworkId=${openFw}`)).data as any[],
    enabled: !!tenantId && !!openFw,
  })

  const STATUS_STYLE: Record<string, { color: string; label: string }> = {
    pass:          { color: 'text-green-500',  label: '✓ Pass' },
    partial:       { color: 'text-amber-500',  label: '◐ Partial' },
    fail:          { color: 'text-red-500',    label: '✕ Fail' },
    not_applicable:{ color: 'text-gray-500',   label: '— N/A' },
    not_assessed:  { color: 'text-gray-400',   label: '· Not assessed' },
  }

  const overall = (frameworks as any[]).length
    ? Math.round((frameworks as any[]).reduce((a, f) => a + f.score, 0) / (frameworks as any[]).length)
    : null

  async function runAssessment() {
    try {
      await apiClient.post('/v1/collect')
      toast.success('Assessment triggered — collecting data & re-scoring. Refresh in ~1 min.')
      setTimeout(() => refetch(), 3000)
    } catch { toast.error('Trigger failed') }
  }

  return (
    <div>
      <PageHeader title="Compliance" subtitle="Framework scores computed from live security signals"
        action={<Button variant="primary" size="sm" onClick={runAssessment}>Run assessment</Button>} />

      {!tenantId && (
        <Panel><p className="text-sm text-gray-500 py-6 text-center">Select a tenant (top-left) to view its compliance posture.</p></Panel>
      )}

      {tenantId && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-5">
            <MetricCard label="Overall compliance" value={overall !== null ? `${overall}%` : '—'} color={overall && overall >= 80 ? 'green' : 'yellow'} />
            <MetricCard label="Frameworks tracked" value={String((frameworks as any[]).length)} />
            <MetricCard label="Fully compliant"   value={String((frameworks as any[]).filter(f => f.status === 'compliant').length)} color="green" />
            <MetricCard label="At risk"           value={String((frameworks as any[]).filter(f => f.status === 'at_risk').length)} color="red" />
          </div>
          {(complianceHistory as any[]).length > 1 && (
            <Panel title="Compliance score trend (90 days)" className="mb-4">
              <ComplianceTrendChart data={complianceHistory as any[]} />
            </Panel>
          )}
          <Panel title="Compliance frameworks">
            {isLoading && <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>}
            {!isLoading && (frameworks as any[]).length === 0 && (
              <p className="text-xs text-gray-500 py-6 text-center">
                No assessment yet. Click "Run assessment" — scores compute from your collected CA policies, devices, risky users, and Secure Score.
              </p>
            )}
            {(frameworks as any[]).length > 0 && (
              <div className="space-y-1.5">
                {/* header row */}
                <div className="flex items-center gap-4 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-gray-800">
                  <span className="flex-1">Framework</span>
                  <span className="w-16 text-right">Score</span>
                  <span className="w-28 text-center">Controls</span>
                  <span className="w-24 text-center">Status</span>
                  <span className="w-5" />
                </div>

                {(frameworks as any[]).map((f) => {
                  const isOpen = openFw === f.id
                  return (
                    <div key={f.id} className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setOpenFw(isOpen ? null : f.id)}
                        className="w-full flex items-center gap-4 px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors text-left"
                      >
                        <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">{f.name}</span>
                        <span className={`w-16 text-right text-sm font-semibold ${f.score >= 80 ? 'text-green-500' : f.score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{f.score}%</span>
                        <span className="w-28 text-center text-xs text-gray-500">{f.controlsPassing}</span>
                        <span className="w-24 flex justify-center"><StatusBadge status={f.status === 'compliant' ? 'online' : f.status === 'at_risk' ? 'offline' : 'warn'} /></span>
                        <span className={`w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 px-3 py-2">
                          {controlsLoading && <p className="text-xs text-gray-400 py-3 text-center">Loading controls…</p>}
                          {!controlsLoading && (controls as any[]).map((ctl, i) => {
                            const st = STATUS_STYLE[ctl.status] ?? STATUS_STYLE.not_assessed
                            return (
                              <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-200/60 dark:border-gray-800/60 last:border-0">
                                <span className={`text-xs font-medium w-24 flex-shrink-0 ${st.color}`}>{st.label}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-800 dark:text-gray-200">
                                    <span className="font-mono text-gray-500 mr-1.5">{ctl.ref}</span>{ctl.title}
                                    {ctl.category && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-500">{ctl.category}</span>}
                                  </div>
                                  {ctl.detail && <div className="text-[11px] text-gray-500 mt-0.5">{ctl.detail}</div>}
                                </div>
                              </div>
                            )
                          })}
                          {!controlsLoading && (controls as any[]).length === 0 && (
                            <p className="text-xs text-gray-500 py-3 text-center">No controls found for this framework.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
          <p className="text-[11px] text-gray-500 mt-3">
            Scores are computed automatically from real signals (MFA/Conditional Access policies, device encryption &amp; inventory, unresolved risky users, Secure Score). Partial controls count as half credit.
          </p>
        </>
      )}
    </div>
  )
}

// ─── Reports page ──────────────────────────────────────────────────────────────

export function ReportsPage() {
  const reports = [
    { id: '1', name: 'Executive Summary',  icon: '📊', desc: 'Weekly security posture overview for leadership. PDF + PowerPoint.', last: 'Jun 24', schedule: 'Weekly' },
    { id: '2', name: 'Compliance Report',  icon: '🛡️', desc: 'Full audit trail with framework mappings and evidence logs.', last: 'Jun 21', schedule: 'Monthly' },
    { id: '3', name: 'Identity Risk Report',icon: '👤', desc: 'Risky users, sign-in anomalies, MFA gaps, CA policy review.', last: 'Today', schedule: 'Daily' },
    { id: '4', name: 'Device Health',      icon: '💻', desc: 'Compliance state, OS patch levels, BitLocker coverage.', last: 'Jun 23', schedule: 'Weekly' },
    { id: '5', name: 'Agent Fleet Report', icon: '⚙️', desc: 'Agent uptime, metric summary, version coverage.', last: 'Jun 25', schedule: 'Daily' },
    { id: '6', name: 'Alert Digest',       icon: '🔔', desc: 'Summary of all alerts, resolution times, SLA metrics.', last: 'Today', schedule: 'Daily' },
  ]
  return (
    <div>
      <PageHeader title="Reports" subtitle="Scheduled and on-demand security reports" action={<Button variant="primary" size="sm" onClick={async () => {
        try {
          const [alerts, tenants] = await Promise.all([
            apiClient.get('/v1/alerts?pageSize=100').then(r => r.data).catch(() => null),
            apiClient.get('/v1/tenants').then(r => r.data).catch(() => null),
          ])
          const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), tenants, alerts }, null, 2)], { type: 'application/json' })
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tenantwarden-report-${Date.now()}.json` })
          a.click(); URL.revokeObjectURL(a.href)
          toast.success('Report downloaded')
        } catch { toast.error('Report generation failed') }
      }}>Generate report</Button>} />
      <div className="grid grid-cols-3 gap-4">
        {reports.map(r => (
          <div key={r.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-gray-300 dark:hover:border-gray-700 cursor-pointer transition-colors">
            <div className="text-2xl mb-2">{r.icon}</div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{r.name}</div>
            <div className="text-xs text-gray-400 leading-relaxed mb-3">{r.desc}</div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-blue-600 dark:text-blue-400">Last: {r.last}</span>
              <span className="text-gray-400">{r.schedule}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Admin page ────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, string> = { teams: '💬', slack: '⚡', email: '📧', pagerduty: '🚨', webhook: '🔗' }

export function AdminPage() {
  const queryClient = useQueryClient()
  const activeTenant = useTenantWardenStore((s) => s.activeTenant)
  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => (await apiClient.get('/v1/channels')).data as any[],
  })
  const [showAdd, setShowAdd]   = useState(false)
  const [cf, setCf] = useState({ name: '', type: 'email', target: '', minSeverity: 'medium' })

  async function addChannel() {
    if (!cf.name || !cf.target) { toast.error('Fill in all fields'); return }
    if (!activeTenant?.id) { toast.error('Select a tenant first (top-left dropdown)'); return }
    const config = cf.type === 'email'
      ? { recipients: cf.target.split(',').map(s => s.trim()).filter(Boolean) }
      : cf.type === 'pagerduty' ? { routingKey: cf.target } : { webhookUrl: cf.target }
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
    try { await apiClient.delete(`/v1/channels/${id}`); queryClient.invalidateQueries({ queryKey: ['channels'] }) }
    catch { toast.error('Delete failed') }
  }
  const roles = [
    { role: 'Super Admin',     users: 2,  scope: 'All tenants' },
    { role: 'Security Admin',  users: 5,  scope: 'Org-wide' },
    { role: 'SOC Analyst',     users: 8,  scope: 'Read + alerts' },
    { role: 'Global Reader',   users: 12, scope: 'Read-only' },
    { role: 'Auditor',         users: 3,  scope: 'Compliance' },
  ]
  const stack = [
    ['Frontend', 'React + TypeScript + Vite'], ['Backend API', 'ASP.NET Core 9'],
    ['Agents', 'Go (cross-platform)'],          ['Database', 'PostgreSQL + ClickHouse'],
    ['Cache / Queue', 'Redis + Kafka'],          ['Storage', 'MinIO'],
    ['Auth', 'MSAL + Entra ID'],                 ['Real-time', 'SignalR / WebSockets'],
    ['Observability', 'Prometheus + Grafana'],   ['Proxy', 'Nginx / Traefik'],
  ]

  return (
    <div>
      <PageHeader title="Administration" subtitle="RBAC, notifications, API keys, audit log" />
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Panel title="Notification channels" action={<Button size="sm" onClick={() => setShowAdd(true)}>Add channel</Button>}>
          {showAdd && (
            <div className="mb-4 p-3 border border-blue-200 dark:border-blue-900 rounded-lg space-y-2 bg-blue-50/40 dark:bg-blue-950/20">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Channel name" value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-800 outline-none" />
                <select value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-800 outline-none">
                  <option value="email">Email (SMTP)</option><option value="teams">Microsoft Teams</option>
                  <option value="slack">Slack</option><option value="webhook">Webhook</option><option value="pagerduty">PagerDuty</option>
                </select>
              </div>
              <input placeholder={cf.type === 'email' ? 'Recipients (comma-separated)' : cf.type === 'pagerduty' ? 'Routing key' : 'Webhook URL'}
                value={cf.target} onChange={(e) => setCf({ ...cf, target: e.target.value })}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-800 outline-none" />
              <div className="flex items-center justify-between">
                <select value={cf.minSeverity} onChange={(e) => setCf({ ...cf, minSeverity: e.target.value })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-800 outline-none">
                  <option value="critical">Critical only</option><option value="high">High +</option>
                  <option value="medium">Medium +</option><option value="low">Low +</option><option value="info">All</option>
                </select>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
                  <Button size="sm" variant="primary" onClick={addChannel}>Save</Button>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(channels as any[]).map((ch) => (
            <div key={ch.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-lg">{CHANNEL_ICONS[ch.type] ?? '🔔'}</span>
                <div>
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{ch.name}</div>
                  <div className="text-[11px] text-gray-400">{ch.type} · min severity: {ch.minSeverity}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => testChannel(ch.id)}>Test</Button>
                <Button size="sm" onClick={() => deleteChannel(ch.id)}>✕</Button>
              </div>
            </div>
          ))}
          {channels.length === 0 && <p className="text-xs text-gray-400 py-3">No channels yet — add one to receive alert notifications.</p>}
          </div>
        </Panel>

        <Panel title="Platform roles">
          <div className="space-y-1.5">
            {roles.map(r => (
              <div key={r.role} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{r.role}</span>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{r.users} users</span>
                  <span>{r.scope}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Technology stack — current deployment">
        <div className="grid grid-cols-2 gap-2">
          {stack.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex-1"><div className="text-xs font-medium text-gray-700 dark:text-gray-300">{k}</div><div className="text-[10px] text-gray-400 mt-0.5">{v}</div></div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

// ─── Login page ────────────────────────────────────────────────────────────────

import { msalInstance } from '@/services/auth/msalConfig'
import { graphScopes } from '@/services/auth/msalConfig'
import { Shield } from 'lucide-react'
import { authClient } from '@/services/api/client'

interface LoginResponse {
  accessToken: string
  accessTokenExpiry: string
  tokenType: string
  user: any
  requiresMfa?: boolean
}

export function LoginPage() {
  const setAccessToken = useTenantWardenStore((s) => s.setAccessToken)
  const setCurrentUser = useTenantWardenStore((s) => s.setCurrentUser)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [totp,     setTotp]     = useState('')
  const [needsMfa, setNeedsMfa] = useState(false)
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  async function handleLocalLogin() {
    if (!email || !password) { setError('Enter email and password'); return }
    setBusy(true); setError('')
    try {
      const { data } = await authClient.post<LoginResponse>('/auth/login', {
        email, password, totpCode: totp || undefined,
      })
      if (data.requiresMfa) { setNeedsMfa(true); setBusy(false); return }
      setCurrentUser(data.user ?? null)
      setAccessToken(data.accessToken)
      useTenantWardenStore.getState().setMustChangePassword(!!data.user?.mustChangePassword)   // flips App to AuthenticatedApp
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Login failed — check credentials')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-[92vw] max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">TenantWarden</h1>
          <p className="text-sm text-gray-500 mt-1">Security monitoring for Microsoft 365</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          <Button
            variant="primary"
            className="w-full justify-center text-sm py-2.5"
            onClick={() => msalInstance
              ? msalInstance.loginRedirect({ scopes: graphScopes }).catch(() => setError('Microsoft sign-in failed — configure AZURE_* in .env'))
              : setError('Microsoft SSO needs https or localhost — use email login below')}
          >
            Sign in with Microsoft
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-gray-800" /></div>
            <div className="relative flex justify-center text-xs text-gray-400 bg-white dark:bg-gray-900 px-2">or</div>
          </div>

          <div className="space-y-3">
            <input type="email" placeholder="Email address" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLocalLogin()}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 placeholder:text-gray-400" />
            <input type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLocalLogin()}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 placeholder:text-gray-400" />
            {needsMfa && (
              <input type="text" placeholder="6-digit MFA code" value={totp} maxLength={6}
                onChange={(e) => setTotp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLocalLogin()}
                className="w-full text-sm border border-blue-300 rounded-md px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 placeholder:text-gray-400 tracking-widest text-center" />
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button variant="secondary" className="w-full justify-center text-sm py-2.5"
              onClick={handleLocalLogin} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">Secured by TenantWarden · All rights reserved</p>
      </div>
    </div>
  )
}
