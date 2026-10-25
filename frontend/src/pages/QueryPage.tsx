import { useEffect, useRef, useState } from 'react'
import { BellPlus, ChevronRight, Download, LineChart as ChartLine, Play, Table2 } from 'lucide-react'
import { errorMessage } from '@/services/api/client'
import { useCatalogue, useRunQuery, useTenantId, type QueryResult } from '@/services/api/hooks'
import { useCan } from '@/store/tenantWardenStore'
import { RuleDialog } from '@/components/RuleDialog'
import { ResultChart, ResultTable, chartable } from '@/components/query'
import { Banner, Button, Card, PageHeader, Pill, Segmented, Tabs, cx } from '@/components/ui'
import { downloadCsv, stamp } from '@/lib/format'

const RANGES = [
  { value: 60, label: '1 h' }, { value: 1440, label: '24 h' }, { value: 10080, label: '7 d' }, { value: 43200, label: '30 d' }, { value: 0, label: 'All' },
]

const EXAMPLES = [
  { name: 'Errors by host', query: 'AgentEvents\n| where level in ("error", "critical")\n| summarize count() by hostname\n| sort by count_ desc' },
  { name: 'Event volume over time', query: 'AgentEvents\n| summarize count() by bin(occurred_at, 1h), level' },
  { name: 'Busiest hosts', query: 'Agents\n| where status == "online"\n| project hostname, os, cpu, memory, disk, net_mbps\n| sort by cpu desc' },
  { name: 'Pending security updates', query: 'Agents\n| where inventory.pending_security_updates > 0\n| project hostname, os, inventory.pending_security_updates' },
  { name: 'SQL Server instances', query: 'Workloads\n| where type == "sqlserver"\n| project hostname, name, status, version, details.edition, details.sql_agent' },
  { name: 'Failed logins', query: 'AgentEvents\n| where message matches regex "^[0-9]+ failed"\n| project occurred_at, hostname, source, message\n| sort by occurred_at desc' },
  { name: 'Custom log errors', query: 'AgentEvents\n| where source startswith "log:"\n| summarize count() by source, level' },
  { name: 'Failing or slow checks', query: 'Checks\n| where ok == false or latency_ms > 500\n| project name, hostname, target, latency_ms, error' },
  { name: 'Check latency over time', query: 'CheckHistory\n| summarize avg(latency_ms) by bin(checked_at, 15m), name' },
  { name: 'Risky sign-ins by country', query: 'SignIns\n| summarize count() by country\n| sort by count_ desc' },
  { name: 'Open alerts by source', query: 'Alerts\n| where status != "resolved"\n| summarize count() by source, severity' },
  { name: 'Non-compliant devices', query: 'Devices\n| where compliance != "compliant"\n| project device, user, os, compliance, last_sync' },
]

const STORAGE_KEY = 'tenantwarden-query'

export function QueryPage() {
  const tenantId = useTenantId()
  const { data: catalogue } = useCatalogue()
  const run = useRunQuery()
  const canRule = useCan('editRules')
  const editor = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? EXAMPLES[0].query } catch { return EXAMPLES[0].query }
  })
  const [range, setRange] = useState(1440)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [view, setView] = useState<'table' | 'chart'>('table')
  const [openDataset, setOpenDataset] = useState<string | null>('AgentEvents')
  const [ruleOpen, setRuleOpen] = useState(false)

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, query) } catch { /* private mode */ } }, [query])

  function execute(text = query) {
    run.mutate({ tenantId, query: text, windowMinutes: range || null, limit: 1000 }, {
      onSuccess: (r) => { setResult(r); setView(chartable(r) && view === 'chart' ? 'chart' : 'table') },
      onError: () => setResult(null),
    })
  }

  function insert(text: string) {
    const el = editor.current
    if (!el) return setQuery((q) => q + text)
    const { selectionStart: a, selectionEnd: b } = el
    const next = query.slice(0, a) + text + query.slice(b)
    setQuery(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length) })
  }

  const err = run.error as { response?: { data?: { position?: number } } } | null
  const position = err?.response?.data?.position

  return (
    <div>
      <PageHeader title="Query" subtitle="Search events, hosts, workloads, checks, alerts, sign-ins and devices with a KQL-style language — and turn any query into an alert rule" />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
        <div className="space-y-4 min-w-0">
          <Card>
            <textarea ref={editor} value={query} onChange={(e) => setQuery(e.target.value)} rows={7} spellCheck={false}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); execute() } }}
              className="w-full rounded-xl border border-outline-variant bg-surface-container-low text-on-surface px-4 py-3 font-mono text-[13px] leading-relaxed outline-none focus:border-primary resize-y" />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button icon={Play} loading={run.isPending} disabled={!tenantId} onClick={() => execute()}>Run</Button>
              <span className="text-xs text-on-surface-variant hidden sm:inline">Ctrl + Enter</span>
              <div className="flex-1" />
              <span className="text-xs text-on-surface-variant">Time range</span>
              <Segmented value={range} onChange={setRange} options={RANGES} />
            </div>
            {run.isError && (
              <div className="mt-3">
                <Banner tone="error">{errorMessage(run.error, 'The query failed')}{typeof position === 'number' && <> (at character {position + 1})</>}</Banner>
              </div>
            )}
          </Card>

          {result && (
            <Card flush
              title={<span className="flex items-center gap-2">Results <Pill>{result.rows.length.toLocaleString()}{result.truncated ? '+' : ''} rows</Pill><Pill>{result.elapsedMs} ms</Pill></span>}
              action={<div className="flex items-center gap-2">
                {canRule && <Button size="sm" variant="tonal" icon={BellPlus} onClick={() => setRuleOpen(true)}>Create alert rule</Button>}
                <Button size="sm" variant="text" icon={Download} disabled={!result.rows.length}
                  onClick={() => downloadCsv(result.rows, `query-${stamp()}.csv`)}>CSV</Button>
              </div>}>
              <div className="px-5">
                <Tabs value={view} onChange={setView} tabs={[{ id: 'table', label: 'Table' }, { id: 'chart', label: chartable(result) ? 'Chart' : 'Chart (n/a)' }]} />
              </div>
              {view === 'table' ? <ResultTable result={result} /> : <div className="px-5 pb-5"><ResultChart result={result} /></div>}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Examples">
            <ul className="-mx-2">
              {EXAMPLES.map((ex) => (
                <li key={ex.name}>
                  <button type="button" onClick={() => { setQuery(ex.query); execute(ex.query) }}
                    className="state-layer w-full text-left px-2 py-1.5 rounded-lg text-sm text-on-surface flex items-center gap-2">
                    {ex.query.includes('bin(') ? <ChartLine size={14} className="text-on-surface-variant" /> : <Table2 size={14} className="text-on-surface-variant" />}
                    {ex.name}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Datasets" subtitle="Click a name to insert it">
            <ul className="-mx-2 text-sm">
              {catalogue?.datasets.map((d) => (
                <li key={d.name}>
                  <div className="flex items-center">
                    <button type="button" onClick={() => setOpenDataset(openDataset === d.name ? null : d.name)} className="state-layer p-1 rounded-md" aria-label={`Fields of ${d.name}`}>
                      <ChevronRight size={14} className={cx('transition-transform text-on-surface-variant', openDataset === d.name && 'rotate-90')} />
                    </button>
                    <button type="button" onClick={() => insert(d.name)} className="state-layer px-1.5 py-1 rounded-md font-mono text-xs text-primary" title={d.description}>{d.name}</button>
                  </div>
                  {openDataset === d.name && (
                    <div className="pl-7 pb-2">
                      <p className="text-[11px] text-on-surface-variant mb-1">{d.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {d.fields.map((f) => (
                          <button key={f.name} type="button" onClick={() => insert(f.name)} title={`${f.type}${f.description ? ` — ${f.description}` : ''}`}
                            className="state-layer px-1.5 py-0.5 rounded-md bg-surface-container-high font-mono text-[11px] text-on-surface">
                            {f.name}<span className="text-on-surface-variant"> {f.type === 'number' ? '#' : f.type === 'time' ? '⏱' : f.type === 'bool' ? '?' : f.type === 'json' ? '{}' : ''}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Syntax">
            <ul className="text-xs text-on-surface-variant space-y-1 font-mono">
              <li>| where a == "x" and b &gt; 5</li>
              <li>| where msg contains "fail" / startswith / matches regex "…"</li>
              <li>| where level in ("error", "critical")</li>
              <li>| where occurred_at &gt; ago(2h)</li>
              <li>| summarize count(), avg(cpu) by hostname</li>
              <li>| summarize count() by bin(occurred_at, 1h)</li>
              <li>| project a, b · distinct a · count</li>
              <li>| sort by count_ desc · take 50 · top 10 by cpu</li>
              <li>inventory.key · details.key for nested values</li>
            </ul>
          </Card>
        </div>
      </div>

      {ruleOpen && <RuleDialog onClose={() => setRuleOpen(false)}
        preset={{ name: 'Custom query rule', metric: 'custom_query', query, operator: 'gt', threshold: 0, windowMinutes: range || 60, severity: 'medium' }} />}
    </div>
  )
}
