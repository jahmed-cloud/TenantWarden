import { useMemo, useState } from 'react'
import { BookOpen, Check, FlaskConical, Plus } from 'lucide-react'
import {
  useCatalogue, useRules, useRunQuery, useSaveRule, useTenantId,
  type AlertRule, type QueryResult, type RuleInput, type RuleMetric, type Severity,
} from '@/services/api/hooks'
import { errorMessage } from '@/services/api/client'
import { Banner, Button, Chip, Dialog, Pill, SelectField, SeverityBadge, Switch, TextField, cx } from '@/components/ui'

export const OPERATORS = [
  { value: 'gt', label: 'is above' }, { value: 'gte', label: 'is at least' }, { value: 'lt', label: 'is below' },
  { value: 'lte', label: 'is at most' }, { value: 'eq', label: 'equals' }, { value: 'neq', label: 'is not' },
]
export const opLabel = (op: string) => OPERATORS.find((o) => o.value === op)?.label ?? op
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CATEGORY_ORDER = ['Identity', 'Security', 'Devices', 'Endpoints', 'Network', 'Workloads', 'Platform', 'Custom']

/** "When Hosts with CPU above a limit (95 %) is above 0" */
export function ruleSummary(rule: Pick<AlertRule, 'metric' | 'operator' | 'threshold' | 'param' | 'windowMinutes'>, metrics?: RuleMetric[]) {
  const m = metrics?.find((x) => x.metric === rule.metric)
  if (rule.metric === 'custom_query') return `Custom query ${opLabel(rule.operator)} ${rule.threshold} in ${rule.windowMinutes} min`
  const param = m?.param ? ` (${rule.param ?? m.param.default}${m.param.unit === '%' ? '%' : ` ${m.param.unit ?? ''}`.trimEnd()})` : ''
  return `${m?.label ?? rule.metric}${param} ${opLabel(rule.operator)} ${rule.threshold}${m?.unit === '%' ? '%' : ''}${m?.windowed ? ` in ${rule.windowMinutes} min` : ''}`
}

function MetricSelect({ metrics, value, onChange }: { metrics: RuleMetric[]; value: string; onChange: (v: string) => void }) {
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: metrics.filter((m) => m.category === c) })).filter((g) => g.items.length)
  return (
    <label className="block">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">When</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 rounded-lg border border-outline bg-surface-container-high text-on-surface px-3 text-sm outline-none focus:border-primary">
        {groups.map((g) => (
          <optgroup key={g.c} label={g.c}>
            {g.items.map((m) => <option key={m.metric} value={m.metric}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function QueryTestResult({ result, operator, threshold }: { result: QueryResult; operator: string; threshold: number }) {
  const cmp = (v: number) => ({ gt: v > threshold, gte: v >= threshold, lt: v < threshold, lte: v <= threshold, eq: v === threshold, neq: v !== threshold } as Record<string, boolean>)[operator]
  if (result.summarized && result.groupBy.length && result.aggregates.length) {
    const agg = result.aggregates[0]
    const hits = result.rows.filter((r) => typeof r[agg] === 'number' && cmp(r[agg] as number))
    return (
      <Banner tone={hits.length ? 'warning' : 'success'}>
        {hits.length ? <>Would fire now for {hits.length} of {result.rows.length} groups: {hits.slice(0, 5).map((r) => `${result.groupBy.map((g) => r[g]).join(' / ')} (${r[agg]})`).join(', ')}</>
          : <>Would not fire now — no group has {agg} {opLabel(operator)} {threshold} ({result.rows.length} groups)</>}
      </Banner>
    )
  }
  const value = result.summarized && result.aggregates.length ? Number(result.rows[0]?.[result.aggregates[0]] ?? 0) : result.rows.length
  return <Banner tone={cmp(value) ? 'warning' : 'success'}>Current value {value}{result.truncated ? '+' : ''} — the rule {cmp(value) ? 'would fire now' : 'would not fire now'}.</Banner>
}

export function RuleDialog({ rule, preset, onClose }: { rule?: AlertRule | null; preset?: Partial<RuleInput>; onClose: () => void }) {
  const tenantId = useTenantId()
  const metrics = useCatalogue().data?.metrics ?? []
  const save = useSaveRule()
  const test = useRunQuery()
  const [testResult, setTestResult] = useState<QueryResult | null>(null)
  const [form, setForm] = useState<RuleInput>(() => {
    const base: RuleInput = {
      name: rule?.name ?? '', description: rule?.description ?? '', severity: rule?.severity ?? 'high',
      metric: rule?.metric ?? 'risky_users_high', operator: rule?.operator ?? 'gt', threshold: rule?.threshold ?? 0,
      windowMinutes: rule?.windowMinutes ?? 60, cooldownMinutes: rule?.cooldownMinutes ?? 60, isEnabled: rule?.isEnabled ?? true,
      param: rule?.param ?? null, query: rule?.query ?? null,
    }
    return { ...base, ...preset }
  })
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const def = metrics.find((m) => m.metric === form.metric)
  const isQuery = form.metric === 'custom_query'

  function chooseMetric(metric: string) {
    const m = metrics.find((x) => x.metric === metric)
    if (!m) return
    setTestResult(null)
    setForm((f) => ({
      ...f, metric,
      // A new rule takes the metric's defaults; an existing one keeps what was set
      ...(rule ? {} : {
        name: !f.name || metrics.some((x) => x.defaults.name === f.name) ? m.defaults.name : f.name,
        operator: m.defaults.operator, threshold: m.defaults.threshold, severity: m.defaults.severity,
        windowMinutes: m.defaults.window ?? f.windowMinutes, cooldownMinutes: m.defaults.cooldown ?? f.cooldownMinutes,
      }),
      param: m.param ? (f.metric === metric ? f.param : m.param.default) : null,
      query: metric === 'custom_query' ? (f.query ?? 'AgentEvents\n| where level == "error"\n| summarize count() by hostname') : null,
    }))
  }

  return (
    <Dialog open onClose={onClose} wide title={rule ? 'Edit rule' : 'New alert rule'}
      actions={<>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!form.name.trim() || (isQuery && !form.query?.trim())}
          onClick={() => save.mutate({ id: rule?.id, tenantId, rule: form }, { onSuccess: onClose })}>Save rule</Button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
        <div className="sm:col-span-2"><TextField label="Name" value={form.name} onChange={(v) => set('name', v)} autoFocus /></div>
        <div className="sm:col-span-2">
          <MetricSelect metrics={metrics} value={form.metric} onChange={chooseMetric} />
          {def && <p className="text-xs text-on-surface-variant mt-1">{def.description}</p>}
        </div>

        {def?.param && (
          <TextField label={`${def.param.label}${def.param.unit ? ` (${def.param.unit})` : ''}`} type="number"
            value={String(form.param ?? def.param.default)} onChange={(v) => set('param', v === '' ? null : Number(v))} />
        )}

        {isQuery && (
          <div className="sm:col-span-2 space-y-2">
            <label className="block">
              <span className="block text-xs font-medium text-on-surface-variant mb-1">Query</span>
              <textarea value={form.query ?? ''} onChange={(e) => { set('query', e.target.value); setTestResult(null) }} rows={6} spellCheck={false}
                className="w-full rounded-lg border border-outline bg-surface-container-highest/40 text-on-surface px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-primary" />
            </label>
            <p className="text-[11px] text-on-surface-variant">
              Without <code>summarize</code> the value is the number of rows. With <code>summarize … by</code> every group is compared with the threshold and
              each matching group is listed in the alert. The window below limits time-based datasets.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="tonal" icon={FlaskConical} loading={test.isPending}
                onClick={() => test.mutate({ tenantId, query: form.query ?? '', windowMinutes: form.windowMinutes, limit: 1000 },
                  { onSuccess: setTestResult, onError: () => setTestResult(null) })}>Test query</Button>
              {test.isError && <span className="text-xs text-error">{errorMessage(test.error, 'Query failed')}</span>}
            </div>
            {testResult && <QueryTestResult result={testResult} operator={form.operator} threshold={form.threshold} />}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Condition" value={form.operator} onChange={(v) => set('operator', v)} options={OPERATORS} />
          <TextField label={def?.unit === '%' ? 'Value (%)' : 'Value'} type="number" value={String(form.threshold)} onChange={(v) => set('threshold', Number(v) || 0)} />
        </div>
        {def?.windowed && <TextField label="Window (minutes)" type="number" value={String(form.windowMinutes)} onChange={(v) => set('windowMinutes', Number(v) || 1)} hint="Counts events in this sliding window" />}
        <TextField label="Cooldown (minutes)" type="number" value={String(form.cooldownMinutes)} onChange={(v) => set('cooldownMinutes', Number(v) || 1)} hint="Minimum gap between two alerts from this rule" />
        <SelectField label="Alert severity" value={form.severity} onChange={(v) => set('severity', v)}
          options={SEVERITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
        <div className="sm:col-span-2"><TextField label="Description (shown in the alert)" value={form.description ?? ''} onChange={(v) => set('description', v)} /></div>
        <div className="flex items-center gap-3">
          <Switch checked={form.isEnabled} onChange={(v) => set('isEnabled', v)} label="Enabled" />
          <span className="text-sm text-on-surface">Enabled</span>
        </div>
        <div className="sm:col-span-2">
          <Pill tone="info">Alert when {ruleSummary({ ...form, param: form.param ?? null }, metrics)}</Pill>
        </div>
      </div>
    </Dialog>
  )
}

/** Every metric and ready-made query rule, grouped by area, one click to start a rule. */
export function RuleLibrary({ onPick, onClose }: { onPick: (preset: Partial<RuleInput>) => void; onClose: () => void }) {
  const { data } = useCatalogue()
  const rules = useRules().data ?? []
  const [category, setCategory] = useState('All')
  const inUse = useMemo(() => new Set(rules.map((r) => r.metric === 'custom_query' ? `q:${r.name}` : r.metric)), [rules])
  const items = useMemo(() => {
    if (!data) return []
    const metricItems = data.metrics.filter((m) => m.metric !== 'custom_query').map((m) => ({
      key: m.metric, name: m.defaults.name, category: m.category, description: m.description, severity: m.defaults.severity,
      used: inUse.has(m.metric), query: null as string | null,
      preset: {
        name: m.defaults.name, metric: m.metric, operator: m.defaults.operator, threshold: m.defaults.threshold, severity: m.defaults.severity,
        windowMinutes: m.defaults.window ?? 60, cooldownMinutes: m.defaults.cooldown ?? 60, param: m.param?.default ?? null, description: m.description,
      } as Partial<RuleInput>,
    }))
    const queryItems = data.templates.map((t) => ({
      key: `q:${t.name}`, name: t.name, category: t.category, description: t.description, severity: t.severity, used: inUse.has(`q:${t.name}`), query: t.query,
      preset: { name: t.name, metric: 'custom_query', operator: t.operator, threshold: t.threshold, severity: t.severity, windowMinutes: t.window, query: t.query, description: t.description } as Partial<RuleInput>,
    }))
    return [...metricItems, ...queryItems]
  }, [data, inUse])
  const categories = ['All', ...CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c))]
  const shown = items.filter((i) => category === 'All' || i.category === category)

  return (
    <Dialog open onClose={onClose} wide title="Rule library" actions={<Button variant="text" onClick={onClose}>Close</Button>}>
      <div className="space-y-4 pb-2">
        <p>{items.length} ready-made rules for Microsoft 365, hosts, networks and workloads. Pick one to adjust it before saving.</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => <Chip key={c} selected={category === c} onClick={() => setCategory(c)} count={c === 'All' ? items.length : items.filter((i) => i.category === c).length}>{c}</Chip>)}
        </div>
        <ul className="divide-y divide-outline-variant/60 rounded-2xl bg-surface-container-low">
          {shown.map((i) => (
            <li key={i.key} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-on-surface">{i.name}</span>
                  <SeverityBadge severity={i.severity} />
                  {i.query && <Pill tone="primary"><BookOpen size={11} />query</Pill>}
                  {i.used && <Pill tone="success"><Check size={11} />in use</Pill>}
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">{i.description}</p>
                {i.query && <pre className={cx('mt-1.5 text-[11px] font-mono whitespace-pre-wrap text-on-surface-variant')}>{i.query}</pre>}
              </div>
              <Button size="sm" variant="tonal" icon={Plus} onClick={() => onPick(i.preset)}>Add</Button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
