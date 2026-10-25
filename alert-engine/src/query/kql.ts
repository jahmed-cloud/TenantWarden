// A small KQL-style query language compiled to parameterised PostgreSQL.
//
//   AgentEvents
//   | where level in ("error", "critical") and occurred_at > ago(1h)
//   | summarize count() by hostname, source
//   | sort by count_ desc
//   | take 20
//
// Stages: where · summarize … by … (count, dcount, avg, sum, min, max; bin(time, 1h)) · project ·
// distinct · sort/order by · take/limit · top N by · count. Each stage wraps the previous one as a
// subquery. Only dataset fields from datasets.ts can be referenced and every value becomes a bind
// parameter, so user text never reaches the SQL. $1 is always the tenant id.
import { DATASET_BY_NAME, DATASETS, type FieldType } from './datasets.js'

export class QueryError extends Error {
  constructor(message: string, public position?: number) { super(message) }
}

// ── Tokens ───────────────────────────────────────────────────────────────────

type TokKind = 'id' | 'str' | 'num' | 'dur' | 'op' | 'eof'
interface Tok { k: TokKind; v: string; pos: number; n?: number }

const SYMBOLS = ['==', '!=', '<>', '=~', '!~', '>=', '<=', '>', '<', '=', '|', '(', ')', ',', '.', '!']
const DURATION_UNITS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '"' || c === "'") {
      const start = i++
      let v = ''
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) { v += src[i + 1]; i += 2 } else v += src[i++]
      }
      if (i >= src.length) throw new QueryError('A string is missing its closing quote', start)
      i++
      toks.push({ k: 'str', v, pos: start })
      continue
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!
      const num = Number(m[0])
      const rest = src.slice(i + m[0].length)
      const unit = /^(ms|s|m|h|d)(?![A-Za-z0-9_])/.exec(rest)
      if (unit) {
        toks.push({ k: 'dur', v: m[0] + unit[1], pos: i, n: num * DURATION_UNITS[unit[1]] })
        i += m[0].length + unit[1].length
      } else {
        toks.push({ k: 'num', v: m[0], pos: i, n: num })
        i += m[0].length
      }
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i))!
      // A trailing "-" belongs to an operator, not the identifier (e.g. "project-away" isn't supported)
      const v = m[0].replace(/-+$/, '')
      toks.push({ k: 'id', v, pos: i })
      i += v.length
      continue
    }
    const sym = SYMBOLS.find((s) => src.startsWith(s, i))
    if (!sym) throw new QueryError(`Unexpected character "${c}"`, i)
    toks.push({ k: 'op', v: sym, pos: i })
    i += sym.length
  }
  toks.push({ k: 'eof', v: '', pos: src.length })
  return toks
}

// ── Syntax tree ──────────────────────────────────────────────────────────────

interface FieldRef { path: string[]; pos: number }
type Val =
  | { k: 'str'; v: string } | { k: 'num'; v: number } | { k: 'bool'; v: boolean }
  | { k: 'ago'; secs: number } | { k: 'now' } | { k: 'datetime'; v: string }
type Expr =
  | { kind: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; e: Expr }
  | { kind: 'cmp'; field: FieldRef; op: string; value: Val | Val[]; pos: number }
  | { kind: 'fn'; fn: string; field: FieldRef }
interface Agg { fn: string; field?: FieldRef; alias?: string }
interface ByItem { field: FieldRef; binSecs?: number; alias?: string }
type Stage =
  | { kind: 'where'; expr: Expr }
  | { kind: 'summarize'; aggs: Agg[]; by: ByItem[] }
  | { kind: 'project'; items: { field: FieldRef; alias?: string }[] }
  | { kind: 'distinct'; fields: FieldRef[] }
  | { kind: 'sort'; keys: { field: FieldRef; desc: boolean }[] }
  | { kind: 'take'; n: number }
  | { kind: 'top'; n: number; key: { field: FieldRef; desc: boolean } }

const CMP_WORDS = ['contains', 'has', 'startswith', 'endswith', 'matches', 'in']
const AGG_FNS = ['count', 'dcount', 'avg', 'sum', 'min', 'max']
const PREDICATES = ['isnull', 'isnotnull', 'isempty', 'isnotempty']

class Parser {
  private i = 0
  constructor(private toks: Tok[]) {}

  private peek(o = 0) { return this.toks[this.i + o] }
  private next() { return this.toks[this.i++] }
  private isId(word: string, o = 0) { const t = this.peek(o); return t.k === 'id' && t.v.toLowerCase() === word }
  private isOp(op: string, o = 0) { const t = this.peek(o); return t.k === 'op' && t.v === op }
  private fail(msg: string, t = this.peek()): never { throw new QueryError(t.k === 'eof' ? `${msg} (the query ended early)` : `${msg} near "${t.v}"`, t.pos) }
  private expectOp(op: string) { if (!this.isOp(op)) this.fail(`Expected "${op}"`); return this.next() }
  private expectId(word?: string) {
    const t = this.peek()
    if (t.k !== 'id' || (word && t.v.toLowerCase() !== word)) this.fail(word ? `Expected "${word}"` : 'Expected a name')
    return this.next()
  }
  private int(): number {
    const t = this.next()
    if (t.k !== 'num' || !Number.isInteger(t.n)) this.fail('Expected a whole number', t)
    return t.n!
  }

  parse(): { dataset: string; datasetPos: number; stages: Stage[] } {
    const ds = this.expectId()
    const stages: Stage[] = []
    while (this.isOp('|')) {
      this.next()
      stages.push(this.stage())
    }
    if (this.peek().k !== 'eof') this.fail('Expected "|" before the next stage')
    return { dataset: ds.v, datasetPos: ds.pos, stages }
  }

  private stage(): Stage {
    const t = this.expectId()
    switch (t.v.toLowerCase()) {
      case 'where': case 'filter': return { kind: 'where', expr: this.orExpr() }
      case 'summarize': return this.summarize()
      case 'count': return { kind: 'summarize', aggs: [{ fn: 'count' }], by: [] }
      case 'project': {
        const items: { field: FieldRef; alias?: string }[] = []
        do {
          if (this.peek().k === 'id' && this.isOp('=', 1)) {
            const alias = this.next().v; this.next()
            items.push({ alias, field: this.field() })
          } else items.push({ field: this.field() })
        } while (this.isOp(',') && this.next())
        return { kind: 'project', items }
      }
      case 'distinct': {
        const fields: FieldRef[] = []
        do fields.push(this.field()); while (this.isOp(',') && this.next())
        return { kind: 'distinct', fields }
      }
      case 'sort': case 'order': {
        this.expectId('by')
        const keys: { field: FieldRef; desc: boolean }[] = []
        do keys.push({ field: this.field(), desc: this.direction() }); while (this.isOp(',') && this.next())
        return { kind: 'sort', keys }
      }
      case 'take': case 'limit': return { kind: 'take', n: this.int() }
      case 'top': {
        const n = this.int()
        this.expectId('by')
        return { kind: 'top', n, key: { field: this.field(), desc: this.direction() } }
      }
      default:
        return this.fail('Unknown stage: use where, summarize, project, distinct, sort by, take, top or count', t)
    }
  }

  private direction(): boolean {
    if (this.isId('asc')) { this.next(); return false }
    if (this.isId('desc')) { this.next(); return true }
    return true // KQL sorts descending by default
  }

  private summarize(): Stage {
    const aggs: Agg[] = []
    do {
      let alias: string | undefined
      if (this.peek().k === 'id' && this.isOp('=', 1)) { alias = this.next().v; this.next() }
      const fn = this.expectId()
      const name = fn.v.toLowerCase()
      if (!AGG_FNS.includes(name)) this.fail(`Unknown aggregation: use ${AGG_FNS.map((f) => `${f}()`).join(', ')}`, fn)
      this.expectOp('(')
      const field = name === 'count' ? undefined : this.field()
      this.expectOp(')')
      aggs.push({ fn: name, field, alias })
    } while (this.isOp(',') && this.next())

    const by: ByItem[] = []
    if (this.isId('by')) {
      this.next()
      do {
        let alias: string | undefined
        if (this.peek().k === 'id' && this.isOp('=', 1)) { alias = this.next().v; this.next() }
        if (this.isId('bin') && this.isOp('(', 1)) {
          this.next(); this.next()
          const field = this.field()
          this.expectOp(',')
          const d = this.next()
          if (d.k !== 'dur') this.fail('bin() needs a duration such as 5m, 1h or 1d', d)
          this.expectOp(')')
          by.push({ field, binSecs: Math.max(1, Math.round(d.n!)), alias })
        } else by.push({ field: this.field(), alias })
      } while (this.isOp(',') && this.next())
    }
    return { kind: 'summarize', aggs, by }
  }

  private orExpr(): Expr {
    let left = this.andExpr()
    while (this.isId('or')) { this.next(); left = { kind: 'or', left, right: this.andExpr() } }
    return left
  }
  private andExpr(): Expr {
    let left = this.unary()
    while (this.isId('and')) { this.next(); left = { kind: 'and', left, right: this.unary() } }
    return left
  }
  private unary(): Expr {
    if (this.isId('not') && !this.isOp('(', 1)) { this.next(); return { kind: 'not', e: this.unary() } }
    if (this.isId('not') && this.isOp('(', 1)) { this.next(); this.next(); const e = this.orExpr(); this.expectOp(')'); return { kind: 'not', e } }
    if (this.isOp('(')) { this.next(); const e = this.orExpr(); this.expectOp(')'); return e }
    const t = this.peek()
    if (t.k === 'id' && PREDICATES.includes(t.v.toLowerCase()) && this.isOp('(', 1)) {
      this.next(); this.next()
      const field = this.field()
      this.expectOp(')')
      return { kind: 'fn', fn: t.v.toLowerCase(), field }
    }
    return this.comparison()
  }

  private comparison(): Expr {
    const field = this.field()
    const at = this.peek()
    let op: string
    if (at.k === 'op' && ['==', '!=', '<>', '=~', '!~', '>=', '<=', '>', '<', '='].includes(at.v)) {
      op = this.next().v
      if (op === '=') op = '=='
      if (op === '<>') op = '!='
    } else if (at.k === 'op' && at.v === '!' && this.peek(1).k === 'id' && CMP_WORDS.includes(this.peek(1).v.toLowerCase())) {
      this.next()
      op = '!' + this.next().v.toLowerCase()
    } else if (at.k === 'id' && CMP_WORDS.includes(at.v.toLowerCase())) {
      op = this.next().v.toLowerCase()
      if (op === 'matches' && this.isId('regex')) this.next()
    } else {
      return this.fail('Expected a comparison (==, !=, >, <, contains, startswith, endswith, matches regex, in)', at)
    }
    if (op === 'has') op = 'contains'
    if (op === '!has') op = '!contains'

    if (op === 'in' || op === '!in') {
      this.expectOp('(')
      const values: Val[] = []
      do values.push(this.value()); while (this.isOp(',') && this.next())
      this.expectOp(')')
      return { kind: 'cmp', field, op, value: values, pos: at.pos }
    }
    return { kind: 'cmp', field, op, value: this.value(), pos: at.pos }
  }

  private value(): Val {
    const t = this.next()
    if (t.k === 'str') return { k: 'str', v: t.v }
    if (t.k === 'num') return { k: 'num', v: t.n! }
    if (t.k === 'op' && t.v === '!' ) this.fail('Unexpected "!"', t)
    if (t.k === 'id') {
      const w = t.v.toLowerCase()
      if (w === 'true' || w === 'false') return { k: 'bool', v: w === 'true' }
      if (w === 'now' && this.isOp('(')) { this.next(); this.expectOp(')'); return { k: 'now' } }
      if (w === 'ago' && this.isOp('(')) {
        this.next()
        const d = this.next()
        if (d.k !== 'dur') this.fail('ago() needs a duration such as 30m, 6h or 7d', d)
        this.expectOp(')')
        return { k: 'ago', secs: d.n! }
      }
      if (w === 'datetime' && this.isOp('(')) {
        this.next()
        const s = this.next()
        if (s.k !== 'str') this.fail('datetime() needs a quoted date, e.g. datetime("2026-10-01")', s)
        this.expectOp(')')
        if (Number.isNaN(Date.parse(s.v))) this.fail('Not a valid date', s)
        return { k: 'datetime', v: s.v }
      }
    }
    if (t.k === 'op' && t.v === '(') this.fail('Lists are only allowed after "in"', t)
    return this.fail('Expected a value: "text", a number, true/false, ago(1h), now() or datetime("…")', t)
  }

  private field(): FieldRef {
    const t = this.peek()
    if (t.k !== 'id') this.fail('Expected a column name')
    const path = [this.next().v]
    while (this.isOp('.') && this.peek(1).k === 'id') { this.next(); path.push(this.next().v) }
    return { path, pos: t.pos }
  }
}

// ── Compiler ─────────────────────────────────────────────────────────────────

type ColType = FieldType | 'dynamic'
export interface Column { name: string; type: ColType }

export interface CompiledQuery {
  sql:        string
  /** Bind values after the tenant id ($2, $3 …) */
  params:     unknown[]
  columns:    Column[]
  dataset:    string
  summarized: boolean
  groupBy:    string[]
  aggregates: string[]
}

const quote = (name: string) => `"${name}"`
const JSON_KEY = /^[A-Za-z0-9_]+$/
const safeNum = (sql: string) => `(CASE WHEN (${sql}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${sql})::float8 END)`
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m)

export function datasetNames(): string[] { return DATASETS.map((d) => d.name) }

export function compile(text: string, opts: { windowMinutes?: number | null; limit?: number } = {}): CompiledQuery {
  if (!text.trim()) throw new QueryError('Write a query: start with a dataset such as AgentEvents or Agents')
  if (text.length > 4000) throw new QueryError('The query is too long (4,000 characters at most)')
  const ast = new Parser(tokenize(text)).parse()
  const ds = DATASET_BY_NAME.get(ast.dataset.toLowerCase())
  if (!ds) throw new QueryError(`Unknown dataset "${ast.dataset}". Available: ${datasetNames().join(', ')}`, ast.datasetPos)

  const params: unknown[] = []
  const param = (v: unknown) => { params.push(v); return `$${params.length + 1}` }

  let cols: Column[] = Object.entries(ds.fields).map(([name, f]) => ({ name, type: f.type }))
  let sql = `SELECT ${Object.entries(ds.fields).map(([name, f]) => `${f.sql} AS ${quote(name)}`).join(', ')} FROM ${ds.from} WHERE ${ds.tenant}`
  if (opts.windowMinutes && ds.time) sql += ` AND ${ds.time} >= NOW() - make_interval(mins => ${param(Math.round(opts.windowMinutes))}::int)`

  let summarized = false, groupBy: string[] = [], aggregates: string[] = []
  let ordered = false        // the current SELECT ends with ORDER BY, so a LIMIT can be appended
  let limited: number | null = null

  const resolve = (ref: FieldRef): { sql: string; type: ColType; name: string } => {
    const col = cols.find((c) => c.name.toLowerCase() === ref.path[0].toLowerCase())
    if (!col) throw new QueryError(`Unknown column "${ref.path[0]}". Columns here: ${cols.map((c) => c.name).join(', ')}`, ref.pos)
    if (ref.path.length === 1) return { sql: `q.${quote(col.name)}`, type: col.type, name: col.name }
    if (col.type !== 'json') throw new QueryError(`"${col.name}" has no sub-fields`, ref.pos)
    const keys = ref.path.slice(1)
    if (!keys.every((k) => JSON_KEY.test(k))) throw new QueryError('Sub-field names may only use letters, digits and _', ref.pos)
    return { sql: `(q.${quote(col.name)} #>> '{${keys.join(',')}}')`, type: 'dynamic', name: keys[keys.length - 1] }
  }

  const textOp = (lhs: string, op: string, v: string, pos: number): string => {
    switch (op) {
      case '==': return `${lhs} = ${param(v)}`
      case '!=': return `${lhs} IS DISTINCT FROM ${param(v)}`
      case '=~': return `lower(${lhs}) = lower(${param(v)})`
      case '!~': return `lower(${lhs}) IS DISTINCT FROM lower(${param(v)})`
      case 'contains': return `${lhs} ILIKE '%' || ${param(likeEscape(v))} || '%'`
      case '!contains': return `${lhs} NOT ILIKE '%' || ${param(likeEscape(v))} || '%'`
      case 'startswith': return `${lhs} ILIKE ${param(likeEscape(v))} || '%'`
      case '!startswith': return `${lhs} NOT ILIKE ${param(likeEscape(v))} || '%'`
      case 'endswith': return `${lhs} ILIKE '%' || ${param(likeEscape(v))}`
      case '!endswith': return `${lhs} NOT ILIKE '%' || ${param(likeEscape(v))}`
      case 'matches': {
        try { new RegExp(v) } catch { throw new QueryError(`Not a valid regular expression: ${v}`, pos) }
        return `${lhs} ~* ${param(v)}`
      }
      case '!matches': return `${lhs} !~* ${param(v)}`
      case '>': case '>=': case '<': case '<=': return `${lhs} ${op} ${param(v)}`
    }
    throw new QueryError(`"${op}" can't be used with text`, pos)
  }

  const numOp = (lhs: string, op: string, v: number, pos: number): string => {
    const sqlOp = ({ '==': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' } as Record<string, string>)[op]
    if (!sqlOp) throw new QueryError(`"${op}" can't be used with numbers`, pos)
    return `${lhs} ${sqlOp} ${param(v)}::float8`
  }

  const timeValue = (v: Val, pos: number): string => {
    if (v.k === 'ago') return `(NOW() - make_interval(secs => ${param(v.secs)}::float8))`
    if (v.k === 'now') return 'NOW()'
    if (v.k === 'datetime' || v.k === 'str') {
      if (Number.isNaN(Date.parse(v.v))) throw new QueryError(`"${v.v}" is not a date`, pos)
      return `${param(v.v)}::timestamptz`
    }
    throw new QueryError('Compare times with ago(…), now() or datetime("…")', pos)
  }

  const expr = (e: Expr): string => {
    switch (e.kind) {
      case 'and': return `(${expr(e.left)} AND ${expr(e.right)})`
      case 'or':  return `(${expr(e.left)} OR ${expr(e.right)})`
      case 'not': return `(NOT COALESCE(${expr(e.e)}, FALSE))`
      case 'fn': {
        const f = resolve(e.field)
        const asText = f.type === 'json' ? `${f.sql}::text` : f.sql
        if (e.fn === 'isnull') return `${f.sql} IS NULL`
        if (e.fn === 'isnotnull') return `${f.sql} IS NOT NULL`
        if (e.fn === 'isempty') return `(${f.sql} IS NULL OR ${asText}::text = '')`
        return `(${f.sql} IS NOT NULL AND ${asText}::text <> '')`
      }
      case 'cmp': {
        const f = resolve(e.field)
        if (f.type === 'json') throw new QueryError(`"${f.name}" holds several values: read one with ${f.name}.<key>`, e.field.pos)

        if (Array.isArray(e.value)) {
          const list = e.value
          if (f.type === 'number' || (f.type === 'dynamic' && list.every((v) => v.k === 'num'))) {
            if (!list.every((v) => v.k === 'num')) throw new QueryError(`"${f.name}" is a number: list numbers only`, e.pos)
            const lhs = f.type === 'dynamic' ? safeNum(f.sql) : f.sql
            const any = `${lhs} = ANY(${param(list.map((v) => (v as { v: number }).v))}::float8[])`
            return e.op === 'in' ? any : `NOT COALESCE(${any}, FALSE)`
          }
          const values = list.map((v) => (v.k === 'str' ? v.v : v.k === 'num' || v.k === 'bool' ? String(v.v) : null))
          if (values.some((v) => v === null)) throw new QueryError('Lists hold text or numbers', e.pos)
          const any = `${f.sql} = ANY(${param(values)}::text[])`
          return e.op === 'in' ? any : `NOT COALESCE(${any}, FALSE)`
        }

        const v = e.value
        switch (f.type) {
          case 'number': {
            const n = v.k === 'num' ? v.v : v.k === 'str' && v.v.trim() !== '' && !Number.isNaN(Number(v.v)) ? Number(v.v) : null
            if (n === null) throw new QueryError(`"${f.name}" is a number`, e.pos)
            return numOp(f.sql, e.op, n, e.pos)
          }
          case 'time': {
            const sqlOp = ({ '==': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' } as Record<string, string>)[e.op]
            if (!sqlOp) throw new QueryError(`"${e.op}" can't be used with times`, e.pos)
            return `${f.sql} ${sqlOp} ${timeValue(v, e.pos)}`
          }
          case 'bool': {
            if (v.k !== 'bool') throw new QueryError(`"${f.name}" is true or false`, e.pos)
            if (e.op === '==') return `${f.sql} = ${v.v ? 'TRUE' : 'FALSE'}`
            if (e.op === '!=') return `${f.sql} IS DISTINCT FROM ${v.v ? 'TRUE' : 'FALSE'}`
            throw new QueryError('Use == or != with true/false', e.pos)
          }
          case 'dynamic': {
            if (v.k === 'num') return numOp(safeNum(f.sql), e.op, v.v, e.pos)
            if (v.k === 'bool') return textOp(f.sql, e.op, String(v.v), e.pos)
            if (v.k === 'str') return textOp(f.sql, e.op, v.v, e.pos)
            throw new QueryError(`Can't compare "${f.name}" with a time`, e.pos)
          }
          default: {
            if (v.k === 'str') return textOp(f.sql, e.op, v.v, e.pos)
            if (v.k === 'num' || v.k === 'bool') return textOp(f.sql, e.op, String(v.v), e.pos)
            throw new QueryError(`"${f.name}" is text`, e.pos)
          }
        }
      }
    }
  }

  const uniqueAlias = (wanted: string, taken: Set<string>) => {
    if (!JSON_KEY.test(wanted)) throw new QueryError(`"${wanted}" is not a valid column name`)
    if (taken.has(wanted.toLowerCase())) throw new QueryError(`Column "${wanted}" appears twice`)
    taken.add(wanted.toLowerCase())
    return wanted
  }

  for (const stage of ast.stages) {
    switch (stage.kind) {
      case 'where':
        sql = `SELECT * FROM (${sql}) q WHERE ${expr(stage.expr)}`
        ordered = false
        break

      case 'summarize': {
        const taken = new Set<string>()
        const selects: string[] = []
        const newCols: Column[] = []
        for (const b of stage.by) {
          const f = resolve(b.field)
          if (f.type === 'json') throw new QueryError(`Group by a single value: ${f.name}.<key>`, b.field.pos)
          let s = f.sql, type = f.type
          if (b.binSecs) {
            if (f.type !== 'time') throw new QueryError(`bin() needs a time column; "${f.name}" isn't one`, b.field.pos)
            s = `date_bin(make_interval(secs => ${param(b.binSecs)}::int), ${f.sql}, TIMESTAMPTZ '2000-01-01')`
          }
          const alias = uniqueAlias(b.alias ?? f.name, taken)
          selects.push(`${s} AS ${quote(alias)}`)
          newCols.push({ name: alias, type })
        }
        const aggNames: string[] = []
        for (const a of stage.aggs) {
          let s: string, type: ColType = 'number', base = a.fn === 'count' ? 'count_' : ''
          if (a.fn === 'count') s = 'COUNT(*)::int'
          else {
            const f = resolve(a.field!)
            base = `${a.fn}_${f.name}`
            if (f.type === 'json') throw new QueryError(`Aggregate a single value: ${f.name}.<key>`, a.field!.pos)
            if (a.fn === 'dcount') s = `COUNT(DISTINCT ${f.sql})::int`
            else if (a.fn === 'min' || a.fn === 'max') {
              s = f.type === 'dynamic' ? `${a.fn.toUpperCase()}(${safeNum(f.sql)})` : `${a.fn.toUpperCase()}(${f.sql})`
              type = f.type === 'dynamic' ? 'number' : f.type
            } else {
              if (f.type !== 'number' && f.type !== 'dynamic') throw new QueryError(`${a.fn}() needs a number column; "${f.name}" isn't one`, a.field!.pos)
              const num = f.type === 'dynamic' ? safeNum(f.sql) : f.sql
              s = a.fn === 'avg' ? `ROUND(AVG(${num})::numeric, 2)::float8` : `SUM(${num})::float8`
            }
          }
          const alias = uniqueAlias(a.alias ?? base, taken)
          selects.push(`${s} AS ${quote(alias)}`)
          newCols.push({ name: alias, type })
          aggNames.push(alias)
        }
        sql = `SELECT ${selects.join(', ')} FROM (${sql}) q${stage.by.length ? ` GROUP BY ${stage.by.map((_, i) => i + 1).join(', ')}` : ''}`
        cols = newCols
        summarized = true
        groupBy = newCols.slice(0, stage.by.length).map((c) => c.name)
        aggregates = aggNames
        ordered = false
        break
      }

      case 'project': {
        const taken = new Set<string>()
        const selects: string[] = []
        const newCols: Column[] = []
        for (const item of stage.items) {
          const f = resolve(item.field)
          const alias = uniqueAlias(item.alias ?? (item.field.path.length > 1 ? item.field.path.join('_') : f.name), taken)
          selects.push(`${f.sql} AS ${quote(alias)}`)
          newCols.push({ name: alias, type: f.type })
        }
        sql = `SELECT ${selects.join(', ')} FROM (${sql}) q`
        cols = newCols
        if (summarized) { groupBy = groupBy.filter((g) => newCols.some((c) => c.name === g)); aggregates = aggregates.filter((g) => newCols.some((c) => c.name === g)) }
        ordered = false
        break
      }

      case 'distinct': {
        const taken = new Set<string>()
        const fields = stage.fields.map((ref) => { const f = resolve(ref); return { ...f, alias: uniqueAlias(f.name, taken) } })
        sql = `SELECT DISTINCT ${fields.map((f) => `${f.sql} AS ${quote(f.alias)}`).join(', ')} FROM (${sql}) q`
        cols = fields.map((f) => ({ name: f.alias, type: f.type }))
        summarized = false; groupBy = []; aggregates = []
        ordered = false
        break
      }

      case 'sort':
        sql = `SELECT * FROM (${sql}) q ORDER BY ${stage.keys.map((k) => `${resolve(k.field).sql} ${k.desc ? 'DESC' : 'ASC'} NULLS LAST`).join(', ')}`
        ordered = true
        break

      case 'top':
        sql = `SELECT * FROM (${sql}) q ORDER BY ${resolve(stage.key.field).sql} ${stage.key.desc ? 'DESC' : 'ASC'} NULLS LAST LIMIT ${Math.min(stage.n, 10000)}`
        limited = Math.min(stage.n, 10000)
        ordered = false
        break

      case 'take':
        sql = ordered ? `${sql} LIMIT ${Math.min(stage.n, 10000)}` : `SELECT * FROM (${sql}) q LIMIT ${Math.min(stage.n, 10000)}`
        limited = Math.min(stage.n, 10000)
        ordered = false
        break
    }
  }

  const cap = opts.limit ?? 1000
  if (limited === null || limited > cap) sql = ordered ? `${sql} LIMIT ${cap}` : `SELECT * FROM (${sql}) q LIMIT ${cap}`

  return { sql, params, columns: cols, dataset: ds.name, summarized, groupBy, aggregates }
}

/** Field lists for the portal's schema browser. */
export function schema() {
  return DATASETS.map((d) => ({
    name: d.name, description: d.description, timeField: d.time ? Object.entries(d.fields).find(([, f]) => f.sql === d.time)?.[0] ?? null : null,
    fields: Object.entries(d.fields).map(([name, f]) => ({ name, type: f.type, description: f.description ?? null })),
  }))
}
