import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import pino from 'pino'
import { runEvaluationCycle } from './evaluators/ruleEvaluator.js'
import { METRICS, QUERY_TEMPLATES } from './catalogue.js'
import { compile, QueryError, schema } from './query/kql.js'
import { queryErrorMessage, runQuery } from './query/run.js'

const logger   = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-alerts' } })
const db       = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis    = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const INTERVAL = parseInt(process.env.EVAL_INTERVAL_SECONDS ?? '60') * 1000
const UUID     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw new Error('body too large') }
  return raw ? JSON.parse(raw) : {}
}

// Internal endpoints for the API only — nginx does not route here. The API checks the caller's
// role and tenant before it forwards a tenant id.
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health') return json(res, 200, { status: 'ok' })

    if (req.url === '/catalogue' && req.method === 'GET')
      return json(res, 200, { metrics: METRICS, templates: QUERY_TEMPLATES, datasets: schema() })

    if (req.url === '/query/validate' && req.method === 'POST') {
      const { query } = await readJson(req)
      try {
        const q = compile(String(query ?? ''))
        return json(res, 200, { ok: true, dataset: q.dataset, columns: q.columns, summarized: q.summarized, groupBy: q.groupBy })
      } catch (err) {
        if (err instanceof QueryError) return json(res, 200, { ok: false, error: err.message, position: err.position ?? null })
        throw err
      }
    }

    if (req.url === '/query' && req.method === 'POST') {
      const body = await readJson(req)
      const tenantId = String(body.tenantId ?? '')
      if (!UUID.test(tenantId)) return json(res, 400, { error: 'tenantId is required' })
      const windowMinutes = typeof body.windowMinutes === 'number' && body.windowMinutes > 0 ? Math.min(body.windowMinutes, 525_600) : null
      // Machine scope from the portal: a list of agent ids (an empty list matches nothing)
      const agents = Array.isArray(body.agents) ? body.agents.map(String).filter((a: string) => UUID.test(a)).slice(0, 1000) : null
      try {
        const result = await runQuery(db, tenantId, String(body.query ?? ''), { windowMinutes, limit: Number(body.limit) || 500, agents })
        return json(res, 200, result)
      } catch (err) {
        if (err instanceof QueryError) return json(res, 400, { error: err.message, position: err.position ?? null })
        const msg = queryErrorMessage(err)
        if (msg) return json(res, 400, { error: msg })
        throw err
      }
    }

    res.writeHead(404); res.end()
  } catch (err) {
    logger.error({ err, url: req.url }, 'request failed')
    json(res, 500, { error: 'internal error' })
  }
})
server.listen(3002)

async function loop(): Promise<void> {
  try {
    await runEvaluationCycle(db, redis)
  } catch (err: unknown) {
    logger.error({ err }, 'Evaluation cycle error')
  }
  setTimeout(() => { void loop() }, INTERVAL)
}

logger.info({ intervalSeconds: INTERVAL / 1000 }, 'Alert engine starting')
void loop()

process.on('SIGTERM', async () => {
  await db.end()
  redis.disconnect()
  server.close()
  process.exit(0)
})
