import { useState } from 'react'
import { useAlerts, useAcknowledgeAlert, useResolveAlert } from '@/services/api/hooks'
import { PageHeader, Panel, SeverityBadge, StatusBadge, Button, DataTable } from '@/components/shared/ui'
import { Filter, Plus, X, ChevronRight } from 'lucide-react'

type AlertDetail = {
  id: string; title: string; description: string; severity: string
  status: string; source: string; createdAt: string; affectedUsers: string[]
  recommendedAction?: string
}

export function AlertsPageFull() {
  const [severity, setSeverity]     = useState('')
  const [status,   setStatus]       = useState('active')
  const [search,   setSearch]       = useState('')
  const [selected, setSelected]     = useState<AlertDetail | null>(null)
  const [showRule, setShowRule]      = useState(false)

  const { data, isLoading }  = useAlerts({ severity, status, search })
  const acknowledge          = useAcknowledgeAlert()
  const resolve              = useResolveAlert()

  const columns = [
    { key: 'severity', header: 'Sev',    width: '80px',  render: (r: any) => <SeverityBadge severity={r.severity} /> },
    { key: 'title',    header: 'Alert',  width: '38%',   render: (r: any) => (
      <div>
        <div className="font-medium text-gray-900 dark:text-gray-100">{r.title}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{r.source} · {r.category}</div>
      </div>
    )},
    { key: 'status',   header: 'Status', width: '110px', render: (r: any) => <StatusBadge status={r.status} /> },
    { key: 'assignedTo', header: 'Owner', width: '100px', render: (r: any) => <span className="text-gray-500 dark:text-gray-400">{r.assignedTo ?? '—'}</span> },
    { key: 'createdAt',header: 'Time',   width: '90px',  render: (r: any) => <span className="text-gray-500">{new Date(r.createdAt).toLocaleTimeString()}</span> },
    { key: 'actions',  header: '',       width: '140px', render: (r: any) => (
      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
        {r.status === 'active' && (
          <Button size="sm" className="text-[11px]" onClick={() => acknowledge.mutate({ id: r.id })}>Ack</Button>
        )}
        {r.status !== 'resolved' && (
          <Button size="sm" className="text-[11px]" onClick={() => resolve.mutate({ id: r.id, resolution: 'Resolved' })}>Resolve</Button>
        )}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alert center"
        subtitle={`${data?.total ?? 0} alerts · ${data?.items.filter(a => a.status === 'active').length ?? 0} active`}
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setShowRule(true)}><Plus size={12} />Create rule</Button>
            <Button variant="primary" size="sm">Acknowledge all</Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5">
          <Filter size={12} className="text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search alerts..."
            className="text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 w-40 placeholder:text-gray-400 dark:placeholder:text-gray-600"
          />
        </div>

        <div className="flex gap-1">
          {['', 'critical', 'high', 'medium', 'low'].map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                severity === s
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="ml-auto text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 outline-none"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Main table */}
      <Panel>
        <DataTable
          columns={columns as any}
          data={data?.items ?? []}
          keyField="id"
          loading={isLoading}
          onRowClick={row => setSelected(row as AlertDetail)}
        />
        {data && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500">
            <span>{data.total} total</span>
            <div className="flex gap-1">
              <Button size="sm">← Prev</Button>
              <span className="px-2.5 py-1.5 text-xs">Page {data.page} / {data.totalPages}</span>
              <Button size="sm">Next →</Button>
            </div>
          </div>
        )}
      </Panel>

      {/* Alert detail slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setSelected(null)} />
          <div className="w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Alert detail</span>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <SeverityBadge severity={selected.severity} />
                <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-2">{selected.title}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{selected.description}</p>
              </div>
              <div className="space-y-2 text-xs">
                {[
                  ['Source',   selected.source],
                  ['Status',   selected.status],
                  ['Time',     new Date(selected.createdAt).toLocaleString()],
                  ['Affected', selected.affectedUsers?.join(', ') || 'None'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-gray-500 w-20 flex-shrink-0">{k}</span>
                    <span className="text-gray-700 dark:text-gray-300">{v}</span>
                  </div>
                ))}
              </div>
              {selected.recommendedAction && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-lg">
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Recommended action</div>
                  <p className="text-xs text-blue-800 dark:text-blue-200/80 leading-relaxed">{selected.recommendedAction}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button variant="primary" size="sm" className="flex-1 justify-center"
                  onClick={() => { acknowledge.mutate({ id: selected.id }); setSelected(null) }}>
                  Acknowledge
                </Button>
                <Button variant="danger" size="sm" className="flex-1 justify-center"
                  onClick={() => { resolve.mutate({ id: selected.id, resolution: 'Resolved' }); setSelected(null) }}>
                  Resolve
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rule builder modal */}
      {showRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowRule(false)} />
          <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Create alert rule</h2>
              <button onClick={() => setShowRule(false)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"><X size={16} /></button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-gray-500 dark:text-gray-400 block mb-1">Rule name</label>
                <input placeholder="e.g. High risky user spike" className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-600" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-gray-500 dark:text-gray-400 block mb-1">Metric</label>
                  <select className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-2 text-gray-800 dark:text-gray-200 outline-none">
                    <option>Risky users</option>
                    <option>Failed sign-ins</option>
                    <option>Non-compliant devices</option>
                    <option>Active alerts</option>
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 dark:text-gray-400 block mb-1">Operator</label>
                  <select className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-2 text-gray-800 dark:text-gray-200 outline-none">
                    <option>&gt; greater than</option>
                    <option>&gt;= at least</option>
                    <option>= equals</option>
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 dark:text-gray-400 block mb-1">Threshold</label>
                  <input type="number" placeholder="10" className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 dark:text-gray-400 block mb-1">Window (minutes)</label>
                  <input type="number" defaultValue="15" className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-gray-800 dark:text-gray-200 outline-none" />
                </div>
                <div>
                  <label className="text-gray-500 dark:text-gray-400 block mb-1">Severity</label>
                  <select className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-2 text-gray-800 dark:text-gray-200 outline-none">
                    <option>critical</option>
                    <option>high</option>
                    <option>medium</option>
                    <option>low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-gray-500 dark:text-gray-400 block mb-1">Notify channels</label>
                <div className="flex gap-2 flex-wrap">
                  {['Teams', 'Slack', 'Email', 'PagerDuty'].map(ch => (
                    <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" defaultChecked={ch !== 'PagerDuty'} className="rounded" />
                      <span className="text-gray-700 dark:text-gray-300">{ch}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="primary" size="sm" className="flex-1 justify-center">Create rule</Button>
              <Button size="sm" onClick={() => setShowRule(false)} className="flex-1 justify-center">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
