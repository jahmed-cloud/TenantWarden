import { useEffect, useState, type ReactNode } from 'react'
import { FileText, Globe, Plus, ScrollText, Server, Trash2, Upload } from 'lucide-react'
import {
  useProfile, useSaveProfile, useTenantId,
  type CheckDefinition, type EventChannel, type JournalUnit, type LogSource, type MonitoringProfile,
} from '@/services/api/hooks'
import { useCan } from '@/store/tenantWardenStore'
import { Banner, Button, Card, CodeBlock, EmptyState, IconButton, Pill, Skeleton, cx } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

const LEVELS = ['auto', 'critical', 'error', 'warning', 'info']
const INPUT = 'h-9 w-full rounded-lg border border-outline-variant bg-transparent px-2.5 text-xs text-on-surface outline-none focus:border-primary placeholder:text-on-surface-variant/60'

const list = (v?: string[]) => (v ?? []).join(', ')
const parseList = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cx('block min-w-0', wide && 'sm:col-span-2')}>
      <span className="block text-[11px] font-medium text-on-surface-variant mb-0.5">{label}</span>
      {children}
    </label>
  )
}

function Input({ value, onChange, placeholder, mono, type = 'text' }: { value: string | number | undefined; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string }) {
  return <input type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, mono && 'font-mono')} />
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'bg-surface-container-high')}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Targets({ hosts, tags, onHosts, onTags }: { hosts?: string[]; tags?: string[]; onHosts: (v: string[]) => void; onTags: (v: string[]) => void }) {
  return (
    <>
      <Field label="Only hosts (wildcards, comma-separated)"><Input value={list(hosts)} onChange={(v) => onHosts(parseList(v))} placeholder="all hosts — e.g. web-*, SQL01" /></Field>
      <Field label="Only tags"><Input value={list(tags)} onChange={(v) => onTags(parseList(v))} placeholder="e.g. sql, prod" /></Field>
    </>
  )
}

function Section<T>({ icon: Icon, title, subtitle, items, empty, onAdd, render, canEdit }: {
  icon: typeof FileText; title: string; subtitle: string; items: T[]; empty: string; onAdd: () => void
  render: (item: T, index: number) => ReactNode; canEdit: boolean
}) {
  return (
    <Card title={<span className="flex items-center gap-2"><Icon size={18} className="text-on-surface-variant" />{title}<Pill>{items.length}</Pill></span>} subtitle={subtitle}
      action={canEdit && <Button size="sm" variant="tonal" icon={Plus} onClick={onAdd}>Add</Button>}>
      {items.length === 0 ? <p className="text-xs text-on-surface-variant py-2">{empty}</p> : (
        <div className="space-y-3">{items.map((item, i) => <div key={i} className="rounded-xl bg-surface-container-low p-3">{render(item, i)}</div>)}</div>
      )}
    </Card>
  )
}

const EMPTY: MonitoringProfile = { logs: [], eventChannels: [], journalUnits: [], checks: [] }

export function ProfileEditor() {
  const tenantId = useTenantId()
  const { data, isLoading } = useProfile()
  const save = useSaveProfile()
  const canEdit = useCan('manageAgents')
  const [p, setP] = useState<MonitoringProfile>(EMPTY)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setP({ ...EMPTY, ...Object.fromEntries(Object.entries(data.profile ?? {}).map(([k, v]) => [k, v ?? []])) } as MonitoringProfile)
    setDirty(false)
  }, [data])

  const update = <K extends keyof MonitoringProfile>(key: K, items: MonitoringProfile[K]) => { setP((x) => ({ ...x, [key]: items })); setDirty(true) }
  const edit = <K extends keyof MonitoringProfile>(key: K, i: number, patch: Partial<MonitoringProfile[K][number]>) =>
    update(key, p[key].map((it, j) => (j === i ? { ...it, ...patch } : it)) as MonitoringProfile[K])
  const remove = <K extends keyof MonitoringProfile>(key: K, i: number) => update(key, p[key].filter((_, j) => j !== i) as MonitoringProfile[K])
  const removeButton = (key: keyof MonitoringProfile, i: number) => canEdit && <IconButton icon={Trash2} label="Remove" onClick={() => remove(key, i)} />

  if (isLoading) return <Skeleton rows={4} height="h-24" />

  return (
    <div className="space-y-4">
      <Banner tone="info" icon={Upload} action={canEdit && <Button size="sm" disabled={!dirty} loading={save.isPending}
        onClick={() => save.mutate({ tenantId, profile: p }, { onSuccess: () => setDirty(false) })}>{dirty ? 'Save and push to agents' : 'Saved'}</Button>}>
        What every agent in this tenant monitors beyond the built-ins (system metrics, event log / journal, security inventory, and the logs of
        discovered roles such as SQL Server, IIS, nginx or MySQL). Saving pushes it to connected agents straight away.
        {data?.updatedAt && <span className="block text-xs opacity-80 mt-0.5">Last saved {fmtDateTime(data.updatedAt)} by {data.updatedBy}</span>}
      </Banner>

      <Section icon={FileText} title="Custom log files" canEdit={canEdit} items={p.logs}
        subtitle='New lines that match become events with source "log:<name>". Read every minute; a new file starts at its end.'
        empty="No custom logs. Add one to watch an application log on Windows or Linux."
        onAdd={() => update('logs', [...p.logs, { name: `app${p.logs.length + 1}`, path: '', include: 'ERROR|FATAL', level: 'auto' } as LogSource])}
        render={(l, i) => (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <Field label="Name"><Input value={l.name} onChange={(v) => edit('logs', i, { name: v })} /></Field>
            <Field label="File or pattern" wide><Input mono value={l.path} onChange={(v) => edit('logs', i, { path: v })} placeholder="/var/log/myapp/*.log  or  C:\App\logs\*.log" /></Field>
            <div className="flex items-end gap-1">
              <Field label="Platform"><Select value={l.platform ?? ''} onChange={(v) => edit('logs', i, { platform: v || undefined })}
                options={[{ value: '', label: 'any' }, { value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }, { value: 'macos', label: 'macOS' }]} /></Field>
              {removeButton('logs', i)}
            </div>
            <Field label="Include lines matching (regex)" wide><Input mono value={l.include} onChange={(v) => edit('logs', i, { include: v })} placeholder="all lines" /></Field>
            <Field label="Skip lines matching"><Input mono value={l.exclude} onChange={(v) => edit('logs', i, { exclude: v })} placeholder="e.g. healthcheck" /></Field>
            <Field label="Level"><Select value={l.level ?? 'auto'} onChange={(v) => edit('logs', i, { level: v })} options={LEVELS.map((x) => ({ value: x, label: x === 'auto' ? 'auto (from the text)' : x }))} /></Field>
            <Targets hosts={l.hosts} tags={l.tags} onHosts={(v) => edit('logs', i, { hosts: v })} onTags={(v) => edit('logs', i, { tags: v })} />
          </div>
        )} />

      <Section icon={ScrollText} title="Windows event channels" canEdit={canEdit} items={p.eventChannels}
        subtitle="Extra Event Log channels. Without event IDs only critical, error and warning entries are read."
        empty="No extra channels. Security, System, Application and Defender are always read."
        onAdd={() => update('eventChannels', [...p.eventChannels, { channel: 'Microsoft-Windows-PowerShell/Operational', ids: [4104], level: 'warning' } as EventChannel])}
        render={(c, i) => (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <Field label="Channel" wide><Input mono value={c.channel} onChange={(v) => edit('eventChannels', i, { channel: v })} /></Field>
            <Field label="Event IDs"><Input value={(c.ids ?? []).join(', ')} placeholder="any (errors and warnings)"
              onChange={(v) => edit('eventChannels', i, { ids: parseList(v).map(Number).filter((n) => Number.isInteger(n) && n >= 0) })} /></Field>
            <div className="flex items-end gap-1">
              <Field label="Level"><Select value={c.level ?? 'auto'} onChange={(v) => edit('eventChannels', i, { level: v })} options={LEVELS.map((x) => ({ value: x, label: x }))} /></Field>
              {removeButton('eventChannels', i)}
            </div>
            <Targets hosts={c.hosts} tags={c.tags} onHosts={(v) => edit('eventChannels', i, { hosts: v })} onTags={(v) => edit('eventChannels', i, { tags: v })} />
          </div>
        )} />

      <Section icon={Server} title="Linux journal units" canEdit={canEdit} items={p.journalUnits}
        subtitle="Read a systemd unit's journal at the chosen level (info includes everything)."
        empty="No units. Warnings and errors from every unit are already collected."
        onAdd={() => update('journalUnits', [...p.journalUnits, { unit: 'myapp.service', level: 'info' } as JournalUnit])}
        render={(u, i) => (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <Field label="Unit"><Input mono value={u.unit} onChange={(v) => edit('journalUnits', i, { unit: v })} /></Field>
            <div className="flex items-end gap-1">
              <Field label="Level"><Select value={u.level ?? 'auto'} onChange={(v) => edit('journalUnits', i, { level: v })} options={LEVELS.map((x) => ({ value: x, label: x }))} /></Field>
              {removeButton('journalUnits', i)}
            </div>
            <Targets hosts={u.hosts} tags={u.tags} onHosts={(v) => edit('journalUnits', i, { hosts: v })} onTags={(v) => edit('journalUnits', i, { tags: v })} />
          </div>
        )} />

      <Section icon={Globe} title="Endpoint checks" canEdit={canEdit} items={p.checks}
        subtitle="Agents test that a port answers (TCP), a website responds (HTTP, with certificate expiry) or a name resolves (DNS). Results are on the Network page."
        empty="No checks. Add one to watch a database port, an intranet site or a DNS name from inside your network."
        onAdd={() => update('checks', [...p.checks, { name: `check${p.checks.length + 1}`, type: 'http', target: 'https://', intervalSeconds: 60 } as CheckDefinition])}
        render={(c, i) => (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <Field label="Name"><Input value={c.name} onChange={(v) => edit('checks', i, { name: v })} /></Field>
            <Field label="Type"><Select value={c.type} onChange={(v) => edit('checks', i, { type: v as CheckDefinition['type'] })}
              options={[{ value: 'http', label: 'HTTP(S) URL' }, { value: 'tcp', label: 'TCP port' }, { value: 'dns', label: 'DNS name' }]} /></Field>
            <div className="sm:col-span-2 flex items-end gap-1">
              <Field label="Target"><Input mono value={c.target} onChange={(v) => edit('checks', i, { target: v })}
                placeholder={c.type === 'tcp' ? 'sql01.corp.local:1433' : c.type === 'dns' ? 'intranet.corp.local' : 'https://intranet.corp.local/health'} /></Field>
              {removeButton('checks', i)}
            </div>
            <Field label="Every (seconds)"><Input type="number" value={c.intervalSeconds ?? 60} onChange={(v) => edit('checks', i, { intervalSeconds: Number(v) || undefined })} /></Field>
            <Field label="Timeout (seconds)"><Input type="number" value={c.timeoutSeconds ?? 10} onChange={(v) => edit('checks', i, { timeoutSeconds: Number(v) || undefined })} /></Field>
            {c.type === 'http' && <Field label="Expected status"><Input type="number" value={c.expectStatus ?? ''} placeholder="any < 400" onChange={(v) => edit('checks', i, { expectStatus: Number(v) || undefined })} /></Field>}
            {c.type !== 'tcp' && <Field label={c.type === 'dns' ? 'Must resolve to' : 'Body must contain'}><Input value={c.contains} onChange={(v) => edit('checks', i, { contains: v || undefined })} /></Field>}
            <Targets hosts={c.hosts} tags={c.tags} onHosts={(v) => edit('checks', i, { hosts: v })} onTags={(v) => edit('checks', i, { tags: v })} />
          </div>
        )} />

      <Card title="Defining monitoring on the host instead" subtitle="The same settings can live in the agent's agent.yaml; the portal's profile is merged on top.">
        <CodeBlock label="agent.yaml" code={`agent:
  tags: [sql, prod]              # used by "Only tags" above

monitoring:
  logs:
    - name: myapp                # events: source "log:myapp"
      path: /var/log/myapp/*.log # Windows: 'C:\\App\\logs\\*.log'
      include: "ERROR|FATAL"
      level: auto
  event_channels:
    - channel: Microsoft-Windows-PowerShell/Operational
      ids: [4104]
  journal_units:
    - unit: myapp.service
      level: info
  checks:
    - name: intranet
      type: http
      target: https://intranet.corp.local/health
      interval_seconds: 60`} />
        <p className="text-xs text-on-surface-variant mt-3">
          Query what arrives with <code>AgentEvents | where source startswith "log:"</code>, and alert on it from the rule library
          (“Errors in a custom log”).
        </p>
      </Card>
      {!canEdit && <EmptyState title="Read-only" body="Editing the profile needs the security admin, org admin or super admin role." />}
    </div>
  )
}
