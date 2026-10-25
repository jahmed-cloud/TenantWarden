import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleSlash, Cpu, HardDrive, KeyRound, Monitor, Plus, Server, Trash2, XCircle } from 'lucide-react'
import {
  useAgentEvents, useAgentInventory, useAgentMetrics, useAgents, useAgentStats, useCreateEnrollmentToken, useDeleteAgent,
  useEnrollmentTokens, useRevokeEnrollmentToken, useTenantId, type Agent, type AgentEvent, type AgentInventory, type EnrollmentToken,
} from '@/services/api/hooks'
import { useCan } from '@/store/tenantWardenStore'
import { TimeSeriesChart } from '@/components/charts'
import { ProfileEditor } from '@/components/ProfileEditor'
import {
  Banner, Button, Card, CodeBlock, ConfirmDialog, DataTable, Dialog, EmptyState, IconButton, KeyValues, Meter, PageHeader,
  Pill, SearchField, Segmented, SelectField, Sheet, StatCard, StatusPill, Tabs, cx, type Column,
} from '@/components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtNumber, timeAgo } from '@/lib/format'

type Platform = 'windows' | 'linux' | 'macos'

const LEVEL_TONE: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = { critical: 'error', error: 'error', warning: 'warning', info: 'info' }

export function AgentsPage() {
  const { data: agents, isLoading } = useAgents()
  const { data: stats } = useAgentStats()
  const { data: events } = useAgentEvents(undefined, 30)
  const canManage = useCan('manageAgents')
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Agent | null>(null)
  const [search, setSearch] = useState('')
  const [params, setParams] = useSearchParams()
  const view = params.get('tab') === 'profile' ? 'profile' : 'fleet'

  const rows = useMemo(() => (agents ?? []).filter((a) =>
    !search || [a.hostname, a.ipAddress, a.osName].some((v) => v?.toLowerCase().includes(search.toLowerCase()))), [agents, search])

  const columns: Column<Agent>[] = [
    { key: 'host', header: 'Host', render: (a) => (
      <div className="flex items-center gap-3 min-w-0">
        <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', a.status === 'online' ? 'bg-success' : 'bg-outline')} title={a.status} />
        <div className="min-w-0">
          <div className="font-medium truncate">{a.hostname}</div>
          <div className="text-xs text-on-surface-variant truncate">{a.osName ?? a.platform} {a.osVersion?.split(' ')[0]}</div>
        </div>
      </div>
    ) },
    { key: 'cpu', header: 'CPU', render: (a) => <Meter value={a.status === 'online' ? a.cpuPercent : null} /> },
    { key: 'mem', header: 'Memory', render: (a) => <Meter value={a.status === 'online' ? a.memoryPercent : null} /> },
    { key: 'disk', header: 'Fullest disk', render: (a) => <Meter value={a.diskPercent} warnAt={80} badAt={92} /> },
    { key: 'ip', header: 'IP address', render: (a) => <span className="text-xs font-mono">{a.ipAddress ?? '—'}</span> },
    { key: 'version', header: 'Agent', render: (a) => <span className="text-xs text-on-surface-variant">v{a.version}</span> },
    { key: 'seen', header: 'Last report', align: 'right', render: (a) => <span className="text-xs text-on-surface-variant" title={fmtDateTime(a.lastHeartbeatAt)}>{timeAgo(a.lastHeartbeatAt)}</span> },
  ]

  return (
    <div>
      <PageHeader title="Agents" subtitle="Endpoint agents on your Windows, Linux and macOS hosts"
        actions={canManage && <Button icon={Plus} onClick={() => setAdding(true)}>Add agent</Button>} />

      <Tabs value={view} onChange={(v) => setParams(v === 'profile' ? { tab: 'profile' } : {})}
        tabs={[{ id: 'fleet', label: 'Fleet', count: stats?.total }, { id: 'profile', label: 'Monitoring profile' }]} />

      {view === 'profile' ? <ProfileEditor /> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Agents" icon={Server} value={fmtNumber(stats?.total)} loading={!stats}
          detail={stats && <>{stats.windows} Windows · {stats.linux} Linux · {stats.macOs} macOS{stats.docker ? ` · ${stats.docker} Docker` : ''}</>} />
        <StatCard label="Online" icon={CheckCircle2} tone="success" value={fmtNumber(stats?.online)} loading={!stats} detail="heartbeat in the last 2 minutes" />
        <StatCard label="Offline" icon={CircleSlash} tone={stats?.offline ? 'warning' : 'neutral'} value={fmtNumber(stats?.offline)} loading={!stats} />
        <StatCard label="Events (latest 30)" icon={AlertTriangle} tone={events?.some((e) => e.level === 'critical') ? 'error' : 'primary'} loading={!events}
          value={fmtNumber(events?.length)} detail={events && `${events.filter((e) => e.level === 'critical').length} critical`} />
      </div>

      <Card flush className="mb-4" title="Fleet" action={<SearchField value={search} onChange={setSearch} placeholder="Search hosts" />}>
        <DataTable columns={columns} rows={rows} loading={isLoading} rowKey={(a) => a.id} onRowClick={setSelected}
          empty={<EmptyState icon={Cpu} title="No agents yet" body="Install the agent on a server or workstation to stream metrics, security events and an inventory here."
            action={canManage && <Button icon={Plus} onClick={() => setAdding(true)}>Add your first agent</Button>} />} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card flush className="xl:col-span-2" title="Recent events" subtitle="Warnings and errors from agents; critical events also raise an alert">
          <EventList events={events} />
        </Card>
        {canManage && <TokensCard />}
      </div>
      </>}

      {adding && <AddAgentDialog onClose={() => setAdding(false)} />}
      {selected && <AgentSheet agent={agents?.find((a) => a.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function EventList({ events, showHost = true }: { events?: AgentEvent[]; showHost?: boolean }) {
  return (
    <DataTable rows={events} rowKey={(e) => e.id}
      empty={<EmptyState icon={CheckCircle2} title="No events" body="Agents report warnings and errors from the system journal or Windows Event Log." />}
      columns={[
        { key: 'level', header: 'Level', render: (e) => <Pill tone={LEVEL_TONE[e.level] ?? 'neutral'}>{e.level}</Pill> },
        ...(showHost ? [{ key: 'host', header: 'Host', render: (e: AgentEvent) => <span className="text-xs">{e.hostname}</span> }] : []),
        { key: 'msg', header: 'Event', render: (e) => (
          <div className="min-w-0 max-w-[520px]">
            <div className="text-xs font-medium text-on-surface-variant">{e.source}</div>
            <div className="text-xs line-clamp-2" title={e.message}>{e.message}</div>
          </div>
        ) },
        { key: 'at', header: 'When', align: 'right', render: (e) => <span className="text-xs text-on-surface-variant whitespace-nowrap" title={fmtDateTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span> },
      ]} />
  )
}

// ── Enrollment ───────────────────────────────────────────────────────────────

function gatewayUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/agent`
}

function installCommands(platform: Platform, token: string, arch: 'amd64' | 'arm64'): { label: string; code: string }[] {
  const origin = location.origin
  const tls = location.protocol === 'https:'
  const ca = tls ? ' --ca-file ca.crt' : ''
  if (platform === 'windows') return [
    { label: 'PowerShell (Run as administrator)', code: [
      `Invoke-WebRequest -Uri "${origin}/downloads/tenantwarden-agent.exe" -OutFile tenantwarden-agent.exe`,
      ...(tls ? [`Invoke-WebRequest -Uri "${origin}/downloads/ca.crt" -OutFile ca.crt`] : []),
      `.\\tenantwarden-agent.exe register --gateway-url "${gatewayUrl()}" --agent-token "${token}"${ca} --install`,
    ].join('\n') },
  ]
  const file = platform === 'linux' ? `tenantwarden-agent-linux-${arch}` : `tenantwarden-agent-darwin-${arch}`
  return [
    { label: platform === 'linux' ? 'Shell (installs a systemd service)' : 'Terminal', code: [
      `curl -fsSLo tenantwarden-agent ${origin}/downloads/${file} && chmod +x tenantwarden-agent`,
      ...(tls ? [`curl -fsSLO ${origin}/downloads/ca.crt`] : []),
      platform === 'linux'
        ? `sudo ./tenantwarden-agent register --gateway-url "${gatewayUrl()}" --agent-token "${token}"${ca} --install`
        : `sudo ./tenantwarden-agent register --gateway-url "${gatewayUrl()}" --agent-token "${token}"${ca}\nsudo ./tenantwarden-agent start`,
    ].join('\n') },
  ]
}

function AddAgentDialog({ onClose }: { onClose: () => void }) {
  const tenantId = useTenantId()
  const create = useCreateEnrollmentToken()
  const [platform, setPlatform] = useState<Platform>('windows')
  const [arch, setArch] = useState<'amd64' | 'arm64'>('amd64')
  const [days, setDays] = useState('30')
  const [token, setToken] = useState<EnrollmentToken | null>(null)

  return (
    <Dialog open onClose={onClose} wide title="Add an agent"
      actions={token ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button icon={KeyRound} loading={create.isPending} onClick={() => create.mutate({ tenantId, expiresInDays: Number(days) }, { onSuccess: setToken })}>Create enrollment token</Button>
      </>}>
      <div className="space-y-4 pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={platform} onChange={setPlatform} options={[{ value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }, { value: 'macos', label: 'macOS' }]} />
          {platform !== 'windows' && <Segmented value={arch} onChange={setArch} options={[{ value: 'amd64', label: platform === 'macos' ? 'Intel' : 'x86-64' }, { value: 'arm64', label: platform === 'macos' ? 'Apple silicon' : 'ARM64' }]} />}
        </div>
        {!token ? (
          <>
            <p>An enrollment token lets hosts join <b className="text-on-surface">this tenant</b>. One token can enroll many hosts; revoke it here when you are done.</p>
            <SelectField label="Token valid for" value={days} onChange={setDays}
              options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
          </>
        ) : (
          <>
            <Banner tone="success" icon={CheckCircle2}>Token created, valid until {fmtDate(token.expiresAt)}. It is shown only now — copy the command.</Banner>
            {installCommands(platform, token.token, arch).map((c) => <CodeBlock key={c.label} label={c.label} code={c.code} />)}
            <p className="text-xs">
              <code>register</code> checks the token and the connection before it saves anything, then <code>--install</code> sets the agent up as a
              {platform === 'windows' ? ' Windows service (TenantWardenAgent)' : platform === 'linux' ? ' systemd service' : ' foreground process'}.
              The host appears in the fleet within a minute. Binaries and SHA256SUMS: <a className="text-primary underline" href="/downloads/" target="_blank" rel="noreferrer">/downloads/</a>
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}

function TokensCard() {
  const { data: tokens } = useEnrollmentTokens(true)
  const revoke = useRevokeEnrollmentToken()
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <Card flush title="Enrollment tokens" subtitle="Tokens that can still enroll hosts in this tenant">
      <DataTable rows={tokens} rowKey={(t) => t.tokenId}
        empty={<EmptyState icon={KeyRound} title="No active tokens" body="Add agent creates one." />}
        columns={[
          { key: 'id', header: 'Token', render: (t) => (
            <div className="min-w-0">
              <div className="font-mono text-xs">{t.tokenId.slice(0, 8)}…</div>
              <div className="text-[11px] text-on-surface-variant truncate">by {t.issuedBy}</div>
            </div>
          ) },
          { key: 'exp', header: 'Expires', render: (t) => t.revoked ? <StatusPill status="disabled" label="revoked" /> : <span className="text-xs">{fmtDate(t.expiresAt)}</span> },
          { key: 'x', header: '', align: 'right', render: (t) => !t.revoked && <IconButton icon={XCircle} label="Revoke token" onClick={() => setConfirm(t.tokenId)} /> },
        ]} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger confirmLabel="Revoke" loading={revoke.isPending}
        title="Revoke enrollment token?" body="Agents that use this token are refused the next time they connect. Hosts using other tokens are not affected."
        onConfirm={() => confirm && revoke.mutate(confirm, { onSuccess: () => setConfirm(null) })} />
    </Card>
  )
}

// ── Agent details ────────────────────────────────────────────────────────────

function AgentSheet({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'security' | 'workloads' | 'software' | 'events'>('overview')
  const [hours, setHours] = useState(6)
  const { data: metrics } = useAgentMetrics(agent.id, hours)
  const { data: inventory } = useAgentInventory(agent.id)
  const { data: events } = useAgentEvents(agent.agentId, 100)
  const canManage = useCan('manageAgents')
  const remove = useDeleteAgent()
  const [deleting, setDeleting] = useState(false)
  const software = (inventory?.software as { name: string; version: string; publisher: string }[] | undefined) ?? []
  const workloads = (inventory?.workloads as SheetWorkload[] | undefined) ?? []
  const certificates = (inventory?.certificates as SheetCertificate[] | undefined) ?? []
  const connections = (() => { try { return agent.connections ? JSON.parse(agent.connections) as Record<string, number> : null } catch { return null } })()

  return (
    <Sheet open onClose={onClose} title={agent.hostname}
      subtitle={<span className="flex flex-wrap items-center gap-2"><StatusPill status={agent.status} /><span>{agent.osName} {agent.osVersion}</span></span>}
      actions={canManage && <Button variant="text" icon={Trash2} onClick={() => setDeleting(true)}>Remove agent</Button>}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'security', label: 'Security' },
        { id: 'workloads', label: 'Roles', count: workloads.length || undefined },
        { id: 'software', label: 'Software', count: software.length || undefined }, { id: 'events', label: 'Events', count: events?.length },
      ]} />

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {([['CPU', agent.cpuPercent, Cpu], ['Memory', agent.memoryPercent, Monitor], ['Fullest disk', agent.diskPercent, HardDrive]] as const).map(([label, v, Icon]) => (
              <div key={label} className="rounded-2xl bg-surface-container-lowest shadow-e1 p-3">
                <div className="flex items-center gap-2 text-xs text-on-surface-variant mb-2"><Icon size={14} />{label}</div>
                <div className="text-2xl text-on-surface mb-2">{v === null ? '—' : `${Math.round(v)}%`}</div>
                <Meter value={v} />
              </div>
            ))}
          </div>
          <Card title="Resource history" action={<Segmented value={hours} onChange={setHours} options={[{ value: 1, label: '1 h' }, { value: 6, label: '6 h' }, { value: 24, label: '24 h' }, { value: 168, label: '7 d' }]} />}>
            <TimeSeriesChart percent height={240} empty="No metrics in this range yet"
              series={[
                { name: 'CPU (avg)', area: true, points: (metrics ?? []).map((p) => [p.t, p.cpu]) },
                { name: 'CPU (peak)', dashed: true, points: (metrics ?? []).map((p) => [p.t, p.cpuMax]) },
                { name: 'Memory', points: (metrics ?? []).map((p) => [p.t, p.mem]) },
                { name: 'Disk', points: (metrics ?? []).map((p) => [p.t, p.disk]) },
              ]} />
          </Card>
          <Card title="Network throughput" subtitle="All interfaces except loopback and container bridges">
            <TimeSeriesChart unit=" Mbit/s" height={200} empty="No network samples in this range"
              series={[
                { name: 'In', area: true, points: (metrics ?? []).map((p) => [p.t, p.rxMbps]) },
                { name: 'Out', area: true, points: (metrics ?? []).map((p) => [p.t, p.txMbps]) },
              ]} />
            {connections && <p className="text-xs text-on-surface-variant mt-2">
              {connections.established} established · {connections.listen} listening · {connections.time_wait} time-wait · {connections.close_wait} close-wait TCP connections
            </p>}
          </Card>
          <Card title="Host">
            <KeyValues items={[
              ['Platform', `${agent.platform} · ${agent.architecture ?? ''}`],
              ['IP address', agent.ipAddress],
              ['Uptime', fmtDuration(agent.uptimeSeconds)],
              ['Agent version', `v${agent.version}`],
              ['Agent ID', <span className="font-mono text-xs">{agent.agentId}</span>],
              ['First seen', fmtDateTime(agent.createdAt)],
              ['Last report', fmtDateTime(agent.lastHeartbeatAt)],
              ['Inventory', inventory?.collected_at ? fmtDateTime(String(inventory.collected_at)) : 'not received yet'],
            ]} />
          </Card>
        </>
      )}

      {tab === 'workloads' && <WorkloadList workloads={workloads} certificates={certificates} />}

      {tab === 'security' && (inventory && Object.keys(inventory).length ? <SecurityInventory inv={inventory} /> :
        <EmptyState title="No inventory yet" body="The agent sends one at start-up and every 6 hours." />)}

      {tab === 'software' && <SoftwareList software={software} inventory={inventory} />}

      {tab === 'events' && <Card flush><EventList events={events} showHost={false} /></Card>}

      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} danger confirmLabel="Remove" loading={remove.isPending}
        title={`Remove ${agent.hostname}?`} body="Its history is deleted. A host that still runs the agent re-registers on its next connection — uninstall it there first (tenantwarden-agent uninstall)."
        onConfirm={() => remove.mutate(agent.id, { onSuccess: onClose })} />
    </Sheet>
  )
}

type Check = { label: string; ok: boolean | null; value: ReactNode }

function CheckRow({ c }: { c: Check }) {
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-outline-variant/60 last:border-0">
      {c.ok === true ? <CheckCircle2 size={18} className="text-success shrink-0" /> : c.ok === false ? <XCircle size={18} className="text-error shrink-0" /> : <AlertTriangle size={18} className="text-on-surface-variant shrink-0" />}
      <span className="flex-1 text-sm text-on-surface">{c.label}</span>
      <span className="text-sm text-on-surface-variant text-right">{c.value}</span>
    </li>
  )
}

const n = (v: unknown) => (typeof v === 'number' ? v : null)
const list = (v: unknown) => (Array.isArray(v) ? v as unknown[] : [])

/** Turns the platform-specific inventory into pass/fail checks. */
function SecurityInventory({ inv }: { inv: AgentInventory }) {
  const checks: Check[] = []
  const pending = n(inv.pending_updates)
  const pendingSec = n(inv.pending_security_updates)
  if (pending !== null) checks.push({ label: 'Operating system updates', ok: pending === 0, value: pending === 0 ? 'up to date' : `${pending} pending${pendingSec ? ` (${pendingSec} security)` : ''}` })

  // Windows
  const defender = inv.defender as Record<string, unknown> | undefined
  if (defender) {
    checks.push({ label: 'Microsoft Defender antivirus', ok: !!defender.antivirus_enabled && !!defender.realtime_protection,
      value: defender.realtime_protection ? 'real-time protection on' : 'real-time protection off' })
    const age = n(defender.signature_age_days)
    if (age !== null) checks.push({ label: 'Antivirus signatures', ok: age <= 3, value: `${age} day${age === 1 ? '' : 's'} old` })
    checks.push({ label: 'Tamper protection', ok: !!defender.tamper_protection, value: defender.tamper_protection ? 'on' : 'off' })
  }
  const fw = list(inv.firewall) as { profile: string; enabled: boolean }[]
  if (fw.length) checks.push({ label: 'Windows Firewall', ok: fw.every((p) => p.enabled), value: fw.map((p) => `${p.profile} ${p.enabled ? 'on' : 'off'}`).join(' · ') })
  else if (typeof inv.firewall === 'string') checks.push({ label: 'Firewall', ok: /active|running|rules loaded/.test(inv.firewall) ? true : /inactive|not running|empty|none found/.test(inv.firewall) ? false : null, value: inv.firewall })
  const bl = list(inv.bitlocker) as { volume: string; protection: string }[]
  if (bl.length) checks.push({ label: 'BitLocker', ok: bl.every((v) => /^on$|^1$/i.test(v.protection)), value: bl.map((v) => `${v.volume} ${v.protection}`).join(' · ') })
  if (typeof inv.disk_encryption === 'boolean') checks.push({ label: 'Disk encryption (LUKS)', ok: inv.disk_encryption, value: inv.disk_encryption ? 'encrypted volume found' : 'no encrypted volume' })
  else if (typeof inv.disk_encryption === 'string') checks.push({ label: 'FileVault', ok: /on/i.test(inv.disk_encryption), value: inv.disk_encryption })
  if (typeof inv.uac_enabled === 'boolean') checks.push({ label: 'User Account Control', ok: inv.uac_enabled, value: inv.uac_enabled ? 'on' : 'off' })
  if (typeof inv.rdp_enabled === 'boolean') checks.push({ label: 'Remote Desktop', ok: inv.rdp_enabled ? null : true, value: inv.rdp_enabled ? 'enabled — restrict to VPN' : 'disabled' })
  if (typeof inv.reboot_required === 'boolean') checks.push({ label: 'Reboot', ok: !inv.reboot_required, value: inv.reboot_required ? 'required to finish updates' : 'not required' })

  // Linux
  const ssh = inv.ssh as Record<string, string> | undefined
  if (ssh && Object.keys(ssh).length) {
    const root = (ssh.permitrootlogin ?? 'prohibit-password').toLowerCase()
    checks.push({ label: 'SSH root login', ok: root === 'no' || root === 'prohibit-password', value: root })
    const pw = (ssh.passwordauthentication ?? 'yes').toLowerCase()
    checks.push({ label: 'SSH password login', ok: pw === 'no', value: pw === 'no' ? 'keys only' : 'allowed' })
  }
  const failed = list(inv.services_failed) as string[]
  if (Array.isArray(inv.services_failed)) checks.push({ label: 'Failed services', ok: failed.length === 0, value: failed.length ? failed.join(', ') : 'none' })

  const admins = list(inv.admin_users) as string[]
  const ports = list(inv.listening_ports) as string[]
  const containers = list(inv.containers) as { name: string; image: string; status: string }[]

  return (
    <>
      <Card title="Security checks" subtitle={`From the inventory sent ${timeAgo(String(inv.collected_at ?? ''))}`}>
        <ul>{checks.map((c) => <CheckRow key={c.label} c={c} />)}</ul>
      </Card>
      <Card title="System">
        <KeyValues items={[
          ...(inv.os_caption ? [['Operating system', `${inv.os_caption} (build ${inv.os_build})`] as [string, ReactNode]] : []),
          ...(inv.kernel ? [['Kernel', String(inv.kernel)] as [string, ReactNode]] : []),
          ...(inv.last_patch ? [['Last patch', `${inv.last_patch} (${inv.last_patch_id})`] as [string, ReactNode]] : []),
          ...(inv.last_boot ? [['Last boot', fmtDateTime(String(inv.last_boot))] as [string, ReactNode]] : []),
          ...(inv.domain ? [['Domain', `${inv.domain}${inv.domain_joined ? '' : ' (not joined)'}`] as [string, ReactNode]] : []),
          ...(n(inv.services_running) !== null ? [['Running services', String(inv.services_running)] as [string, ReactNode]] : []),
          ...(inv.packages ? [['Packages', `${inv.packages} (${inv.package_manager})`] as [string, ReactNode]] : []),
          ...(n(inv.login_users) !== null ? [['Accounts with a login shell', String(inv.login_users)] as [string, ReactNode]] : []),
          ['Administrators', admins.length ? admins.join(', ') : '—'],
        ]} />
      </Card>
      {ports.length > 0 && (
        <Card title="Listening ports" subtitle={`${ports.length} sockets accept connections`}>
          <div className="flex flex-wrap gap-1.5">{ports.map((p) => <Pill key={p} className="font-mono">{p}</Pill>)}</div>
        </Card>
      )}
      {containers.length > 0 && (
        <Card flush title="Containers">
          <DataTable rows={containers} rowKey={(c) => c.name} columns={[
            { key: 'name', header: 'Name' }, { key: 'image', header: 'Image', render: (c) => <span className="text-xs font-mono">{c.image}</span> },
            { key: 'status', header: 'Status', render: (c) => <span className="text-xs">{c.status}</span> },
          ]} />
        </Card>
      )}
      {list(inv.pending_update_titles).length > 0 && (
        <Card title="Pending updates">
          <ul className="list-disc pl-5 text-sm space-y-1">{(list(inv.pending_update_titles) as string[]).map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
      )}
    </>
  )
}

function SoftwareList({ software, inventory }: { software: { name: string; version: string; publisher: string }[]; inventory?: AgentInventory }) {
  const [q, setQ] = useState('')
  const rows = software.filter((s) => !q || `${s.name} ${s.publisher}`.toLowerCase().includes(q.toLowerCase()))
  if (!software.length) return <EmptyState title="No software list" body={inventory?.packages ? `${inventory.packages} packages are installed (${inventory.package_manager}); Linux agents report the count only.` : 'Windows agents report installed programs in their inventory.'} />
  return (
    <Card flush title={`${fmtNumber(Number(inventory?.software_count ?? software.length))} programs`} subtitle={software.length < Number(inventory?.software_count ?? 0) ? `Showing the first ${software.length}` : undefined}
      action={<SearchField value={q} onChange={setQ} placeholder="Filter" />}>
      <DataTable rows={rows} rowKey={(s) => `${s.name}|${s.version}`} columns={[
        { key: 'name', header: 'Name', render: (s) => <span className="text-sm">{s.name}</span> },
        { key: 'version', header: 'Version', render: (s) => <span className="text-xs font-mono">{s.version || '—'}</span> },
        { key: 'publisher', header: 'Publisher', render: (s) => <span className="text-xs text-on-surface-variant">{s.publisher || '—'}</span> },
      ]} />
    </Card>
  )
}


interface SheetWorkload { type: string; name: string; status: string; startup?: string; version?: string; details?: Record<string, unknown> }
interface SheetCertificate { subject: string; issuer: string; expires: string; days_left: number; self_signed: boolean; location: string }

function WorkloadList({ workloads, certificates }: { workloads: SheetWorkload[]; certificates: SheetCertificate[] }) {
  return (
    <>
      <Card flush title="Server roles" subtitle="Rediscovered every 5 minutes">
        <DataTable rows={workloads} rowKey={(w) => `${w.type}|${w.name}`}
          empty={<EmptyState title="No server roles found" body="SQL Server, IIS, AD DS, DNS, nginx, MySQL, PostgreSQL, Docker and others are detected automatically." />}
          columns={[
            { key: 'name', header: 'Role', render: (w) => <div><div className="font-medium">{w.name}</div><div className="text-[11px] text-on-surface-variant">{w.type}</div></div> },
            { key: 'status', header: 'Status', render: (w) => <StatusPill status={w.status === 'running' ? 'online' : w.startup && w.startup !== 'auto' ? 'offline' : 'error'} label={w.status} /> },
            { key: 'version', header: 'Version', render: (w) => <span className="text-xs">{w.version || '—'}</span> },
            { key: 'details', header: 'Details', render: (w) => <span className="flex flex-wrap gap-1">{Object.entries(w.details ?? {}).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => <Pill key={k}>{k.replace(/_/g, ' ')}: {String(v)}</Pill>)}</span> },
          ]} />
      </Card>
      <Card flush title="Certificates" subtitle="Machine certificates and how long they have left">
        <DataTable rows={certificates} rowKey={(c) => `${c.subject}|${c.expires}`}
          empty={<EmptyState title="No certificates" body="Windows: LocalMachine\\My. Linux: Let's Encrypt certificates." />}
          columns={[
            { key: 'subject', header: 'Subject', render: (c) => <div className="min-w-0 max-w-[300px]"><div className="text-xs truncate" title={c.subject}>{c.subject}</div><div className="text-[11px] text-on-surface-variant truncate">{c.self_signed ? 'self-signed' : c.issuer}</div></div> },
            { key: 'days', header: 'Expires', render: (c) => <Pill tone={c.days_left < 0 ? 'error' : c.days_left < 30 ? 'warning' : 'success'}>{c.days_left < 0 ? `expired ${-c.days_left} d ago` : `${c.days_left} days`}</Pill> },
            { key: 'date', header: 'On', render: (c) => <span className="text-xs">{fmtDate(c.expires)}</span> },
          ]} />
      </Card>
    </>
  )
}
