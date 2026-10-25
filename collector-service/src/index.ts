import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import pino from 'pino'
import { CollectorScheduler } from './scheduler.js'
import { remediate, type RemediationAction } from './graph/collector.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-collector' } })
const db     = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis  = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')

const REMEDIATION_ACTIONS = new Set<RemediationAction>(['dismiss', 'confirm-compromised', 'revoke-sessions'])

logger.info('TenantWarden Collector Service starting')

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw new Error('body too large') }
  return raw ? JSON.parse(raw) : {}
}

// Internal endpoints only — nginx does not route to this service. The API calls /remediate
// after checking the caller's role and tenant.
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health') return json(res, 200, { status: 'ok', uptime: process.uptime() })

    if (req.url === '/collect' && req.method === 'POST') {
      const result = await scheduler.runNow()
      return json(res, result.started ? 202 : 409, result.started ? { status: 'collection started' } : { status: 'already running' })
    }

    if (req.url === '/remediate' && req.method === 'POST') {
      const { tenantId, action, userId } = await readJson(req)
      if (!tenantId || !userId || !REMEDIATION_ACTIONS.has(action)) return json(res, 400, { error: 'tenantId, userId and a valid action are required' })
      const tenant = await scheduler.loadTenant(String(tenantId))
      if (!tenant) return json(res, 404, { error: 'Tenant not found' })
      try {
        await remediate(tenant, action, String(userId))
        return json(res, 200, { ok: true })
      } catch (err: any) {
        // Graph explains permission/licence problems in its message — pass it on
        const status = err?.statusCode === 403 ? 403 : 502
        logger.warn({ tenantId, action, statusCode: err?.statusCode, msg: err?.message }, 'remediation failed')
        return json(res, status, { error: err?.message ?? 'Microsoft Graph call failed' })
      }
    }

    res.writeHead(404); res.end()
  } catch (err: any) {
    logger.error({ err }, 'request failed')
    json(res, 500, { error: err?.message ?? 'internal error' })
  }
})
server.listen(3001, () => logger.info('HTTP listening on :3001'))

const scheduler = new CollectorScheduler(db, redis, {
  intervalSeconds: parseInt(process.env.COLLECTOR_INTERVAL_SECONDS ?? '900'),
  batchSize:       parseInt(process.env.GRAPH_API_BATCH_SIZE       ?? '20'),
})

scheduler.start().catch((err: unknown) => {
  logger.error({ err }, 'Scheduler failed to start')
  process.exit(1)
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down')
  await scheduler.stop()
  await db.end()
  redis.disconnect()
  server.close()
  process.exit(0)
})
