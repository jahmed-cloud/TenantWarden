import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownUp, Cable, CircleCheck, Globe, ShieldAlert } from 'lucide-react'
import { useCheckHistory, useChecks, useNetworkSummary, type EndpointCheck, type NetworkHost } from '@/services/api/hooks'
import { TimeSeriesChart } from '@/components/charts'
import { Button, Card, Chip, DataTable, EmptyState, PageHeader, Pill, Segmented, StatCard, StatusPill, cx, type Column } from '@/components/ui'
import { fmtNumber, timeAgo } from '@/lib/format'
import { ScopeBanner } from '@/components/MachineScope'

const PORT_NAMES: Record<string, string> = {
  '3389': 'RDP', '445': 'SMB', '23': 'Telnet', '21': 'FTP', '1433': 'SQL Server', '3306': 'MySQL',
  '5432': 'PostgreSQL', '6379': 'Redis', '27017': 'MongoDB', '9200': 'Elasticsearch',
}

const mbps = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2))
const connections = (raw: string | null) => {
  try { return raw ? JSON.parse(raw) as { established: number; listen: number; time_wait: number; close_wait: number } : null } catch { return null }
}

export function NetworkPage() {
  const navigate = useNavigate()
  const [hours, setHours] = useState(24)
  const { data: net, isLoading } = useNetworkSummary(hours)
  const { data: checks } = useChecks()
  const [checkName, setCheckName] = useState<string | undefined>()
  const { data: history } = useCheckHistory(hours, checkName)

  const online = (net?.hosts ?? []).filter((h) => h.online)
  const rx = online.reduce((a, h) => a + h.rxMbps, 0)
  const tx = online.reduce((a, h) => a + h.txMbps, 0)
  const established = online.reduce((a, h) => a + (connections(h.connections)?.established ?? 0), 0)
  const exposed = (net?.hosts ?? []).filter((h) => h.exposedPorts.length)
  const live = (checks ?? []).filter((c) => !c.stale)
  const failing = live.filter((c) => !c.ok)
  const checkNames = [...new Set((checks ?? []).map((c) => c.name))]

  const latencySeries = useMemo(() => {
    const byName = new Map<string, [string, number | null][]>()
    for (const p of history ?? []) byName.set(p.name, [...(byName.get(p.name) ?? []), [p.t, p.latencyMs]])
    return [...byName.entries()].map(([name, points]) => ({ name, points }))
  }, [history])
  const availability = useMemo(() => {
    const all = history ?? []
    return all.length ? Math.round(all.reduce((a, p) => a + p.availability, 0) / all.length) : null
  }, [history])

  const hostColumns: Column<NetworkHost>[] = [
    { key: 'host', header: 'Host', render: (h) => (
      <span className="flex items-center gap-2"><span className={cx('w-2 h-2 rounded-full', h.online ? 'bg-success' : 'bg-outline')} /><span className="font-medium">{h.hostname}</span></span>
    ) },
    { key: 'in', header: 'In (Mbit/s)', align: 'right', render: (h) => <span className="tabular-nums">{h.online ? mbps(h.rxMbps) : '—'}</span> },
    { key: 'out', header: 'Out (Mbit/s)', align: 'right', render: (h) => <span className="tabular-nums">{h.online ? mbps(h.txMbps) : '—'}</span> },
    { key: 'conn', header: 'Connections', render: (h) => {
      const c = connections(h.connections)
      return c ? <span className="text-xs">{c.established} established · {c.listen} listening{c.time_wait ? ` · ${c.time_wait} time-wait` : ''}</span> : <span className="text-on-surface-variant">—</span>
    } },
    { key: 'ports', header: 'Listening ports', align: 'right', render: (h) => <span className="tabular-nums text-xs">{h.listeningPorts || '—'}</span> },
    { key: 'exposed', header: 'Risky ports open to all', render: (h) => h.exposedPorts.length
      ? <span className="flex flex-wrap gap-1">{h.exposedPorts.map((p) => <Pill key={p} tone="warning">{PORT_NAMES[p] ?? p} {p}</Pill>)}</span>
      : <span className="text-xs text-on-surface-variant">none</span> },
  ]

  const checkColumns: Column<EndpointCheck>[] = [
    { key: 'status', header: 'Status', render: (c) => c.stale ? <StatusPill status="offline" label="stale" /> : <StatusPill status={c.ok ? 'online' : 'error'} label={c.ok ? 'up' : 'down'} /> },
    { key: 'name', header: 'Check', render: (c) => (
      <div className="min-w-0">
        <div className="font-medium">{c.name} <span className="text-[11px] text-on-surface-variant uppercase">{c.type}</span></div>
        <div className="text-xs text-on-surface-variant font-mono truncate max-w-[320px]">{c.target}</div>
      </div>
    ) },
    { key: 'from', header: 'From', render: (c) => <span className="text-xs">{c.hostname}</span> },
    { key: 'latency', header: 'Latency', align: 'right', render: (c) => <span className="tabular-nums text-xs">{c.latencyMs !== null ? `${c.latencyMs} ms` : '—'}</span> },
    { key: 'detail', header: 'Detail', render: (c) => (
      <span className="text-xs">
        {c.error ? <span className="text-error">{c.error}</span> : c.statusCode ? `HTTP ${c.statusCode}` : 'ok'}
        {c.certDaysLeft !== null && <Pill tone={c.certDaysLeft < 14 ? 'error' : c.certDaysLeft < 30 ? 'warning' : 'neutral'} className="ml-1">cert {c.certDaysLeft} d</Pill>}
        {c.failingSince && <span className="text-on-surface-variant"> · down since {timeAgo(c.failingSince)}</span>}
      </span>
    ) },
    { key: 'checked', header: 'Checked', align: 'right', render: (c) => <span className="text-xs text-on-surface-variant whitespace-nowrap">{timeAgo(c.checkedAt)}</span> },
  ]

  return (
    <div>
      <PageHeader title="Network" subtitle="Throughput and connections from every agent, risky open ports, and endpoint checks run from inside your network"
        actions={<Segmented value={hours} onChange={setHours} options={[{ value: 1, label: '1 h' }, { value: 6, label: '6 h' }, { value: 24, label: '24 h' }, { value: 168, label: '7 d' }]} />} />
      <ScopeBanner />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Fleet throughput now" icon={ArrowDownUp} loading={isLoading} value={`${mbps(rx + tx)} Mbit/s`} detail={`${mbps(rx)} in · ${mbps(tx)} out · ${online.length} hosts`} />
        <StatCard label="Established connections" icon={Cable} loading={isLoading} value={fmtNumber(established)} detail="TCP, online hosts" />
        <StatCard label="Endpoint checks" icon={CircleCheck} tone={failing.length ? 'error' : live.length ? 'success' : 'neutral'} loading={!checks}
          value={live.length ? `${live.length - failing.length}/${live.length} up` : '—'} detail={failing.length ? `${failing.map((c) => c.name).slice(0, 2).join(', ')} down` : availability !== null ? `${availability}% available in range` : 'none configured'} />
        <StatCard label="Hosts with risky open ports" icon={ShieldAlert} tone={exposed.length ? 'warning' : 'success'} loading={isLoading} value={fmtNumber(exposed.length)}
          detail="RDP, SMB, databases … on all interfaces" />
      </div>

      <Card className="mb-4" title="Fleet throughput" subtitle="All hosts added up (average per host in each interval); loopback and container bridges excluded">
        <TimeSeriesChart unit=" Mbit/s" height={280} empty="No network history yet — agents send throughput with every metrics sample"
          series={[
            { name: 'In', area: true, points: (net?.traffic ?? []).map((p) => [p.t, p.rxMbps]) },
            { name: 'Out', area: true, points: (net?.traffic ?? []).map((p) => [p.t, p.txMbps]) },
          ]} />
      </Card>

      <Card flush className="mb-4" title="Hosts" subtitle="Busiest first">
        <DataTable columns={hostColumns} rows={net?.hosts} loading={isLoading} rowKey={(h) => h.id}
          empty={<EmptyState icon={Cable} title="No agents" body="Install an agent to see network data." action={<Button variant="tonal" onClick={() => navigate('/agents')}>Add an agent</Button>} />} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card flush className="xl:col-span-3" title="Endpoint checks" subtitle="TCP ports, websites and DNS names tested by agents (Agents → Monitoring profile)">
          <DataTable columns={checkColumns} rows={checks} rowKey={(c) => `${c.agentId}|${c.name}`}
            onRowClick={(c) => setCheckName(c.name === checkName ? undefined : c.name)}
            empty={<EmptyState icon={Globe} title="No endpoint checks" body="Add TCP, HTTP or DNS checks to the monitoring profile; agents start running them within seconds."
              action={<Button variant="tonal" onClick={() => navigate('/agents?tab=profile')}>Open monitoring profile</Button>} />} />
        </Card>
        <Card className="xl:col-span-2" title="Check latency" subtitle={checkName ? `${checkName} — click the row again for all checks` : 'All checks — click a check to focus it'}
          action={checkNames.length > 1 && <div className="flex flex-wrap gap-1 max-w-[280px] justify-end">
            {checkNames.slice(0, 6).map((n) => <Chip key={n} selected={n === checkName} onClick={() => setCheckName(n === checkName ? undefined : n)}>{n}</Chip>)}
          </div>}>
          <TimeSeriesChart unit=" ms" height={280} series={latencySeries} empty="No check results in this range" />
        </Card>
      </div>
    </div>
  )
}
