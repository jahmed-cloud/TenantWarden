import { Pool } from 'pg'
import { Redis as IoRedis } from 'ioredis'
import { createServer } from 'http'
import pino from 'pino'
import { dispatchAlert, getDispatcher } from './channels/dispatchers.js'
import type { Alert, NotificationChannel } from './types/index.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'tenantwarden-notifications' } })
const db     = new Pool({ connectionString: process.env.POSTGRES_URL })

// ioredis: use a dedicated subscriber connection (can't do pub/sub + commands on same conn)
const subscriber = new IoRedis(process.env.REDIS_URL ?? 'redis://localhost:6379')

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  } else {
    res.writeHead(404); res.end()
  }
})
server.listen(3003)

// ioredis subscribe: callback is (channel, message)
subscriber.subscribe('tenantwarden:alerts', (err) => {
  if (err) logger.error({ err }, 'Redis subscribe failed')
  else logger.info('Subscribed to tenantwarden:alerts')
})

subscriber.on('message', (channel: string, message: string) => {
  if (channel !== 'tenantwarden:alerts') return
  void handleAlert(message)
})

async function handleAlert(message: string): Promise<void> {
  try {
    const payload = JSON.parse(message) as { alert: Alert; tenantId: string }
    await dispatchToChannels(payload.alert, payload.tenantId)
  } catch (err: unknown) {
    logger.error({ err }, 'Failed to process alert notification')
  }
}

async function dispatchToChannels(alert: Alert, tenantId: string): Promise<void> {
  const { rows: channels } = await db.query<NotificationChannel>(
    `SELECT * FROM notification_channels
     WHERE tenant_id = $1
       AND is_enabled = TRUE
       AND ARRAY_POSITION(
             ARRAY['critical','high','medium','low','info']::text[],
             $2::text
           ) <=
           ARRAY_POSITION(
             ARRAY['critical','high','medium','low','info']::text[],
             min_severity::text
           )`,
    [tenantId, alert.severity],
  )

  logger.info({ alertId: alert.id, channelCount: channels.length }, 'Dispatching')

  await Promise.allSettled(
    channels.map(async (ch) => {
      const dispatcher = getDispatcher(ch.type)
      if (!dispatcher) return
      try {
        await dispatcher.send(ch, alert)
        logger.info({ channelId: ch.id, type: ch.type }, 'Notification sent')
      } catch (err: unknown) {
        logger.error({ err, channelId: ch.id }, 'Dispatch failed')
        await db.query(
          `INSERT INTO notification_failures (channel_id, alert_id, error, created_at)
           VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
          [ch.id, alert.id, String(err).slice(0, 500)],
        ).catch(() => { /* ignore */ })
      }
    }),
  )
}

logger.info('Notification service ready')

process.on('SIGTERM', async () => {
  await subscriber.quit()
  await db.end()
  server.close()
  process.exit(0)
})
