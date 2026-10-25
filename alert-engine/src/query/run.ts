import type { Pool } from 'pg'
import { compile, type CompiledQuery } from './kql.js'

export interface QueryResult {
  columns:    CompiledQuery['columns']
  rows:       Record<string, unknown>[]
  summarized: boolean
  groupBy:    string[]
  aggregates: string[]
  elapsedMs:  number
  truncated:  boolean
}

/**
 * Runs a query for one tenant in a read-only transaction with a statement timeout, so a heavy
 * query can neither change data nor hold the database for long.
 */
export async function runQuery(db: Pool, tenantId: string, text: string,
  opts: { windowMinutes?: number | null; limit?: number } = {}): Promise<QueryResult> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000)
  const q = compile(text, { windowMinutes: opts.windowMinutes, limit })
  const started = Date.now()
  const client = await db.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = 8000`)
    const res = await client.query(q.sql, [tenantId, ...q.params])
    await client.query('COMMIT')
    return {
      columns: q.columns, rows: res.rows, summarized: q.summarized, groupBy: q.groupBy, aggregates: q.aggregates,
      elapsedMs: Date.now() - started, truncated: res.rows.length >= limit,
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** Postgres errors that come from the query itself (not from the database being down). */
export function queryErrorMessage(err: unknown): string | null {
  const e = err as { code?: string; message?: string }
  if (e?.code === '57014') return 'The query took longer than 8 seconds; narrow it with where or a shorter time range'
  if (e?.code && /^(22|42)/.test(e.code)) return `The query could not run: ${e.message}`
  return null
}
