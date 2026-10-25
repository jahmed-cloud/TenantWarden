import { useMemo, useState } from 'react'
import { Check, ChevronDown, Filter, FolderTree, Monitor, X } from 'lucide-react'
import { useAgentGroups, useAllAgents, useScope, useTenantId } from '@/services/api/hooks'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { Banner, Button, Dialog, Menu, MenuItem, SearchField, cx } from '@/components/ui'

/** Top-bar control: which machines Agents, Workloads and Network show. */
export function MachineScopePicker() {
  const tenantId = useTenantId()
  const scope = useTenantWardenStore((s) => s.machineScope)
  const setScope = useTenantWardenStore((s) => s.setMachineScope)
  const info = useScope()
  const { data: groups } = useAgentGroups()
  const { data: all } = useAllAgents()
  const [choosing, setChoosing] = useState(false)
  if (!all?.length) return null

  const isGroup = (g: string) => scope.kind === 'group' && scope.tenantId === tenantId && scope.group === g
  return (
    <>
      <Menu align="left" trigger={(toggle) => (
        <button type="button" onClick={toggle} title="Machines shown on Agents, Workloads and Network"
          className={cx('state-layer h-10 pl-3 pr-2 rounded-full flex items-center gap-2 max-w-full',
            info.active ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high')}>
          <Filter size={15} className="shrink-0" />
          {/* Icon and count only on phones, where the top bar has no room for the label */}
          <span className="hidden sm:inline text-sm font-medium truncate">{info.label}</span>
          {info.active && <span className="text-xs opacity-80 shrink-0">{info.count}/{info.total}</span>}
          <ChevronDown size={16} className="shrink-0 opacity-70" />
        </button>
      )}>
        {(close) => (
          <>
            <MenuItem icon={Monitor} active={!info.active} onClick={() => { setScope({ kind: 'all' }); close() }}>All machines ({all.length})</MenuItem>
            {!!groups?.length && <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wider text-on-surface-variant">Groups</div>}
            {groups?.map((g) => (
              <MenuItem key={g.name} icon={FolderTree} active={isGroup(g.name)} onClick={() => { setScope({ kind: 'group', tenantId, group: g.name }); close() }}>
                {g.name} ({g.agents})
              </MenuItem>
            ))}
            <div className="my-1 border-t border-outline-variant" />
            <MenuItem icon={Check} active={scope.kind === 'machines' && info.active} onClick={() => { setChoosing(true); close() }}>Choose machines…</MenuItem>
            {!groups?.length && <p className="px-4 py-2 text-[11px] text-on-surface-variant max-w-[240px]">Create groups on the Agents page: select machines, then Add to group.</p>}
          </>
        )}
      </Menu>
      {choosing && <ChooseMachinesDialog onClose={() => setChoosing(false)} />}
    </>
  )
}

function ChooseMachinesDialog({ onClose }: { onClose: () => void }) {
  const tenantId = useTenantId()
  const scope = useTenantWardenStore((s) => s.machineScope)
  const setScope = useTenantWardenStore((s) => s.setMachineScope)
  const { data: all } = useAllAgents()
  const info = useScope()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() =>
    new Set(info.active && info.param && info.param !== 'none' ? info.param.split(',') : scope.kind === 'machines' ? scope.ids : []))
  const rows = useMemo(() => (all ?? []).filter((a) =>
    !q || [a.hostname, a.osName, a.ipAddress, a.groups, a.tags].some((v) => v?.toLowerCase().includes(q.toLowerCase()))), [all, q])
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Dialog open onClose={onClose} wide title="Choose machines"
      actions={<>
        <Button variant="text" onClick={() => { setScope({ kind: 'all' }); onClose() }}>Show all</Button>
        <Button disabled={!picked.size} onClick={() => { setScope({ kind: 'machines', tenantId, ids: [...picked] }); onClose() }}>
          Show {picked.size || ''} machine{picked.size === 1 ? '' : 's'}
        </Button>
      </>}>
      <div className="space-y-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={q} onChange={setQ} placeholder="Filter by name, OS, IP, group" />
          <Button size="sm" variant="text" onClick={() => setPicked(new Set([...picked, ...rows.map((r) => r.agentId)]))}>Select all shown</Button>
          <Button size="sm" variant="text" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto rounded-2xl bg-surface-container-low divide-y divide-outline-variant/60">
          {rows.map((a) => (
            <li key={a.agentId}>
              <label className="state-layer flex items-center gap-3 px-4 py-2.5 cursor-pointer">
                <input type="checkbox" aria-label={a.hostname} checked={picked.has(a.agentId)} onChange={() => toggle(a.agentId)} className="w-4 h-4 accent-[rgb(var(--primary))]" />
                <span className={cx('w-2 h-2 rounded-full', a.status === 'online' ? 'bg-success' : 'bg-outline')} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-on-surface truncate">{a.hostname}</span>
                  <span className="block text-[11px] text-on-surface-variant truncate">{a.osName ?? a.platform}{a.groups ? ` · ${a.groups.split(',').join(', ')}` : ''}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}

/** Shown on scoped pages so a filtered view is never mistaken for the whole fleet. */
export function ScopeBanner() {
  const info = useScope()
  const setScope = useTenantWardenStore((s) => s.setMachineScope)
  if (!info.active) return null
  return (
    <div className="mb-4">
      <Banner tone="primary" icon={Filter} action={<Button size="sm" variant="text" icon={X} onClick={() => setScope({ kind: 'all' })}>Show all</Button>}>
        Showing <b>{info.label.replace(/^Group: /, 'group ')}</b> — {info.count} of {info.total} machines
      </Banner>
    </div>
  )
}
