import { useState } from 'react'
import { Ban, Check, Fingerprint, Globe2, KeyRound, LogOut, ShieldAlert, Users } from 'lucide-react'
import {
  useAuthMethods, useCaPolicies, useIdentitySummary, useMfaStatus, useRemediate, useRiskyUsers, useSignInCountries,
  useSignIns, useSignInTrend, useTenantId, type RiskyUser,
} from '@/services/api/hooks'
import { useCan } from '@/store/tenantWardenStore'
import { DonutChart, HBarChart, SignInTrendChart } from '@/components/charts'
import {
  Card, Chip, ConfirmDialog, DataTable, EmptyState, IconButton, PageHeader, Pagination, Segmented, SEVERITY_COLOR,
  StatCard, StatusPill, type Column,
} from '@/components/ui'
import { fmtDateTime, fmtNumber, fmtPct, timeAgo } from '@/lib/format'

const CATEGORY: Record<string, { label: string; color: string }> = {
  phish_resistant: { label: 'Phishing-resistant', color: '#2e7d32' },
  phishable:       { label: 'Phishable MFA', color: '#f9a825' },
  single_factor:   { label: 'Single factor only', color: '#c62828' },
  none:            { label: 'No method', color: '#78909c' },
}

const METHOD_LABEL: Record<string, string> = {
  passKeyDeviceBound: 'Passkey (device-bound)', passKeyDeviceBoundAuthenticator: 'Passkey in Authenticator',
  windowsHelloForBusiness: 'Windows Hello for Business', fido2: 'FIDO2 security key',
  microsoftAuthenticatorPush: 'Authenticator push', softwareOneTimePasscode: 'Software OTP', hardwareOneTimePasscode: 'Hardware OTP',
  mobilePhone: 'SMS / voice', alternateMobilePhone: 'Alternate phone', email: 'Email', none: 'Nothing registered',
}

type Action = 'dismiss' | 'confirm-compromised' | 'revoke-sessions'
const ACTIONS: Record<Action, { title: string; body: string; label: string; danger?: boolean }> = {
  'dismiss': { title: 'Dismiss user risk?', label: 'Dismiss risk',
    body: 'Entra ID Identity Protection marks the risk as dismissed. Use this when the activity was the user themself.' },
  'confirm-compromised': { title: 'Confirm compromised?', label: 'Confirm compromised', danger: true,
    body: 'Entra ID sets the user to high risk, so risk-based Conditional Access policies apply at once (block or force a password change).' },
  'revoke-sessions': { title: 'Revoke all sessions?', label: 'Revoke sessions', danger: true,
    body: 'Every refresh token for this user is invalidated, signing them out of Microsoft 365 apps on all devices within minutes.' },
}

export function IdentityPage() {
  const tenantId = useTenantId()
  const { data: s, isLoading } = useIdentitySummary()
  const [riskFilter, setRiskFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const { data: risky, isLoading: riskyLoading } = useRiskyUsers(riskFilter || undefined, page)
  const { data: trend } = useSignInTrend(14)
  const { data: countries } = useSignInCountries(30)
  const { data: signIns } = useSignIns()
  const { data: mfa } = useMfaStatus()
  const [scope, setScope] = useState<'all_users' | 'privileged_users'>('all_users')
  const { data: methods } = useAuthMethods(scope)
  const { data: policies } = useCaPolicies()
  const canRemediate = useCan('remediate')
  const remediate = useRemediate()
  const [pending, setPending] = useState<{ user: RiskyUser; action: Action } | null>(null)

  const categories = (mfa?.byCategory ?? []).filter((c) => c.scope === scope)

  const userColumns: Column<RiskyUser>[] = [
    { key: 'user', header: 'User', render: (u) => (
      <div className="min-w-0">
        <div className="font-medium truncate">{u.displayName || u.userPrincipalName}</div>
        <div className="text-xs text-on-surface-variant truncate">{u.userPrincipalName}</div>
      </div>
    ) },
    { key: 'risk', header: 'Risk', render: (u) => <StatusPill status={u.riskLevel === 'high' ? 'active' : u.riskLevel === 'medium' ? 'degraded' : 'acknowledged'} label={u.riskLevel} /> },
    { key: 'detail', header: 'Why', render: (u) => <span className="text-xs">{u.riskDetail ?? '—'}</span> },
    { key: 'where', header: 'Last seen from', render: (u) => <span className="text-xs text-on-surface-variant">{[u.countryCode, u.ipAddress].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'updated', header: 'Updated', render: (u) => <span className="text-xs text-on-surface-variant">{timeAgo(u.riskLastUpdatedAt)}</span> },
    ...(canRemediate ? [{ key: 'act', header: 'Respond', align: 'right' as const, render: (u: RiskyUser) => (
      <span className="inline-flex">
        <IconButton icon={Check} label="Dismiss risk" onClick={() => setPending({ user: u, action: 'dismiss' })} />
        <IconButton icon={ShieldAlert} label="Confirm compromised" onClick={() => setPending({ user: u, action: 'confirm-compromised' })} />
        <IconButton icon={LogOut} label="Revoke sessions" onClick={() => setPending({ user: u, action: 'revoke-sessions' })} />
      </span>
    ) }] : []),
  ]

  return (
    <div>
      <PageHeader title="Identity" subtitle="Microsoft Entra ID: risky users, risky sign-ins, MFA registration and Conditional Access" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        <StatCard label="Users" icon={Users} value={fmtNumber(s?.totalUsers)} loading={isLoading} detail="in the directory" />
        <StatCard label="Risky users" icon={Fingerprint} tone={s?.riskyHigh ? 'error' : 'primary'} loading={isLoading}
          value={fmtNumber(s?.riskyUsers)} detail={s && <>{s.riskyHigh} high · {s.riskyMedium} medium</>} />
        <StatCard label="Risky sign-ins (24 h)" icon={Globe2} tone={s?.riskySignIns24h ? 'warning' : 'primary'} loading={isLoading} value={fmtNumber(s?.riskySignIns24h)} />
        <StatCard label="MFA registered" icon={KeyRound} tone={(s?.mfaPercent ?? 100) >= 90 ? 'success' : 'warning'} loading={isLoading}
          value={fmtPct(s?.mfaPercent)} detail={mfa?.privileged.total ? <>admins {fmtPct(mfa.privileged.percent)}</> : 'needs AuditLog.Read.All'} />
        <StatCard label="Conditional Access" icon={Ban} loading={isLoading} value={s ? `${s.caPolicies}/${s.caPoliciesTotal}` : '—'} detail="policies enabled" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Risky sign-ins per day" subtitle="Last 14 days by risk level (Entra ID P2)">
          <SignInTrendChart data={trend} />
        </Card>
        <Card title="Where risky sign-ins come from" subtitle="Last 30 days — all risk levels vs high risk">
          <HBarChart data={(countries ?? []).slice(0, 10).map((c) => ({ label: c.country, value: c.total, secondary: c.high }))}
            name="All risk levels" secondaryName="High risk" empty="No risky sign-ins in the last 30 days" />
        </Card>
      </div>

      <Card flush className="mb-4" title="Risky users" subtitle={canRemediate ? 'Respond directly in Entra ID: dismiss, confirm compromised, or revoke sessions' : 'Your role can view risky users; responding needs Security admin'}
        action={<div className="flex gap-1">
          {['', 'high', 'medium', 'low'].map((r) => <Chip key={r} selected={riskFilter === r} onClick={() => { setRiskFilter(r); setPage(1) }}>{r || 'All'}</Chip>)}
        </div>}>
        <DataTable columns={userColumns} rows={risky?.items} loading={riskyLoading} rowKey={(u) => u.id}
          empty={<EmptyState icon={Fingerprint} title="No risky users" body="Identity Protection reports nobody at risk. This needs an Entra ID P2 licence and IdentityRiskyUser.Read.All." />} />
        {risky && <Pagination page={risky.page} totalPages={risky.totalPages} total={risky.total} onChange={setPage} />}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Card title="Strongest MFA method per user" subtitle="From the authentication-methods registration report"
          action={<Segmented value={scope} onChange={setScope} options={[{ value: 'all_users', label: 'Everyone' }, { value: 'privileged_users', label: 'Admins' }]} />}>
          <DonutChart
            data={categories.map((c) => ({ name: CATEGORY[c.category]?.label ?? c.category, value: c.users, color: CATEGORY[c.category]?.color }))}
            centerValue={fmtPct(scope === 'all_users' ? mfa?.allUsers.percent : mfa?.privileged.percent)} centerLabel="have MFA"
            empty="No registration data yet (needs AuditLog.Read.All)" />
        </Card>
        <Card title="Registered methods" subtitle="Users whose strongest method is each type">
          <HBarChart data={(methods ?? []).map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.userCount, color: CATEGORY[m.category]?.color }))}
            name="Users" empty="No registration data yet" />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card flush title="Recent risky sign-ins" subtitle="Last 7 days">
          <DataTable rows={signIns?.slice(0, 15)} rowKey={(r) => r.id}
            empty={<EmptyState icon={Globe2} title="No risky sign-ins" />}
            columns={[
              { key: 'user', header: 'User', render: (r) => <span className="text-xs">{r.userPrincipalName}</span> },
              { key: 'risk', header: 'Risk', render: (r) => (
                <span className="inline-flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_COLOR[r.riskLevel] ?? SEVERITY_COLOR.info }} />{r.riskLevel}</span>
              ) },
              { key: 'where', header: 'From', render: (r) => <span className="text-xs text-on-surface-variant">{[r.city, r.countryCode].filter(Boolean).join(', ') || '—'}{r.ipAddress && ` · ${r.ipAddress}`}</span> },
              { key: 'app', header: 'App', render: (r) => <span className="text-xs">{r.appDisplayName ?? '—'}</span> },
              { key: 'at', header: 'When', align: 'right', render: (r) => <span className="text-xs text-on-surface-variant" title={fmtDateTime(r.occurredAt)}>{timeAgo(r.occurredAt)}</span> },
            ]} />
        </Card>
        <Card flush title="Conditional Access policies" subtitle="What each policy enforces">
          <DataTable rows={policies} rowKey={(p) => p.id}
            empty={<EmptyState icon={Ban} title="No policies collected" body="Needs Policy.Read.All." />}
            columns={[
              { key: 'name', header: 'Policy', render: (p) => <span className="text-sm">{p.name}</span> },
              { key: 'state', header: 'State', render: (p) => <StatusPill status={p.state} label={p.state === 'enabledForReportingButNotEnforced' ? 'report-only' : p.state} /> },
              { key: 'grants', header: 'Enforces', render: (p) => (
                <span className="flex flex-wrap gap-1">
                  {p.requiresMfa && <StatusPill status="enabled" label="MFA" />}
                  {p.requiresCompliantDevice && <StatusPill status="enabled" label="compliant device" />}
                  {p.blocks && <StatusPill status="error" label="block" />}
                  {!p.requiresMfa && !p.requiresCompliantDevice && !p.blocks && <span className="text-xs text-on-surface-variant">other controls</span>}
                </span>
              ) },
            ]} />
        </Card>
      </div>

      <ConfirmDialog open={!!pending} onClose={() => setPending(null)}
        title={pending ? ACTIONS[pending.action].title : ''} confirmLabel={pending ? ACTIONS[pending.action].label : ''}
        danger={pending ? ACTIONS[pending.action].danger : false} loading={remediate.isPending}
        body={pending && <><p className="mb-2"><b className="text-on-surface">{pending.user.displayName || pending.user.userPrincipalName}</b></p><p>{ACTIONS[pending.action].body}</p></>}
        onConfirm={() => pending && remediate.mutate({ tenantId, userId: pending.user.id, action: pending.action }, { onSuccess: () => setPending(null) })} />
    </div>
  )
}
