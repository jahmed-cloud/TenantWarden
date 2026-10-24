import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer } from 'http'
import pino from 'pino'
import { detectAnomaly, analyzeTrend, generateInsight } from './analyzers/anomaly.js'
import { scoreCompliance, pruneHistory } from './compliance/scorer.js'

const logger   = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-analytics' } })
const db       = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis    = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const INTERVAL = parseInt(process.env.ANALYTICS_INTERVAL_SECONDS ?? '300') * 1000

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  } else { res.writeHead(404); res.end() }
})
server.listen(3004)

async function analyzeAllTenants(): Promise<void> {
  try {
    const { rows: tenants } = await db.query<{ id: string }>(
      "SELECT id FROM tenants WHERE status = 'active'"
    )
    for (const t of tenants) {
      try { await analyzeTenant(t.id) }
      catch (err: unknown) { logger.error({ err, tenantId: t.id }, 'Analytics failed for tenant') }
      try { await scoreCompliance(db, t.id); logger.info({ tenantId: t.id }, 'compliance scored') }
      catch (err: unknown) { logger.error({ err, tenantId: t.id }, 'Compliance scoring failed') }
    }
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to load tenants')
  }
  // Retention: prune old history once per analytics cycle
  try { await pruneHistory(db) }
  catch (err: unknown) { logger.error({ err }, 'History prune failed') }
}

async function analyzeTenant(tenantId: string): Promise<void> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT DATE(updated_at) AS day, COUNT(*)::int AS count
     FROM risky_users
     WHERE tenant_id = $1
       AND updated_at >= NOW() - INTERVAL '30 days'
       AND risk_level != 'none'
     GROUP BY DATE(updated_at)
     ORDER BY day`,
    [tenantId],
  )

  if (rows.length < 7) return

  const counts   = rows.map(r => r.count)
  const baseline = counts.slice(0, -1)
  const current  = counts[counts.length - 1] ?? 0
  const bMean    = Math.round(baseline.reduce((a, b) => a + b, 0) / baseline.length)

  const anomaly = detectAnomaly(current, baseline)
  const trend   = analyzeTrend(counts)
  const insight = generateInsight('risky_users', current, bMean, anomaly)

  await redis.setex(
    `analytics:${tenantId}:risky_users`,
    600,
    JSON.stringify({ anomaly, trend, insight, updatedAt: new Date().toISOString() }),
  )

  if (anomaly.isAnomaly) {
    logger.warn({ tenantId, score: anomaly.score }, 'Anomaly detected')
    await redis.publish('tenantwarden:analytics_alerts', JSON.stringify({ tenantId, anomaly, insight }))
  }
}

logger.info('Analytics engine starting')
void analyzeAllTenants()
setInterval(() => { void analyzeAllTenants() }, INTERVAL)

process.on('SIGTERM', async () => {
  await db.end()
  redis.disconnect()
  server.close()
  process.exit(0)
})
