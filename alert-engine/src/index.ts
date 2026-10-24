import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer } from 'http'
import pino from 'pino'
import { runEvaluationCycle } from './evaluators/ruleEvaluator.js'

const logger   = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-alerts' } })
const db       = new Pool({ connectionString: process.env.POSTGRES_URL })
const redis    = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const INTERVAL = parseInt(process.env.EVAL_INTERVAL_SECONDS ?? '60') * 1000

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  } else { res.writeHead(404); res.end() }
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
