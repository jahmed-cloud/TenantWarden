import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Eye, Pencil, Plus, ShieldCheck, Trash2, UserCheck } from 'lucide-react'
import { get } from '@/services/api/client'
import {
  useAcknowledgeAlert, useAlertCounts, useAlerts, useAlertTrend, useAssignAlert, useDeleteAlert, useDeleteRule,
  useResolveAlert, useRuleMetrics, useRules, useToggleRule,
  type Alert, type AlertRule, type RuleInput, type Severity,
} from '@/services/api/hooks'
import { useCan, useTenantWardenStore } from '@/store/tenantWardenStore'
import { AlertTrendChart } from '@/components/charts'
import { RuleDialog, RuleLibrary, ruleSummary } from '@/components/RuleDialog'
import {
  Button, Card, Chip, ConfirmDialog, DataTable, Dialog, EmptyState, IconButton, KeyValues, PageHeader, Pagination,
  SearchField, SeverityBadge, Sheet, StatusPill, Switch, Tabs, TextField, type Column,
} from '@/components/ui'
import { fmtDateTime, timeAgo } from '@/lib/format'

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']
const STATUSES = [
  { value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'investigating', label: 'Investigating' }, { value: 'resolved', label: 'Resolved' },
]
const SOURCES = [
  { value: '', label: 'Any source' }, { value: 'entra_id', label: 'Entra ID' }, { value: 'defender', label: 'Defender' },
  { value: 'intune', label: 'Intune' }, { value: 'agent', label: 'Agents' }, { value: 'purview', label: 'Purview' },
  { value: 'exchange', label: 'Exchange' }, { value: 'custom', label: 'Custom' },
]
const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label ?? s

export function AlertsPage() {
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts')
  const rules = useRules().data
  return (
    <div>
      <PageHeader title="Alerts" subtitle="Findings from alert rules, Defender incidents and endpoint agents" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'alerts', label: 'Alert queue' }, { id: 'rules', label: 'Rules', count: rules?.length }]} />
      {tab === 'alerts' ? <AlertQueue /> : <RulesTab />}
    </div>
  )
}

// ── Queue ────────────────────────────────────────────────────────────────────

function AlertQueue() {
  const [params, setParams] = useSearchParams()
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('active')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAlerts({ severity, status, source, search: debounced, page, pageSize: 25 })
  const counts = useAlertCounts().data
  const { data: trend } = useAlertTrend(30)
  const openId = params.get('id')

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t) }, [search])
  useEffect(() => setPage(1), [severity, status, source, debounced])

  const columns: Column<Alert>[] = [
    { key: 'severity', header: 'Severity', render: (a) => <SeverityBadge severity={a.severity} /> },
    { key: 'title', header: 'Alert', className: 'max-w-[420px]', render: (a) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{a.title}</div>
        <div className="truncate text-xs text-on-surface-variant">{a.description}</div>
      </div>
    ) },
    { key: 'source', header: 'Source', render: (a) => <span className="text-on-surface-variant">{sourceLabel(a.source)}</span> },
    { key: 'affected', header: 'Affected', render: (a) => {
      const items = [...a.affectedUsers, ...a.affectedDevices]
      return items.length ? <span className="text-xs">{items[0]}{items.length > 1 && <span className="text-on-surface-variant"> +{items.length - 1}</span>}</span> : <span className="text-on-surface-variant">—</span>
    } },
    { key: 'status', header: 'Status', render: (a) => <StatusPill status={a.status} /> },
    { key: 'created', header: 'Raised', align: 'right', render: (a) => <span className="text-xs text-on-surface-variant whitespace-nowrap" title={fmtDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span> },
  ]

  return (
    <>
      <Card title="Alert volume" subtitle="Last 30 days — hover a day for the breakdown" className="mb-4">
        <AlertTrendChart data={trend} height={220} />
      </Card>
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-outline-variant">
          <Chip selected={severity === ''} onClick={() => setSeverity('')}>All</Chip>
          {SEVERITIES.map((s) => (
            <Chip key={s} selected={severity === s} onClick={() => setSeverity(severity === s ? '' : s)} count={counts?.[s as keyof typeof counts]}>
              {s[0].toUpperCase() + s.slice(1)}
            </Chip>
          ))}
          <div className="flex-1" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-lg border border-outline-variant bg-surface-container-high text-on-surface px-2 text-xs">
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 rounded-lg border border-outline-variant bg-surface-container-high text-on-surface px-2 text-xs">
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <SearchField value={search} onChange={setSearch} placeholder="Search alerts" />
        </div>
        <DataTable columns={columns} rows={data?.items} loading={isLoading} rowKey={(a) => a.id}
          onRowClick={(a) => setParams({ id: a.id })}
          empty={<EmptyState icon={ShieldCheck} title="No alerts match" body="Try another status or severity filter." />} />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />}
      </Card>
      <AlertSheet id={openId} onClose={() => { params.delete('id'); setParams(params) }} />
    </>
  )
}

function AlertSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: alert } = useQuery({ queryKey: ['alert', id], queryFn: () => get<Alert>(`/v1/alerts/${id}`), enabled: !!id })
  const me = useTenantWardenStore((s) => s.currentUser)
  const canTriage = useCan('triageAlerts')
  const canDelete = useCan('editRules')
  const ack = useAcknowledgeAlert()
  const resolve = useResolveAlert()
  const assign = useAssignAlert()
  const remove = useDeleteAlert()
  const [dialog, setDialog] = useState<'ack' | 'resolve' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const done = () => { setDialog(null); setNote('') }

  if (!id) return null
  const open = alert && alert.status !== 'resolved'
  const meta = (() => { try { return JSON.parse(alert?.metadata ?? '{}') as { ackComment?: string; ackBy?: string } } catch { return {} } })()
  return (
    <Sheet open onClose={onClose}
      title={alert?.title ?? 'Loading…'}
      subtitle={alert && <span className="flex flex-wrap items-center gap-2"><SeverityBadge severity={alert.severity} /><StatusPill status={alert.status} /><span>{sourceLabel(alert.source)}</span></span>}
      actions={alert && canTriage && <>
        {canDelete && <Button variant="text" icon={Trash2} onClick={() => setDialog('delete')}>Delete</Button>}
        {open && alert.assignedTo !== me?.email && <Button variant="outlined" icon={UserCheck} loading={assign.isPending}
          onClick={() => me && assign.mutate({ id: alert.id, assigneeId: me.email })}>Assign to me</Button>}
        {alert.status === 'active' && <Button variant="tonal" icon={Eye} onClick={() => setDialog('ack')}>Acknowledge</Button>}
        {open && <Button icon={CheckCircle2} onClick={() => setDialog('resolve')}>Resolve</Button>}
      </>}>
      {alert && (
        <>
          <Card title="What happened">
            <p className="text-sm text-on-surface whitespace-pre-line">{alert.description}</p>
            {alert.recommendedAction && (
              <div className="mt-4 rounded-xl bg-primary-container text-on-primary-container px-4 py-3 text-sm">
                <div className="font-medium mb-1">Recommended action</div>
                {alert.recommendedAction}
              </div>
            )}
          </Card>
          <Card title="Details">
            <KeyValues items={[
              ['Category', alert.category],
              ['Affected users', alert.affectedUsers.length ? alert.affectedUsers.join(', ') : '—'],
              ['Affected devices', alert.affectedDevices.length ? alert.affectedDevices.join(', ') : '—'],
              ['IP address', alert.affectedIpAddress ?? '—'],
              ['Country', alert.affectedCountry ?? '—'],
              ['Risk score', alert.riskScore ?? '—'],
              ['Assigned to', alert.assignedTo || 'Unassigned'],
              ['Reference', alert.externalId ? <span className="font-mono text-xs">{alert.externalId}</span> : '—'],
            ]} />
          </Card>
          <Card title="Timeline">
            <ol className="relative border-l-2 border-outline-variant ml-2 space-y-4">
              {[
                ['Raised', alert.createdAt, null],
                ['Acknowledged', alert.acknowledgedAt, meta.ackComment ? `${meta.ackComment}${meta.ackBy ? ` — ${meta.ackBy}` : ''}` : null],
                ['Resolved', alert.resolvedAt, alert.resolution],
              ].filter(([, at]) => at).map(([label, at, text]) => (
                <li key={label as string} className="ml-4">
                  <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-primary" />
                  <div className="text-sm text-on-surface">{label}</div>
                  <div className="text-xs text-on-surface-variant">{fmtDateTime(at)}</div>
                  {text && <div className="text-xs text-on-surface mt-1">{text}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}

      <Dialog open={dialog === 'ack' || dialog === 'resolve'} onClose={done} title={dialog === 'ack' ? 'Acknowledge alert' : 'Resolve alert'}
        actions={<>
          <Button variant="text" onClick={done}>Cancel</Button>
          <Button loading={ack.isPending || resolve.isPending} disabled={dialog === 'resolve' && !note.trim()}
            onClick={() => alert && (dialog === 'ack'
              ? ack.mutate({ id: alert.id, comment: note || undefined }, { onSuccess: done })
              : resolve.mutate({ id: alert.id, resolution: note }, { onSuccess: done }))}>
            {dialog === 'ack' ? 'Acknowledge' : 'Resolve'}
          </Button>
        </>}>
        <div className="pb-2">
          <TextField label={dialog === 'ack' ? 'Comment (optional)' : 'Resolution'} value={note} onChange={setNote} autoFocus
            placeholder={dialog === 'resolve' ? 'e.g. Password reset and sessions revoked' : undefined} />
        </div>
      </Dialog>
      <ConfirmDialog open={dialog === 'delete'} onClose={done} danger confirmLabel="Delete" loading={remove.isPending}
        title="Delete this alert?" body="The alert and its history are removed. A rule that still matches raises a new one."
        onConfirm={() => alert && remove.mutate(alert.id, { onSuccess: () => { done(); onClose() } })} />
    </Sheet>
  )
}

// ── Rules ────────────────────────────────────────────────────────────────────

function RulesTab() {
  const { data: rules, isLoading } = useRules()
  const metrics = useRuleMetrics().data
  const canEdit = useCan('editRules')
  const toggle = useToggleRule()
  const remove = useDeleteRule()
  const [editing, setEditing] = useState<{ rule: AlertRule | null; preset?: Partial<RuleInput> } | null>(null)
  const [library, setLibrary] = useState(false)
  const [deleting, setDeleting] = useState<AlertRule | null>(null)
  const [category, setCategory] = useState('All')
  const categoryOf = (r: AlertRule) => metrics?.find((m) => m.metric === r.metric)?.category ?? 'Custom'
  const categories = ['All', ...Array.from(new Set((rules ?? []).map(categoryOf))).sort()]
  const shown = (rules ?? []).filter((r) => category === 'All' || categoryOf(r) === category)

  const columns: Column<AlertRule>[] = [
    { key: 'on', header: 'On', render: (r) => <Switch checked={r.isEnabled} label="Enabled" onChange={(v) => canEdit && toggle.mutate({ id: r.id, isEnabled: v })} /> },
    { key: 'name', header: 'Rule', render: (r) => (
      <div className="min-w-0 max-w-[460px]">
        <div className="font-medium truncate">{r.name}</div>
        <div className="text-xs text-on-surface-variant">When {ruleSummary(r, metrics)}</div>
        {r.query && <div className="text-[11px] font-mono text-on-surface-variant truncate" title={r.query}>{r.query.replace(/\s*\n\s*/g, ' ')}</div>}
      </div>
    ) },
    { key: 'area', header: 'Area', render: (r) => <span className="text-xs text-on-surface-variant">{categoryOf(r)}</span> },
    { key: 'severity', header: 'Raises', render: (r) => <SeverityBadge severity={r.severity} /> },
    { key: 'cooldown', header: 'Cooldown', render: (r) => <span className="text-on-surface-variant">{r.cooldownMinutes} min</span> },
    { key: 'last', header: 'Last fired', render: (r) => <span className="text-xs text-on-surface-variant">{timeAgo(r.lastTriggeredAt)}</span> },
    { key: 'actions', header: '', align: 'right', render: (r) => canEdit && (
      <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={Pencil} label="Edit rule" onClick={() => setEditing({ rule: r })} />
        <IconButton icon={Trash2} label="Delete rule" onClick={() => setDeleting(r)} />
      </span>
    ) },
  ]

  return (
    <Card flush title="Alert rules" subtitle="Evaluated every minute by the alert engine. An alert closes itself when its rule stops matching."
      action={canEdit && <div className="flex gap-2">
        <Button icon={BookOpen} size="sm" variant="tonal" onClick={() => setLibrary(true)}>Rule library</Button>
        <Button icon={Plus} size="sm" onClick={() => setEditing({ rule: null })}>New rule</Button>
      </div>}>
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {categories.map((c) => <Chip key={c} selected={category === c} onClick={() => setCategory(c)}
          count={c === 'All' ? rules?.length : rules?.filter((r) => categoryOf(r) === c).length}>{c}</Chip>)}
      </div>
      <DataTable columns={columns} rows={shown} loading={isLoading} rowKey={(r) => r.id}
        empty={<EmptyState title="No rules" body="Open the rule library to add ready-made rules, or write your own." />} />
      {library && <RuleLibrary onClose={() => setLibrary(false)} onPick={(preset) => { setLibrary(false); setEditing({ rule: null, preset }) }} />}
      {editing && <RuleDialog rule={editing.rule} preset={editing.preset} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Delete" loading={remove.isPending}
        title="Delete rule?" body={<>“{deleting?.name}” stops evaluating. Alerts it already raised stay.</>}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} />
    </Card>
  )
}
