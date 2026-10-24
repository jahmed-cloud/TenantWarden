// ─── Plugin SDK ───────────────────────────────────────────────────────────────

export interface PluginManifest {
  id:          string
  name:        string
  version:     string
  description: string
  author:      string
  category:    'collector' | 'notification' | 'identity' | 'security' | 'ticketing' | 'monitoring'
  permissions: string[]
  configSchema: Record<string, PluginConfigField>
}

export interface PluginConfigField {
  type:        'string' | 'number' | 'boolean' | 'secret'
  label:       string
  description: string
  required:    boolean
  default?:    unknown
}

export interface PluginContext {
  tenantId: string
  config:   Record<string, unknown>
  logger:   { info(msg: string, data?: object): void; warn(msg: string, data?: object): void; error(msg: string, data?: object): void }
  http:     { get<T>(url: string, headers?: Record<string, string>): Promise<T>; post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> }
}

export interface CollectorPlugin {
  manifest:  PluginManifest
  collect(ctx: PluginContext): Promise<PluginEvent[]>
}

export interface NotificationPlugin {
  manifest: PluginManifest
  send(ctx: PluginContext, alert: PluginAlert): Promise<void>
}

export interface PluginEvent {
  type:       string
  severity:   'critical' | 'high' | 'medium' | 'low' | 'info'
  message:    string
  data?:      Record<string, unknown>
  occurredAt: Date
}

export interface PluginAlert {
  id:          string
  title:       string
  description: string
  severity:    string
  source:      string
  createdAt:   string
}

// ─── Built-in plugin definitions ──────────────────────────────────────────────

export const BUILT_IN_PLUGINS: PluginManifest[] = [
  {
    id: 'microsoft365', name: 'Microsoft 365', version: '1.0.0',
    description: 'Core Microsoft 365 monitoring — Entra ID, Intune, Defender, Exchange',
    author: 'TenantWarden', category: 'collector',
    permissions: ['graph.read', 'defender.read', 'intune.read'],
    configSchema: { clientId: { type: 'string', label: 'Client ID', description: 'Azure App Registration client ID', required: true }, clientSecret: { type: 'secret', label: 'Client Secret', description: 'Azure App Registration client secret', required: true } },
  },
  {
    id: 'slack', name: 'Slack', version: '1.0.0',
    description: 'Send alerts to Slack channels',
    author: 'TenantWarden', category: 'notification',
    permissions: ['notifications.write'],
    configSchema: { botToken: { type: 'secret', label: 'Bot Token', description: 'Slack xoxb- token', required: true }, channelId: { type: 'string', label: 'Channel ID', description: 'Target Slack channel ID', required: true } },
  },
  {
    id: 'pagerduty', name: 'PagerDuty', version: '1.0.0',
    description: 'Create PagerDuty incidents from critical alerts',
    author: 'TenantWarden', category: 'notification',
    permissions: ['notifications.write'],
    configSchema: { routingKey: { type: 'secret', label: 'Routing Key', description: 'PagerDuty Events API v2 routing key', required: true } },
  },
  {
    id: 'jira', name: 'Jira', version: '1.0.0',
    description: 'Create Jira tickets from security incidents',
    author: 'TenantWarden', category: 'ticketing',
    permissions: ['ticketing.write'],
    configSchema: {
      url:     { type: 'string', label: 'Jira URL',   description: 'https://your-domain.atlassian.net', required: true },
      email:   { type: 'string', label: 'Email',       description: 'Jira account email',                required: true },
      token:   { type: 'secret', label: 'API Token',   description: 'Jira API token',                   required: true },
      project: { type: 'string', label: 'Project Key', description: 'e.g. SEC',                         required: true },
    },
  },
  {
    id: 'servicenow', name: 'ServiceNow', version: '1.0.0',
    description: 'Create ServiceNow incidents from critical alerts',
    author: 'TenantWarden', category: 'ticketing',
    permissions: ['ticketing.write'],
    configSchema: {
      instance: { type: 'string', label: 'Instance',  description: 'your-instance.service-now.com', required: true },
      username: { type: 'string', label: 'Username',  description: 'ServiceNow username',           required: true },
      password: { type: 'secret', label: 'Password',  description: 'ServiceNow password',           required: true },
    },
  },
  {
    id: 'crowdstrike', name: 'CrowdStrike Falcon', version: '1.0.0',
    description: 'Collect endpoint detection events from CrowdStrike',
    author: 'TenantWarden', category: 'security',
    permissions: ['collector.read'],
    configSchema: {
      clientId:     { type: 'string', label: 'Client ID',     description: 'Falcon API client ID',     required: true },
      clientSecret: { type: 'secret', label: 'Client Secret', description: 'Falcon API client secret', required: true },
      baseUrl:      { type: 'string', label: 'Base URL',      description: 'https://api.crowdstrike.com', required: false, default: 'https://api.crowdstrike.com' },
    },
  },
]

// ─── Plugin registry ─────────────────────────────────────────────────────────

export class PluginRegistry {
  private installed = new Map<string, PluginManifest>()

  list() { return Array.from(this.installed.values()) }
  listAvailable() { return BUILT_IN_PLUGINS }

  install(manifest: PluginManifest) {
    this.installed.set(manifest.id, manifest)
    console.info(`Plugin installed: ${manifest.name} v${manifest.version}`)
  }

  uninstall(id: string) {
    this.installed.delete(id)
  }

  get(id: string) { return this.installed.get(id) }
  isInstalled(id: string) { return this.installed.has(id) }
}
