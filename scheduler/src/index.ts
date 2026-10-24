import * as cron from 'node-cron'
import axios from 'axios'
import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer } from 'http'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-scheduler' } })
const db     = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis  = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')

const API_URL = process.env.API_URL ?? 'http://api:8080'

async function trigger(name: string, url: string, body?: object): Promise<void> {
  try {
    logger.info({ job: name }, 'Triggering job')
    await axios.post(url, body ?? {}, { timeout: 10_000 })
    logger.info({ job: name }, 'Job triggered OK')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ job: name, err: msg }, 'Job trigger failed')
  }
}

// Every 15 minutes: collection cycle
cron.schedule('*/15 * * * *', () => {
  void trigger('collect', `${API_URL}/api/v1/collect`)
})

// Every minute: alert rule evaluation
cron.schedule('* * * * *', () => {
  void trigger('alert_eval', `${API_URL}/api/v1/alerts/evaluate`)
})

// Every 5 minutes: analytics
cron.schedule('*/5 * * * *', () => {
  void trigger('analytics', `${API_URL}/api/v1/analytics/analyze`)
})

// Every hour: cleanup resolved alerts older than 90 days
cron.schedule('0 * * * *', async () => {
  try {
    await db.query(`
      DELETE FROM alerts
      WHERE status = 'resolved'
        AND resolved_at < NOW() - INTERVAL '90 days'`)
    logger.info('Old alerts cleaned up')
  } catch (err: unknown) {
    logger.error({ err }, 'Alert cleanup failed')
  }
})

// Daily at 02:00: mark stale agents offline
cron.schedule('0 2 * * *', async () => {
  try {
    const result = await db.query(`
      UPDATE agents SET status = 'offline', updated_at = NOW()
      WHERE last_heartbeat_at < NOW() - INTERVAL '5 minutes'
        AND status != 'offline'`)
    logger.info({ updated: result.rowCount }, 'Stale agents marked offline')
  } catch (err: unknown) {
    logger.error({ err }, 'Agent status sync failed')
  }
})

// Daily at 03:00: create next year's audit_logs partition ahead of time
// (function from migration 010; without it inserts fall back to audit_logs_default)
cron.schedule('0 3 * * *', async () => {
  try {
    await db.query('SELECT ensure_audit_log_partitions(1)')
    logger.info('Audit log partitions ensured')
  } catch (err: unknown) {
    logger.error({ err }, 'Audit partition maintenance failed')
  }
})

// Health check server
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', jobs: 6 }))
  } else {
    res.writeHead(404)
    res.end()
  }
})
server.listen(3006)

logger.info('Scheduler running — 6 jobs active')

process.on('SIGTERM', async () => {
  await db.end()
  redis.disconnect()
  server.close()
  process.exit(0)
})
