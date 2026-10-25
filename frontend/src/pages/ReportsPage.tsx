import { useState } from 'react'
import { Bell, Cpu, FileJson, FileText, Fingerprint, Laptop2, ScrollText, type LucideIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage, get } from '@/services/api/client'
import {
  useTenantId, useTenants, type Agent, type Alert, type AuditEntry, type Device, type Framework, type Overview, type Paged,
  type RiskyUser, type SecuritySummary,
} from '@/services/api/hooks'
import { useCan } from '@/store/tenantWardenStore'
import { Button, Card, PageHeader } from '@/components/ui'
import { downloadCsv, downloadJson, fmtDateTime, stamp } from '@/lib/format'

/** Every page of a paged endpoint. */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= 50; page++) {
    const res = await get<Paged<T>>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=200`)
    out.push(...res.items)
    if (page >= res.totalPages) break
  }
  return out
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function executiveHtml(tenant: string, o: Overview, sec: SecuritySummary, frameworks: Framework[], alerts: Alert[]) {
  const top = alerts.filter((a) => a.status !== 'resolved').slice(0, 10)
  const stat = (label: string, value: unknown, note = '') => `<div class="stat"><div class="l">${label}</div><div class="v">${esc(value)}</div><div class="n">${esc(note)}</div></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>TenantWarden — ${esc(tenant)} — ${stamp()}</title>
<style>body{font:14px/1.5 Roboto,"Segoe UI",system-ui,sans-serif;color:#1a1c22;margin:40px;max-width:900px}h1{font-weight:400;margin:0}h2{font-weight:500;font-size:16px;margin:28px 0 8px}
.sub{color:#555;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.stat{border:1px solid #dde;border-radius:12px;padding:12px}
.l{font-size:12px;color:#555}.v{font-size:26px}.n{font-size:12px;color:#777}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
.sev{font-weight:500;text-transform:capitalize}@media print{body{margin:16mm}}</style></head><body>
<h1>Security summary — ${esc(tenant)}</h1><div class="sub">Generated ${esc(fmtDateTime(new Date().toISOString()))} by TenantWarden</div>
<div class="grid">
${stat('Open alerts', o.alerts.critical + o.alerts.high + o.alerts.medium + o.alerts.low, `${o.alerts.critical} critical, ${o.alerts.high} high`)}
${stat('Risky users', o.identity.riskyUsers, `${o.identity.riskyHigh} high risk`)}
${stat('Secure Score', sec.secureScore ? `${sec.secureScore.percentage}%` : 'n/a')}
${stat('MFA registered', o.identity.mfaPercent === null ? 'n/a' : `${o.identity.mfaPercent}%`)}
${stat('Non-compliant devices', o.devices.nonCompliant, `of ${o.devices.total}`)}
${stat('Open Defender incidents', sec.incidents.open, `${sec.incidents.high} high`)}
</div>
<h2>Compliance frameworks</h2><table><tr><th>Framework</th><th>Score</th><th>Controls passing</th><th>Status</th></tr>
${frameworks.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.score}%</td><td>${esc(f.controlsPassing)}</td><td>${esc(f.status)}</td></tr>`).join('') || '<tr><td colspan="4">Not assessed yet</td></tr>'}</table>
<h2>Top open alerts</h2><table><tr><th>Severity</th><th>Alert</th><th>Source</th><th>Raised</th></tr>
${top.map((a) => `<tr><td class="sev">${esc(a.severity)}</td><td>${esc(a.title)}</td><td>${esc(a.source)}</td><td>${esc(fmtDateTime(a.createdAt))}</td></tr>`).join('') || '<tr><td colspan="4">No open alerts</td></tr>'}</table>
<script>window.onload=()=>window.print()</script></body></html>`
}

interface Report { id: string; title: string; body: string; icon: LucideIcon; format: string; run: () => Promise<void>; requires?: boolean }

export function ReportsPage() {
  const tenantId = useTenantId()
  const tenant = useTenants().data?.find((t) => t.id === tenantId)
  const canAudit = useCan('viewAudit')
  const [busy, setBusy] = useState<string | null>(null)
  const slug = (tenant?.displayName ?? 'tenant').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const q = `tenantId=${tenantId}`

  const reports: Report[] = [
    { id: 'exec', title: 'Executive summary', icon: FileText, format: 'Printable page / PDF',
      body: 'Posture at a glance: alerts, identity risk, Secure Score, MFA, devices, compliance and the top open alerts. Use your browser’s Save as PDF.',
      run: async () => {
        const win = window.open('', '_blank')
        if (!win) throw new Error('Allow pop-ups for this site to open the report')
        const [o, sec, fw, alerts] = await Promise.all([
          get<Overview>(`/v1/overview/summary?${q}`), get<SecuritySummary>(`/v1/security/summary?${q}`),
          get<Framework[]>(`/v1/compliance/frameworks?${q}`), get<Paged<Alert>>(`/v1/alerts?${q}&pageSize=50`),
        ])
        win.document.write(executiveHtml(tenant?.displayName ?? 'Tenant', o, sec, fw, alerts.items))
        win.document.close()
      } },
    { id: 'alerts', title: 'Alerts', icon: Bell, format: 'CSV', body: 'Every alert with severity, status, source, affected users and devices, and resolution.',
      run: async () => downloadCsv((await all<Alert>(`/v1/alerts?${q}`)).map((a) => ({
        raised: a.createdAt, severity: a.severity, status: a.status, source: a.source, title: a.title, description: a.description,
        affected_users: a.affectedUsers, affected_devices: a.affectedDevices, assigned_to: a.assignedTo, acknowledged: a.acknowledgedAt,
        resolved: a.resolvedAt, resolution: a.resolution,
      })), `alerts-${slug}-${stamp()}.csv`) },
    { id: 'risky', title: 'Risky users', icon: Fingerprint, format: 'CSV', body: 'Users Entra ID Identity Protection flags, with risk level, reason and last location.',
      run: async () => downloadCsv((await all<RiskyUser>(`/v1/identity/risky-users?${q}`)).map((u) => ({
        user: u.userPrincipalName, name: u.displayName, risk: u.riskLevel, reason: u.riskDetail, country: u.countryCode, ip: u.ipAddress, updated: u.riskLastUpdatedAt,
      })), `risky-users-${slug}-${stamp()}.csv`) },
    { id: 'devices', title: 'Device compliance', icon: Laptop2, format: 'CSV', body: 'Intune devices with OS, compliance, encryption, owner and last check-in.',
      run: async () => downloadCsv((await all<Device>(`/v1/devices?${q}`)).map((d) => ({
        device: d.deviceName, user: d.userPrincipalName, os: d.operatingSystem, version: d.osVersion, compliance: d.complianceState,
        encryption: d.encryptionState, ownership: d.ownerType, last_check_in: d.lastSyncDateTime,
      })), `devices-${slug}-${stamp()}.csv`) },
    { id: 'agents', title: 'Agent fleet', icon: Cpu, format: 'CSV', body: 'Hosts running the agent: platform, OS, IP, status, resource use and agent version.',
      run: async () => downloadCsv((await get<Agent[]>(`/v1/agents?${q}`)).map((a) => ({
        host: a.hostname, status: a.status, platform: a.platform, os: a.osName, os_version: a.osVersion, ip: a.ipAddress, version: a.version,
        cpu: a.cpuPercent, memory: a.memoryPercent, disk: a.diskPercent, last_report: a.lastHeartbeatAt,
      })), `agents-${slug}-${stamp()}.csv`) },
    { id: 'audit', title: 'Audit log', icon: ScrollText, format: 'CSV', requires: canAudit, body: 'Sign-ins and every change made in the portal or API: who, what, when, from where.',
      run: async () => downloadCsv((await get<AuditEntry[]>(`/v1/audit?limit=500`)).map((e) => ({
        time: e.createdAt, user: e.userEmail, action: e.action, resource: e.resource, resource_id: e.resourceId, ip: e.ipAddress, success: e.success,
      })), `audit-log-${stamp()}.csv`) },
    { id: 'json', title: 'Full snapshot', icon: FileJson, format: 'JSON', body: 'Overview, security, compliance, alerts, risky users, devices and agents in one file, for archiving or your own tooling.',
      run: async () => {
        const [overview, security, frameworks, alerts, riskyUsers, devices, agents] = await Promise.all([
          get(`/v1/overview/summary?${q}`), get(`/v1/security/summary?${q}`), get(`/v1/compliance/frameworks?${q}`),
          all(`/v1/alerts?${q}`), all(`/v1/identity/risky-users?${q}`), all(`/v1/devices?${q}`), get(`/v1/agents?${q}`),
        ])
        downloadJson({ generatedAt: new Date().toISOString(), tenant, overview, security, frameworks, alerts, riskyUsers, devices, agents }, `tenantwarden-${slug}-${stamp()}.json`)
      } },
  ]

  async function run(r: Report) {
    setBusy(r.id)
    try { await r.run(); toast.success(`${r.title} ready`) }
    catch (err) { toast.error(errorMessage(err, `${r.title} failed`)) }
    finally { setBusy(null) }
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle={<>Exports for <b className="font-medium text-on-surface">{tenant?.displayName ?? 'the selected tenant'}</b>, built from live data when you click</>} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {reports.filter((r) => r.requires !== false).map((r) => (
          <Card key={r.id}>
            <div className="flex items-start gap-4">
              <span className="w-11 h-11 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center shrink-0"><r.icon size={20} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-medium text-on-surface">{r.title}</h2>
                  <span className="text-[11px] text-on-surface-variant">{r.format}</span>
                </div>
                <p className="text-sm text-on-surface-variant mt-1">{r.body}</p>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button size="sm" variant="tonal" loading={busy === r.id} disabled={!tenantId} onClick={() => run(r)}>
                {r.format.startsWith('Printable') ? 'Open' : 'Download'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
