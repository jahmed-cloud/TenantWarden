/**
 * TenantWarden TypeScript SDK
 * Use this to integrate TenantWarden into your own applications,
 * send custom events, or build plugins.
 */

export interface TenantWardenConfig {
  baseUrl:  string
  apiKey?:  string
  token?:   string
  tenantId: string
}

export interface CustomEvent {
  source:     string
  eventType:  string
  message:    string
  severity?:  'critical' | 'high' | 'medium' | 'low' | 'info'
  occurredAt?: string
  data?:       Record<string, unknown>
}

export interface Alert {
  id:          string
  title:       string
  description: string
  severity:    string
  status:      string
  source:      string
  createdAt:   string
}

export interface PagedResult<T> {
  items:      T[]
  total:      number
  page:       number
  pageSize:   number
  totalPages: number
}

export class TenantWardenClient {
  private readonly baseUrl:  string
  private readonly tenantId: string
  private readonly headers:  Record<string, string>

  constructor(config: TenantWardenConfig) {
    this.baseUrl  = config.baseUrl.replace(/\/$/, '')
    this.tenantId = config.tenantId
    this.headers  = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'X-API-Key':     config.apiKey } : {}),
      ...(config.token  ? { 'Authorization': `Bearer ${config.token}` } : {}),
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  async ingestEvents(events: CustomEvent[]): Promise<{ ingested: number }> {
    return this._post('/api/v1/events', events)
  }

  async ingestEvent(event: CustomEvent): Promise<{ ingested: number }> {
    return this.ingestEvents([event])
  }

  // ── Alerts ──────────────────────────────────────────────────────────────────

  async getAlerts(params?: {
    severity?: string
    status?:   string
    search?:   string
    page?:     number
    pageSize?: number
  }): Promise<PagedResult<Alert>> {
    const qs = new URLSearchParams({
      tenantId: this.tenantId,
      ...Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])),
    })
    return this._get(`/api/v1/alerts?${qs}`)
  }

  async acknowledgeAlert(id: string, comment?: string): Promise<void> {
    return this._post(`/api/v1/alerts/${id}/acknowledge`, { comment })
  }

  async resolveAlert(id: string, resolution: string): Promise<void> {
    return this._post(`/api/v1/alerts/${id}/resolve`, { resolution })
  }

  // ── Overview ────────────────────────────────────────────────────────────────

  async getOverviewSummary() {
    return this._get(`/api/v1/overview/summary?tenantId=${this.tenantId}`)
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`TenantWarden API error: ${res.status} ${await res.text()}`)
    return res.json()
  }

  private async _post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: this.headers,
      body:    body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`TenantWarden API error: ${res.status} ${await res.text()}`)
    return res.json().catch(() => undefined as T)
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

export function createClient(config: TenantWardenConfig): TenantWardenClient {
  return new TenantWardenClient(config)
}

export default TenantWardenClient
