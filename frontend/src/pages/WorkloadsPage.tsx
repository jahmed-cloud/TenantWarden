import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes, CircleCheck, CircleSlash, Container, Database, Globe, HardDrive, KeyRound, Network, Printer, Server, ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useAgentEvents, useQueryData, useWorkloads, type WorkloadRow } from '@/services/api/hooks'
import { ResultChart } from '@/components/query'
import { Button, Card, DataTable, EmptyState, PageHeader, Pill, Segmented, StatCard, StatusPill, cx, type Column } from '@/components/ui'
import { fmtNumber, timeAgo } from '@/lib/format'

interface TypeMeta { label: string; icon: LucideIcon; source?: string; group: string }

// Event source each role's logs arrive under (see the agent's discovery)
const TYPES: Record<string, TypeMeta> = {
  sqlserver:     { label: 'SQL Server', icon: Database, source: 'SQL Server', group: 'Databases' },
  mysql:         { label: 'MySQL / MariaDB', icon: Database, source: 'MySQL', group: 'Databases' },
  postgresql:    { label: 'PostgreSQL', icon: Database, source: 'PostgreSQL', group: 'Databases' },
  mongodb:       { label: 'MongoDB', icon: Database, source: 'MongoDB', group: 'Databases' },
  redis:         { label: 'Redis', icon: Database, source: 'Redis', group: 'Databases' },
  elasticsearch: { label: 'Elasticsearch', icon: Database, source: 'Elasticsearch', group: 'Databases' },
  iis:           { label: 'IIS', icon: Globe, group: 'Web' },
  nginx:         { label: 'nginx', icon: Globe, source: 'nginx', group: 'Web' },
  apache:        { label: 'Apache', icon: Globe, source: 'apache', group: 'Web' },
  tomcat:        { label: 'Tomcat', icon: Globe, source: 'Tomcat', group: 'Web' },
  haproxy:       { label: 'HAProxy', icon: Network, group: 'Web' },
  adds:          { label: 'Active Directory', icon: ShieldCheck, source: 'Directory Service', group: 'Directory & network' },
  dns:           { label: 'DNS Server', icon: Network, source: 'DNS Server', group: 'Directory & network' },
  bind:          { label: 'BIND DNS', icon: Network, group: 'Directory & network' },
  dhcp:          { label: 'DHCP Server', icon: Network, group: 'Directory & network' },
  adcs:          { label: 'Certificate Services', icon: KeyRound, group: 'Directory & network' },
  openldap:      { label: 'OpenLDAP', icon: ShieldCheck, group: 'Directory & network' },
  fileserver:    { label: 'File Server', icon: HardDrive, group: 'Infrastructure' },
  samba:         { label: 'Samba', icon: HardDrive, group: 'Infrastructure' },
  printspooler:  { label: 'Print Spooler', icon: Printer, group: 'Infrastructure' },
  rds:           { label: 'Remote Desktop', icon: Server, group: 'Infrastructure' },
  hyperv:        { label: 'Hyper-V', icon: Boxes, group: 'Infrastructure' },
  wsus:          { label: 'WSUS', icon: Server, group: 'Infrastructure' },
  exchange:      { label: 'Exchange Server', icon: Server, group: 'Infrastructure' },
  ssrs:          { label: 'Reporting Services', icon: Database, group: 'Databases' },
  ssis:          { label: 'Integration Services', icon: Database, group: 'Databases' },
  docker:        { label: 'Docker', icon: Container, group: 'Containers' },
  kubernetes:    { label: 'Kubernetes', icon: Container, group: 'Containers' },
  rabbitmq:      { label: 'RabbitMQ', icon: Boxes, group: 'Infrastructure' },
}
const meta = (t: string): TypeMeta => TYPES[t] ?? { label: t, icon: Server, group: 'Other' }

function details(raw: string | null): [string, string][] {
  if (!raw) return []
  try {
    return Object.entries(JSON.parse(raw) as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => [k.replace(/_/g, ' '), String(v)])
  } catch { return [] }
}

const stoppedOnPurpose = (w: WorkloadRow) => w.status !== 'running' && w.startup && w.startup !== 'auto'

export function WorkloadsPage() {
  const navigate = useNavigate()
  const { data: rows, isLoading } = useWorkloads()
  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState(1440)

  const byType = useMemo(() => {
    const m = new Map<string, WorkloadRow[]>()
    for (const r of rows ?? []) m.set(r.type, [...(m.get(r.type) ?? []), r])
    return [...m.entries()].sort((a, b) => (a[0] === 'sqlserver' ? -1 : b[0] === 'sqlserver' ? 1 : b[1].length - a[1].length))
  }, [rows])
  const type = selected ?? byType[0]?.[0] ?? null
  const instances = byType.find(([t]) => t === type)?.[1] ?? []
  const m = type ? meta(type) : null
  const problems = (rows ?? []).filter((w) => w.status !== 'running' && !stoppedOnPurpose(w))

  const columns: Column<WorkloadRow>[] = [
    { key: 'host', header: 'Host', render: (w) => (
      <span className="flex items-center gap-2"><span className={cx('w-2 h-2 rounded-full', w.online ? 'bg-success' : 'bg-outline')} />{w.hostname}</span>
    ) },
    { key: 'name', header: 'Instance', render: (w) => <span className="font-medium">{w.name}</span> },
    { key: 'status', header: 'Status', render: (w) => <StatusPill status={w.status === 'running' ? 'online' : stoppedOnPurpose(w) ? 'offline' : 'error'} label={w.status} /> },
    { key: 'startup', header: 'Start', render: (w) => <span className="text-xs text-on-surface-variant">{w.startup ?? '—'}</span> },
    { key: 'version', header: 'Version', render: (w) => <span className="text-xs">{w.version || '—'}</span> },
    { key: 'details', header: 'Details', render: (w) => (
      <span className="flex flex-wrap gap-1">{details(w.details).map(([k, v]) => <Pill key={k}>{k}: {v}</Pill>)}</span>
    ) },
  ]

  return (
    <div>
      <PageHeader title="Workloads" subtitle="Server roles the agents found on your hosts — SQL Server, IIS, Active Directory, DNS, web servers, databases and containers — with their own logs and events" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Roles discovered" icon={Server} loading={isLoading} value={fmtNumber(rows?.length)} detail={`${byType.length} kinds`} />
        <StatCard label="Running" icon={CircleCheck} tone="success" loading={isLoading} value={fmtNumber(rows?.filter((w) => w.status === 'running').length)} />
        <StatCard label="Stopped unexpectedly" icon={CircleSlash} tone={problems.length ? 'error' : 'success'} loading={isLoading} value={fmtNumber(problems.length)}
          detail={problems.slice(0, 2).map((w) => `${w.hostname} ${w.name}`).join(', ') || 'set to start automatically but not running'} />
        <StatCard label="SQL Server instances" icon={Database} loading={isLoading} value={fmtNumber(rows?.filter((w) => w.type === 'sqlserver').length)} onClick={() => setSelected('sqlserver')} />
      </div>

      {!isLoading && !rows?.length ? (
        <Card><EmptyState icon={Server} title="No server roles found yet"
          body="Agents look for SQL Server, IIS, AD DS, DNS, DHCP, Hyper-V, nginx, Apache, MySQL, PostgreSQL, Redis, MongoDB, Docker and more every 5 minutes."
          action={<Button variant="tonal" onClick={() => navigate('/agents')}>Go to agents</Button>} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
            {byType.map(([t, list]) => {
              const tm = meta(t)
              const down = list.filter((w) => w.status !== 'running' && !stoppedOnPurpose(w)).length
              return (
                <button key={t} type="button" onClick={() => setSelected(t)}
                  className={cx('state-layer text-left rounded-2xl p-3 shadow-e1 bg-surface-container-lowest', t === type && 'ring-2 ring-primary')}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center"><tm.icon size={16} /></span>
                    <span className="text-sm font-medium text-on-surface truncate">{tm.label}</span>
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {list.length} instance{list.length === 1 ? '' : 's'}{down > 0 && <span className="text-error font-medium"> · {down} stopped</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {type && m && (
            <>
              <Card flush className="mb-4" title={<span className="flex items-center gap-2"><m.icon size={18} />{m.label}</span>} subtitle={`${instances.length} instance${instances.length === 1 ? '' : 's'} · seen ${timeAgo(instances[0]?.seenAt)}`}>
                <DataTable columns={columns} rows={instances} rowKey={(w) => `${w.agentId}|${w.name}`} />
              </Card>
              {m.source && <RoleLogs source={m.source} label={m.label} type={type} range={range} setRange={setRange} />}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Dedicated charts and events for a role that writes its own log. */
function RoleLogs({ source, label, type, range, setRange }: { source: string; label: string; type: string; range: number; setRange: (v: number) => void }) {
  const q = (s: string) => s.replace(/"/g, '\\"')
  const bin = range <= 1440 ? '1h' : '6h'
  const levels = useQueryData(`AgentEvents | where source == "${q(source)}" | summarize count() by bin(occurred_at, ${bin}), level`, range)
  const byHost = useQueryData(`AgentEvents | where source == "${q(source)}" and level in ("error", "critical") | summarize count() by hostname | sort by count_ desc`, range)
  const logins = useQueryData(type === 'sqlserver'
    ? `AgentEvents | where source == "SQL Server" and message matches regex "^[0-9]+ failed" | project occurred_at, hostname, message | sort by occurred_at desc | take 20`
    : null, range)
  const { data: events } = useAgentEvents(undefined, 30, source)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-on-surface">{label} logs and events</h2>
        <Segmented value={range} onChange={setRange} options={[{ value: 1440, label: '24 h' }, { value: 10080, label: '7 d' }, { value: 43200, label: '30 d' }]} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Events over time" subtitle={`Source "${source}", by level`}>
          {levels.data ? <ResultChart result={levels.data} empty={`No ${label} events in this period`} /> : <div className="h-[320px]" />}
        </Card>
        <Card title="Errors by host">
          {byHost.data ? <ResultChart result={byHost.data} empty="No errors in this period" /> : <div className="h-[200px]" />}
        </Card>
      </div>
      {type === 'sqlserver' && (
        <Card flush className="mb-4" title="Failed SQL Server logins" subtitle="Error 18456, counted per client address on each read">
          <DataTable rows={logins.data?.rows as { occurred_at: string; hostname: string; message: string }[] | undefined} rowKey={(r) => `${r.occurred_at}${r.message}`}
            empty={<EmptyState icon={ShieldCheck} title="No failed logins" body="SQL Server reported no failed logins in this period." />}
            columns={[
              { key: 'at', header: 'When', render: (r) => <span className="text-xs whitespace-nowrap">{timeAgo(r.occurred_at)}</span> },
              { key: 'host', header: 'Host', render: (r) => <span className="text-xs">{r.hostname}</span> },
              { key: 'msg', header: 'Failures', render: (r) => <span className="text-xs">{r.message}</span> },
            ]} />
        </Card>
      )}
      <Card flush title="Latest events" subtitle={`Newest 30 from "${source}"`}>
        <DataTable rows={events} rowKey={(e) => e.id}
          empty={<EmptyState title="No events" body={`Nothing from ${label} yet. Errors and warnings appear here as the agent reads them.`} />}
          columns={[
            { key: 'level', header: 'Level', render: (e) => <StatusPill status={e.level === 'critical' || e.level === 'error' ? 'error' : e.level === 'warning' ? 'degraded' : 'acknowledged'} label={e.level} /> },
            { key: 'host', header: 'Host', render: (e) => <span className="text-xs">{e.hostname}</span> },
            { key: 'msg', header: 'Message', render: (e) => <span className="text-xs line-clamp-2" title={e.message}>{e.message}</span> },
            { key: 'at', header: 'When', align: 'right', render: (e) => <span className="text-xs text-on-surface-variant whitespace-nowrap">{timeAgo(e.occurredAt)}</span> },
          ]} />
      </Card>
    </>
  )
}
