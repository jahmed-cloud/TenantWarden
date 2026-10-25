import { useEffect, useState } from 'react'
import { Laptop2, Lock, ShieldCheck, ShieldX } from 'lucide-react'
import { useDevices, useDeviceSummary, type Device } from '@/services/api/hooks'
import { DonutChart, HBarChart } from '@/components/charts'
import { Card, Chip, DataTable, EmptyState, PageHeader, Pagination, SearchField, StatCard, StatusPill, type Column } from '@/components/ui'
import { fmtNumber, pct, timeAgo } from '@/lib/format'

export function DevicesPage() {
  const { data: s, isLoading } = useDeviceSummary()
  const [compliance, setCompliance] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const { data: devices, isLoading: devicesLoading } = useDevices({ compliance, search: debounced, page })

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t) }, [search])
  useEffect(() => setPage(1), [compliance, debounced])

  const total = s ? s.compliance.compliant + s.compliance.nonCompliant : 0
  const encTotal = s ? s.encryption.encrypted + s.encryption.notEncrypted : 0

  const columns: Column<Device>[] = [
    { key: 'name', header: 'Device', render: (d) => (
      <div className="min-w-0">
        <div className="font-medium truncate">{d.deviceName}</div>
        <div className="text-xs text-on-surface-variant truncate">{d.userPrincipalName ?? 'no primary user'}</div>
      </div>
    ) },
    { key: 'os', header: 'OS', render: (d) => <span className="text-xs">{d.operatingSystem} <span className="text-on-surface-variant">{d.osVersion}</span></span> },
    { key: 'compliance', header: 'Compliance', render: (d) => <StatusPill status={d.complianceState} /> },
    { key: 'enc', header: 'Encryption', render: (d) => d.encryptionState === 'encrypted'
      ? <StatusPill status="compliant" label="encrypted" /> : <StatusPill status="noncompliant" label={d.encryptionState ?? 'unknown'} /> },
    { key: 'owner', header: 'Ownership', render: (d) => <span className="text-xs text-on-surface-variant">{d.ownerType ?? '—'}</span> },
    { key: 'sync', header: 'Last check-in', align: 'right', render: (d) => <span className="text-xs text-on-surface-variant">{timeAgo(d.lastSyncDateTime ?? d.syncedAt)}</span> },
  ]

  return (
    <div>
      <PageHeader title="Devices" subtitle="Intune managed devices: compliance, encryption and operating systems" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Managed devices" icon={Laptop2} loading={isLoading} value={fmtNumber(total)} />
        <StatCard label="Compliant" icon={ShieldCheck} tone="success" loading={isLoading} value={fmtNumber(s?.compliance.compliant)}
          detail={total ? `${pct(s!.compliance.compliant, total)}% of devices` : undefined} onClick={() => setCompliance('compliant')} />
        <StatCard label="Non-compliant" icon={ShieldX} tone={s?.compliance.nonCompliant ? 'error' : 'success'} loading={isLoading}
          value={fmtNumber(s?.compliance.nonCompliant)} onClick={() => setCompliance('noncompliant')} />
        <StatCard label="Encrypted" icon={Lock} tone={encTotal && s!.encryption.notEncrypted ? 'warning' : 'success'} loading={isLoading}
          value={encTotal ? `${pct(s!.encryption.encrypted, encTotal)}%` : '—'} detail={s && `${s.encryption.notEncrypted} not encrypted`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card title="Compliance">
          <DonutChart centerValue={total ? `${pct(s!.compliance.compliant, total)}%` : undefined} centerLabel="compliant" empty="No devices collected (needs DeviceManagementManagedDevices.Read.All)"
            data={s ? [{ name: 'Compliant', value: s.compliance.compliant, color: '#2e7d32' }, { name: 'Non-compliant', value: s.compliance.nonCompliant, color: '#c62828' }] : []} />
        </Card>
        <Card title="Disk encryption">
          <DonutChart centerValue={encTotal ? `${pct(s!.encryption.encrypted, encTotal)}%` : undefined} centerLabel="encrypted" empty="No devices collected"
            data={s ? [{ name: 'Encrypted', value: s.encryption.encrypted, color: '#1f5bd8' }, { name: 'Not encrypted', value: s.encryption.notEncrypted, color: '#ef6c00' }] : []} />
        </Card>
        <Card title="Operating systems">
          <HBarChart data={(s?.byOs ?? []).map((o) => ({ label: o.os, value: o.count }))} name="Devices" empty="No devices collected" />
        </Card>
      </div>

      <Card flush title="Device inventory"
        action={<div className="flex flex-wrap items-center gap-2">
          {[['', 'All'], ['compliant', 'Compliant'], ['noncompliant', 'Non-compliant']].map(([v, l]) => <Chip key={v} selected={compliance === v} onClick={() => setCompliance(v)}>{l}</Chip>)}
          <SearchField value={search} onChange={setSearch} placeholder="Search name or user" />
        </div>}>
        <DataTable columns={columns} rows={devices?.items} loading={devicesLoading} rowKey={(d) => d.id}
          empty={<EmptyState icon={Laptop2} title="No devices match" />} />
        {devices && <Pagination page={devices.page} totalPages={devices.totalPages} total={devices.total} onChange={setPage} />}
      </Card>
    </div>
  )
}
