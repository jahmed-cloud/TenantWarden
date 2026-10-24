import { createServer } from 'http'
import { Pool } from 'pg'
import pino from 'pino'
import { PluginRegistry, BUILT_IN_PLUGINS } from './sdk/index.js'

const logger   = pino({ level: 'info', base: { service: 'tenantwarden-plugins' } })
const db       = new Pool({ connectionString: process.env.POSTGRES_URL })
const registry = new PluginRegistry()

for (const plugin of BUILT_IN_PLUGINS) registry.install(plugin)

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', installedPlugins: registry.list().length }))
  } else if (req.method === 'GET' && req.url === '/plugins') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ available: registry.listAvailable(), installed: registry.list() }))
  } else {
    res.writeHead(404); res.end()
  }
})

server.listen(3005)
logger.info({ pluginCount: registry.list().length }, 'Plugin engine ready')

process.on('SIGTERM', async () => {
  await db.end()
  server.close()
  process.exit(0)
})
