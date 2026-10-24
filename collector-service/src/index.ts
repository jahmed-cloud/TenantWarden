import { createServer } from 'http'
import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import pino from 'pino'
import { CollectorScheduler } from './scheduler.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-collector' } })
const db     = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis  = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')

logger.info('TenantWarden Collector Service starting')

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
  } else if (req.url === '/collect' && req.method === 'POST') {
    const result = await scheduler.runNow()
    res.writeHead(result.started ? 202 : 409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result.started ? { status: 'collection started' } : { status: 'already running' }))
  } else { res.writeHead(404); res.end() }
})
server.listen(3001, () => logger.info('Health check listening on :3001'))

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
