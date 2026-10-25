import * as cron from 'node-cron'
import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer } from 'http'
import pino from 'pino'

// Database housekeeping. Collection, rule evaluation and analytics run on their own
// timers inside collector-service, alert-engine and analytics-engine.
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-scheduler' } })
const db     = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis  = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')

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

// Every 5 minutes: mark agents offline once they stop reporting
cron.schedule('*/5 * * * *', async () => {
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
    res.end(JSON.stringify({ status: 'ok', jobs: 3 }))
  } else {
    res.writeHead(404)
    res.end()
  }
})
server.listen(3006)

logger.info('Scheduler running — 3 jobs active')

process.on('SIGTERM', async () => {
  await db.end()
  redis.disconnect()
  server.close()
  process.exit(0)
})
