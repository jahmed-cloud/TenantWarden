import { useState } from 'react'
import { Building2, CheckCircle2, Pause, Pencil, Play, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import {
  useCollectNow, useCreateTenant, useDeleteTenant, useTenants, useUpdateTenant, type Tenant, type TenantInput,
} from '@/services/api/hooks'
import { useCan, useTenantWardenStore } from '@/store/tenantWardenStore'
import { Banner, Button, Card, Chip, ConfirmDialog, Dialog, EmptyState, IconButton, PageHeader, Pill, Skeleton, StatusPill, TextField, cx } from '@/components/ui'
import { GRAPH_PERMISSIONS, MODULES } from '@/lib/permissions'
import { fmtNumber, timeAgo } from '@/lib/format'

export function TenantsPage() {
  const { data: tenants, isLoading } = useTenants()
  const canManage = useCan('manageTenants')
  const active = useTenantWardenStore((s) => s.activeTenant)
  const setActive = useTenantWardenStore((s) => s.setActiveTenant)
  const collect = useCollectNow()
  const update = useUpdateTenant()
  const [connecting, setConnecting] = useState(false)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [deleting, setDeleting] = useState<Tenant | null>(null)
  const remove = useDeleteTenant()

  return (
    <div>
      <PageHeader title="Tenants" subtitle="Microsoft 365 tenants this platform collects from"
        actions={canManage && <Button icon={Plus} onClick={() => setConnecting(true)}>Connect tenant</Button>} />

      {isLoading && <Skeleton rows={2} height="h-28" />}
      {tenants?.length === 0 && (
        <Card>
          <EmptyState icon={Building2} title="Connect your first Microsoft 365 tenant"
            body={<>Register an app in Microsoft Entra ID, grant it the read permissions listed in the next step, and paste its IDs here. TenantWarden then collects every 15 minutes.</>}
            action={canManage ? <Button icon={Plus} onClick={() => setConnecting(true)}>Connect tenant</Button> : <span className="text-xs">Ask a super admin to connect a tenant.</span>} />
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {tenants?.map((t) => (
          <Card key={t.id} className={cx(t.id === active?.id && 'ring-2 ring-primary')}>
            <div className="flex items-start gap-4">
              <span className="w-12 h-12 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center text-base font-medium shrink-0">
                {t.displayName.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-medium text-on-surface">{t.displayName}</h2>
                  <StatusPill status={t.status} />
                  {t.id === active?.id && <Pill tone="primary"><CheckCircle2 size={12} />selected</Pill>}
                </div>
                <div className="text-xs text-on-surface-variant mt-0.5">{t.domain} · <span className="font-mono">{t.azureTenantId}</span></div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
                  <span><b className="font-medium">{fmtNumber(t.userCount)}</b> <span className="text-on-surface-variant">users</span></span>
                  <span><span className="text-on-surface-variant">Last collection</span> {timeAgo(t.lastSyncAt)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(t.enabledModules.length ? MODULES.filter((m) => t.enabledModules.includes(m.id)) : MODULES).map((m) => <Pill key={m.id}>{m.label}</Pill>)}
                </div>
              </div>
            </div>
            {t.lastSyncError && <div className="mt-4"><Banner tone="error" icon={TriangleAlert}>{t.lastSyncError}</Banner></div>}
            <div className="flex flex-wrap items-center justify-end gap-1 mt-4 -mb-1">
              {t.id !== active?.id && <Button size="sm" variant="tonal" onClick={() => setActive({ id: t.id, displayName: t.displayName })}>Select</Button>}
              <Button size="sm" variant="text" icon={RefreshCw} loading={collect.isPending} onClick={() => collect.mutate()}>Collect now</Button>
              {canManage && <>
                <IconButton icon={t.status === 'paused' ? Play : Pause} label={t.status === 'paused' ? 'Resume collection' : 'Pause collection'}
                  onClick={() => update.mutate({ id: t.id, status: t.status === 'paused' ? 'active' : 'paused' })} />
                <IconButton icon={Pencil} label="Edit tenant" onClick={() => setEditing(t)} />
                <IconButton icon={Trash2} label="Remove tenant" onClick={() => setDeleting(t)} />
              </>}
            </div>
          </Card>
        ))}
      </div>

      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
      {editing && <EditDialog tenant={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Remove tenant" loading={remove.isPending}
        title={`Remove ${deleting?.displayName}?`}
        body="All collected data for this tenant — alerts, identity, device and agent records — is deleted, and users assigned to it lose access until you move them. To stop collecting but keep the data, pause the tenant instead. The app registration in Entra ID is not touched."
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} />
    </div>
  )
}

function ModulePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <span className="block text-xs font-medium text-on-surface-variant mb-1">Collect</span>
      <div className="flex flex-wrap gap-2">
        {MODULES.map((m) => (
          <Chip key={m.id} selected={value.includes(m.id)} onClick={() => onChange(value.includes(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id])}>
            {m.label}
          </Chip>
        ))}
      </div>
      <span className="block text-[11px] text-on-surface-variant mt-1">{MODULES.filter((m) => value.includes(m.id)).map((m) => m.detail).join(' · ') || 'Pick at least one'}</span>
    </div>
  )
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateTenant()
  const setActive = useTenantWardenStore((s) => s.setActiveTenant)
  const [f, setF] = useState<TenantInput>({ displayName: '', domain: '', azureTenantId: '', clientId: '', clientSecret: '', enabledModules: ['identity', 'intune', 'defender'] })
  const set = <K extends keyof TenantInput>(k: K, v: TenantInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const valid = f.displayName && f.azureTenantId && f.clientId && f.clientSecret && f.enabledModules.length

  return (
    <Dialog open onClose={onClose} wide title="Connect a Microsoft 365 tenant"
      actions={<>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate(
          { ...f, domain: f.domain || `${f.displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}.onmicrosoft.com` },
          { onSuccess: (t) => { setActive({ id: t.id, displayName: t.displayName }); onClose() } })}>Connect</Button>
      </>}>
      <div className="space-y-5 pb-2">
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>In the Entra admin center, open <b className="text-on-surface">App registrations → New registration</b> (single tenant).</li>
          <li>Under <b className="text-on-surface">API permissions</b>, add these Microsoft Graph <b className="text-on-surface">application</b> permissions and grant admin consent.</li>
          <li>Create a client secret under <b className="text-on-surface">Certificates &amp; secrets</b> and paste its value below. It is stored encrypted (AES-256-GCM).</li>
        </ol>
        <div className="rounded-2xl bg-surface-container p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {GRAPH_PERMISSIONS.map((p) => (
            <div key={p.permission} className="text-xs">
              <span className="font-mono text-on-surface">{p.permission}</span>
              <span className="text-on-surface-variant"> — {p.why}{p.optional && ' (optional, for response actions)'}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Display name" value={f.displayName} onChange={(v) => set('displayName', v)} placeholder="Contoso Ltd" autoFocus />
          <TextField label="Primary domain (optional)" value={f.domain} onChange={(v) => set('domain', v)} placeholder="contoso.com" />
          <TextField label="Directory (tenant) ID" value={f.azureTenantId} onChange={(v) => set('azureTenantId', v.trim())} mono />
          <TextField label="Application (client) ID" value={f.clientId} onChange={(v) => set('clientId', v.trim())} mono />
          <div className="sm:col-span-2"><TextField label="Client secret value" type="password" value={f.clientSecret} onChange={(v) => set('clientSecret', v)} /></div>
          <div className="sm:col-span-2"><ModulePicker value={f.enabledModules} onChange={(v) => set('enabledModules', v)} /></div>
        </div>
      </div>
    </Dialog>
  )
}

function EditDialog({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const update = useUpdateTenant()
  const [name, setName] = useState(tenant.displayName)
  const known = tenant.enabledModules.filter((m) => MODULES.some((x) => x.id === m))
  const [modules, setModules] = useState(known.length ? known : MODULES.map((m) => m.id))
  return (
    <Dialog open onClose={onClose} title="Edit tenant"
      actions={<>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button disabled={!name || !modules.length} loading={update.isPending}
          onClick={() => update.mutate({ id: tenant.id, displayName: name, enabledModules: modules }, { onSuccess: onClose })}>Save</Button>
      </>}>
      <div className="space-y-4 pb-2">
        <TextField label="Display name" value={name} onChange={setName} autoFocus />
        <ModulePicker value={modules} onChange={setModules} />
      </div>
    </Dialog>
  )
}
