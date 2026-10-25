import { useMemo, useState } from 'react'
import { BellRing, KeyRound, Pencil, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react'
import {
  useApiKeyStatus, useAudit, useChannels, useCreateApiKey, useCreateChannel, useCreateUser, useDeleteChannel, useResetUserPassword,
  useRetention, useRevokeApiKey, useSaveRetention, useTenantId, useTenants, useTestChannel, useUpdateUser, useUsers,
  type Channel, type PlatformUser, type Severity,
} from '@/services/api/hooks'
import { useCan, useTenantWardenStore } from '@/store/tenantWardenStore'
import {
  Banner, Button, Card, CodeBlock, ConfirmDialog, DataTable, Dialog, EmptyState, IconButton, PageHeader, Pill, SearchField,
  SelectField, SeverityBadge, StatusPill, Switch, Tabs, TextField,
} from '@/components/ui'
import { fmtDateTime, timeAgo } from '@/lib/format'

const ROLES = [
  { value: 'super_admin', label: 'Super admin — every tenant and platform settings' },
  { value: 'org_admin', label: 'Org admin — users, channels and settings of one tenant' },
  { value: 'security_admin', label: 'Security admin — rules, remediation, agents' },
  { value: 'soc_analyst', label: 'SOC analyst — triage alerts' },
  { value: 'global_reader', label: 'Global reader — read everything' },
  { value: 'auditor', label: 'Auditor — read plus the audit log' },
  { value: 'helpdesk', label: 'Helpdesk — read identity and devices' },
  { value: 'viewer', label: 'Viewer — read dashboards' },
  { value: 'api_user', label: 'API user — for integrations (API key)' },
]
const roleName = (r: string) => r.replace('_', ' ')

function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+='
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), (n) => chars[n % chars.length]).join('')
}

type Tab = 'users' | 'channels' | 'api' | 'audit' | 'retention'

export function AdminPage() {
  const can = { users: useCan('manageUsers'), channels: useCan('manageChannels'), audit: useCan('viewAudit') }
  const tabs = ([
    { id: 'users', label: 'Users', show: can.users },
    { id: 'channels', label: 'Notifications', show: can.channels },
    { id: 'api', label: 'API access', show: true },
    { id: 'audit', label: 'Audit log', show: can.audit },
    { id: 'retention', label: 'Data retention', show: true },
  ] as { id: Tab; label: string; show: boolean }[]).filter((t) => t.show)
  const [tab, setTab] = useState<Tab>(tabs[0].id)

  return (
    <div>
      <PageHeader title="Admin" subtitle="People, notifications, API access, audit trail and retention" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'users' && <UsersTab />}
      {tab === 'channels' && <ChannelsTab />}
      {tab === 'api' && <ApiTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'retention' && <RetentionTab />}
    </div>
  )
}

// ── Users ────────────────────────────────────────────────────────────────────

function UsersTab() {
  const { data: users, isLoading } = useUsers(true)
  const { data: tenants } = useTenants()
  const me = useTenantWardenStore((s) => s.currentUser)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PlatformUser | null>(null)
  const [reset, setReset] = useState<{ user: PlatformUser; password: string } | null>(null)
  const resetPw = useResetUserPassword()
  const tenantName = (id: string | null) => (id ? tenants?.find((t) => t.id === id)?.displayName ?? 'unknown tenant' : 'All tenants')

  return (
    <Card flush title="Platform users" subtitle="People who can sign in to this portal. New users and resets get a temporary password they must change."
      action={<Button size="sm" icon={UserPlus} onClick={() => setCreating(true)}>New user</Button>}>
      <DataTable rows={users} loading={isLoading} rowKey={(u) => u.id}
        empty={<EmptyState icon={Users} title="No users" />}
        columns={[
          { key: 'user', header: 'User', render: (u) => (
            <div className="min-w-0">
              <div className="font-medium truncate">{u.displayName}{u.id === me?.id && <span className="text-on-surface-variant font-normal"> (you)</span>}</div>
              <div className="text-xs text-on-surface-variant truncate">{u.email}</div>
            </div>
          ) },
          { key: 'role', header: 'Role', render: (u) => <Pill tone={u.role === 'super_admin' ? 'primary' : 'neutral'}>{roleName(u.role)}</Pill> },
          { key: 'tenant', header: 'Tenant', render: (u) => <span className="text-xs">{u.role === 'super_admin' ? 'All tenants' : tenantName(u.tenantId)}</span> },
          { key: 'mfa', header: 'Two-step', render: (u) => <StatusPill status={u.mfaEnabled ? 'enabled' : 'disabled'} label={u.mfaEnabled ? 'on' : 'off'} /> },
          { key: 'active', header: 'Status', render: (u) => <StatusPill status={u.isActive ? 'online' : 'offline'} label={u.isActive ? 'active' : 'disabled'} /> },
          { key: 'login', header: 'Last sign-in', render: (u) => <span className="text-xs text-on-surface-variant">{timeAgo(u.lastLoginAt)}</span> },
          { key: 'x', header: '', align: 'right', render: (u) => u.id !== me?.id && (
            <span className="inline-flex">
              <IconButton icon={Pencil} label="Edit user" onClick={() => setEditing(u)} />
              <IconButton icon={KeyRound} label="Set a temporary password" onClick={() => setReset({ user: u, password: tempPassword() })} />
            </span>
          ) },
        ]} />
      {creating && <UserDialog onClose={() => setCreating(false)} />}
      {editing && <UserDialog user={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!reset} onClose={() => setReset(null)} confirmLabel="Set temporary password" loading={resetPw.isPending}
        title={`Reset ${reset?.user.displayName}'s password?`}
        body={reset && <div className="space-y-3"><p>Their current password stops working. Give them this temporary password; they choose a new one at sign-in.</p><CodeBlock label="Temporary password" code={reset.password} /></div>}
        onConfirm={() => reset && resetPw.mutate({ id: reset.user.id, temporaryPassword: reset.password }, { onSuccess: () => setReset(null) })} />
    </Card>
  )
}

function UserDialog({ user, onClose }: { user?: PlatformUser; onClose: () => void }) {
  const me = useTenantWardenStore((s) => s.currentUser)
  const superAdmin = me?.role === 'super_admin'
  const activeTenant = useTenantId()
  const { data: tenants } = useTenants()
  const create = useCreateUser()
  const update = useUpdateUser()
  const [email, setEmail] = useState(user?.email ?? '')
  const [name, setName] = useState(user?.displayName ?? '')
  const [role, setRole] = useState(user?.role ?? 'soc_analyst')
  const [tenantId, setTenantId] = useState(user?.tenantId ?? (superAdmin ? activeTenant : me?.tenantId ?? ''))
  const [active, setActive] = useState(user?.isActive ?? true)
  const [password] = useState(tempPassword)
  const roles = superAdmin ? ROLES : ROLES.filter((r) => r.value !== 'super_admin')

  function save() {
    const tenant = role === 'super_admin' ? null : tenantId || null
    if (user) update.mutate({ id: user.id, role, isActive: active, ...(superAdmin && tenant ? { tenantId: tenant } : {}) }, { onSuccess: onClose })
    else create.mutate({ email, displayName: name, role, tenantId: tenant, temporaryPassword: password }, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={onClose} wide title={user ? `Edit ${user.displayName}` : 'New user'}
      actions={<>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={create.isPending || update.isPending} disabled={!user && (!email || !name)}>{user ? 'Save' : 'Create user'}</Button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
        {!user && <TextField label="Email" type="email" value={email} onChange={setEmail} autoFocus />}
        {!user && <TextField label="Display name" value={name} onChange={setName} />}
        <div className="sm:col-span-2"><SelectField label="Role" value={role} onChange={setRole} options={roles} /></div>
        {role !== 'super_admin' && superAdmin && (
          <SelectField label="Tenant" value={tenantId} onChange={setTenantId} options={(tenants ?? []).map((t) => ({ value: t.id, label: t.displayName }))}
            hint="Every role except super admin sees exactly one tenant" />
        )}
        {user && (
          <div className="flex items-center gap-3 pt-5">
            <Switch checked={active} onChange={setActive} label="Active" />
            <span className="text-sm text-on-surface">{active ? 'Can sign in' : 'Disabled — cannot sign in'}</span>
          </div>
        )}
        {!user && (
          <div className="sm:col-span-2 space-y-2">
            <CodeBlock label="Temporary password — share it securely" code={password} />
            <p className="text-xs">They must change it at first sign-in.</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ── Notification channels ────────────────────────────────────────────────────

const CHANNEL_TYPES: { value: string; label: string; fields: { key: string; label: string; secret?: boolean; hint?: string }[] }[] = [
  { value: 'teams', label: 'Microsoft Teams', fields: [{ key: 'webhookUrl', label: 'Incoming webhook URL', secret: true, hint: 'Teams channel → Workflows → "Post to a channel when a webhook request is received"' }] },
  { value: 'slack', label: 'Slack', fields: [{ key: 'botToken', label: 'Bot token (xoxb-…)', secret: true }, { key: 'channelId', label: 'Channel ID' }] },
  { value: 'email', label: 'Email', fields: [{ key: 'recipients', label: 'Recipients', hint: 'Comma-separated. Uses the SMTP_* settings from .env' }] },
  { value: 'webhook', label: 'Webhook', fields: [{ key: 'url', label: 'URL' }, { key: 'secret', label: 'Shared secret (sent as X-TenantWarden-Signature)', secret: true }] },
  { value: 'pagerduty', label: 'PagerDuty', fields: [{ key: 'routingKey', label: 'Events API v2 routing key', secret: true }] },
  { value: 'servicenow', label: 'ServiceNow', fields: [{ key: 'instance', label: 'Instance (e.g. contoso.service-now.com)' }, { key: 'user', label: 'User' }, { key: 'pass', label: 'Password', secret: true }, { key: 'assignmentGroup', label: 'Assignment group (optional)' }] },
  { value: 'jira', label: 'Jira', fields: [{ key: 'url', label: 'Site URL' }, { key: 'email', label: 'Account email' }, { key: 'token', label: 'API token', secret: true }, { key: 'projectKey', label: 'Project key' }, { key: 'issueType', label: 'Issue type (default Task)' }] },
]

function ChannelsTab() {
  const { data: channels, isLoading } = useChannels(true)
  const test = useTestChannel()
  const remove = useDeleteChannel()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  return (
    <Card flush title="Notification channels" subtitle="Every new alert at or above a channel's minimum severity is sent to it"
      action={<Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add channel</Button>}>
      <DataTable rows={channels} loading={isLoading} rowKey={(c) => c.id}
        empty={<EmptyState icon={BellRing} title="No channels" body="Add Teams, Slack, email, PagerDuty, ServiceNow, Jira or a webhook." />}
        columns={[
          { key: 'name', header: 'Channel', render: (c) => <div><div className="font-medium">{c.name}</div><div className="text-xs text-on-surface-variant">{CHANNEL_TYPES.find((t) => t.value === c.type)?.label ?? c.type}</div></div> },
          { key: 'min', header: 'Sends from', render: (c) => <SeverityBadge severity={c.minSeverity} /> },
          { key: 'on', header: 'Status', render: (c) => <StatusPill status={c.isEnabled ? 'enabled' : 'disabled'} /> },
          { key: 'created', header: 'Added', render: (c) => <span className="text-xs text-on-surface-variant">{timeAgo(c.createdAt)}</span> },
          { key: 'x', header: '', align: 'right', render: (c) => (
            <span className="inline-flex">
              <Button size="sm" variant="text" icon={Send} loading={test.isPending && test.variables === c.id} onClick={() => test.mutate(c.id)}>Test</Button>
              <IconButton icon={Trash2} label="Remove channel" onClick={() => setDeleting(c)} />
            </span>
          ) },
        ]} />
      {adding && <ChannelDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Remove" loading={remove.isPending}
        title={`Remove ${deleting?.name}?`} body="Alerts stop going to this channel."
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} />
    </Card>
  )
}

function ChannelDialog({ onClose }: { onClose: () => void }) {
  const tenantId = useTenantId()
  const create = useCreateChannel()
  const [type, setType] = useState('teams')
  const [name, setName] = useState('')
  const [minSeverity, setMinSeverity] = useState<Severity>('high')
  const [config, setConfig] = useState<Record<string, string>>({})
  const def = CHANNEL_TYPES.find((t) => t.value === type)!

  function save() {
    const cfg: Record<string, unknown> = Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim()))
    if (type === 'email') cfg.recipients = (config.recipients ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    create.mutate({ tenantId, name: name || def.label, type, config: cfg, minSeverity }, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={onClose} wide title="Add notification channel"
      actions={<><Button variant="text" onClick={onClose}>Cancel</Button><Button onClick={save} loading={create.isPending}>Add channel</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
        <SelectField label="Type" value={type} onChange={(v) => { setType(v); setConfig({}) }} options={CHANNEL_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        <TextField label="Name" value={name} onChange={setName} placeholder={`${def.label} — SOC`} />
        {def.fields.map((f) => (
          <div key={f.key} className="sm:col-span-2">
            <TextField label={f.label} hint={f.hint} type={f.secret ? 'password' : 'text'} value={config[f.key] ?? ''} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
          </div>
        ))}
        <SelectField label="Minimum severity" value={minSeverity} onChange={setMinSeverity}
          options={(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
      </div>
    </Dialog>
  )
}

// ── API access ───────────────────────────────────────────────────────────────

function ApiTab() {
  const { data: status } = useApiKeyStatus()
  const createKey = useCreateApiKey()
  const revoke = useRevokeApiKey()
  const tenantId = useTenantId()
  const role = useTenantWardenStore((s) => s.currentUser?.role)
  const [key, setKey] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  return (
    <Card title="Your API key" subtitle="Call the REST API from scripts and integrations with the X-API-Key header. The key acts with your role and tenant.">
      <div className="space-y-4">
        {key ? (
          <>
            <Banner tone="warning" icon={KeyRound}>Copy the key now — it is stored only as a hash and can't be shown again.</Banner>
            <CodeBlock label="API key" code={key} />
            <CodeBlock label="Example" code={`curl -H "X-API-Key: ${key}" "${location.origin}/api/v1/alerts?tenantId=${tenantId}&status=active"`} />
          </>
        ) : status?.active ? (
          <p>You have an active key, created {fmtDateTime(status.createdAt)}. Rotating it replaces the old key immediately.</p>
        ) : (
          <p>You have no API key. It will have the <b className="text-on-surface">{role?.replace('_', ' ')}</b> role.</p>
        )}
        <div className="flex gap-2">
          <Button icon={KeyRound} loading={createKey.isPending} onClick={() => createKey.mutate(undefined, { onSuccess: (r) => setKey(r.apiKey) })}>
            {status?.active ? 'Rotate key' : 'Create key'}
          </Button>
          {status?.active && <Button variant="outlined" onClick={() => setConfirm(true)}>Revoke</Button>}
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger confirmLabel="Revoke" loading={revoke.isPending}
        title="Revoke API key?" body="Integrations using it stop working at once."
        onConfirm={() => revoke.mutate(undefined, { onSuccess: () => { setConfirm(false); setKey(null) } })} />
    </Card>
  )
}

// ── Audit log ────────────────────────────────────────────────────────────────

function AuditTab() {
  const { data, isLoading } = useAudit(true, 500)
  const [q, setQ] = useState('')
  const rows = useMemo(() => (data ?? []).filter((e) => !q || `${e.userEmail} ${e.action} ${e.resource} ${e.ipAddress}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  return (
    <Card flush title="Audit log" subtitle="Sign-ins and every change made through the portal or API (latest 500)" action={<SearchField value={q} onChange={setQ} placeholder="Filter by user, action, IP" />}>
      <DataTable rows={rows} loading={isLoading} rowKey={(e) => e.id}
        empty={<EmptyState title="No audit entries" />}
        columns={[
          { key: 'at', header: 'Time', render: (e) => <span className="text-xs whitespace-nowrap">{fmtDateTime(e.createdAt)}</span> },
          { key: 'user', header: 'User', render: (e) => <span className="text-xs">{e.userEmail || '—'}</span> },
          { key: 'action', header: 'Action', render: (e) => <span className="font-mono text-xs">{e.action}</span> },
          { key: 'resource', header: 'Resource', render: (e) => <span className="text-xs">{e.resource}{e.resourceId && <span className="text-on-surface-variant font-mono"> {e.resourceId.slice(0, 8)}</span>}</span> },
          { key: 'ip', header: 'IP', render: (e) => <span className="text-xs font-mono">{e.ipAddress ?? '—'}</span> },
          { key: 'ok', header: 'Result', render: (e) => <StatusPill status={e.success ? 'compliant' : 'noncompliant'} label={e.success ? 'ok' : 'refused'} /> },
        ]} />
    </Card>
  )
}

// ── Retention ────────────────────────────────────────────────────────────────

function RetentionTab() {
  const { data } = useRetention()
  const save = useSaveRetention()
  const superAdmin = useTenantWardenStore((s) => s.currentUser?.role === 'super_admin')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const changed = Object.entries(edits).filter(([k, v]) => data?.find((r) => r.key === k)?.days !== Number(v))
  return (
    <Card flush title="Data retention" subtitle="Older rows are pruned daily by the analytics engine. 0 keeps data forever. Applies to every tenant."
      action={superAdmin && <Button size="sm" disabled={!changed.length} loading={save.isPending}
        onClick={() => save.mutate(changed.map(([key, v]) => ({ key, days: Math.max(0, Number(v) || 0) })), { onSuccess: () => setEdits({}) })}>Save changes</Button>}>
      <DataTable rows={data} rowKey={(r) => r.key}
        columns={[
          { key: 'desc', header: 'Data', render: (r) => <div><div className="text-sm">{r.description}</div><div className="text-xs font-mono text-on-surface-variant">{r.key}</div></div> },
          { key: 'days', header: 'Keep for (days)', align: 'right', render: (r) => superAdmin ? (
            <input type="number" min={0} value={edits[r.key] ?? String(r.days)} onChange={(e) => setEdits((x) => ({ ...x, [r.key]: e.target.value }))}
              className="w-24 h-9 rounded-lg border border-outline bg-transparent px-2 text-right text-sm outline-none focus:border-primary" />
          ) : <span>{r.days || 'forever'}</span> },
        ]} />
    </Card>
  )
}

