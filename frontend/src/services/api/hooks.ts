import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { authClient, del, errorMessage, get, patch, post, put } from '@/services/api/client'
import { useTenantWardenStore, type CurrentUser } from '@/store/tenantWardenStore'

// ── Types (shapes as the API returns them) ────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type AlertStatus = 'active' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed'

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }

export interface Alert {
  id: string; tenantId: string; title: string; description: string; severity: Severity; status: AlertStatus
  source: string; category: string; affectedUsers: string[]; affectedDevices: string[]
  affectedIpAddress: string | null; affectedCountry: string | null; recommendedAction: string | null
  riskScore: number | null; externalId: string | null; assignedTo: string | null
  acknowledgedAt: string | null; resolvedAt: string | null; resolution: string | null
  /** JSON text; holds ackComment / ackBy after an acknowledge with a comment */
  metadata: string | null
  createdAt: string; updatedAt: string
}
export interface AlertCounts { critical: number; high: number; medium: number; low: number }
export interface AlertTrendPoint { date: string; critical: number; high: number; medium: number; low: number; resolved: number }

export interface AlertRule {
  id: string; tenantId: string; name: string; description: string | null; severity: Severity; source: string
  metric: string; operator: string; threshold: number; windowMinutes: number; cooldownMinutes: number
  isEnabled: boolean; lastTriggeredAt: string | null; createdAt: string
  param: number | null; query: string | null
}
export interface RuleMetric {
  metric: string; label: string; category: string; source: string; description: string; windowed: boolean
  param?: { label: string; default: number; unit?: string }; unit?: string; affects: string
  defaults: { name: string; operator: string; threshold: number; severity: Severity; window?: number; cooldown?: number }
  recommended: string
}
export interface QueryTemplate { name: string; category: string; severity: Severity; operator: string; threshold: number; window: number; description: string; query: string }
export interface DatasetSchema { name: string; description: string; timeField: string | null; fields: { name: string; type: string; description: string | null }[] }
export interface Catalogue { metrics: RuleMetric[]; templates: QueryTemplate[]; datasets: DatasetSchema[] }
export interface QueryResult {
  columns: { name: string; type: string }[]; rows: Record<string, unknown>[]; summarized: boolean
  groupBy: string[]; aggregates: string[]; elapsedMs: number; truncated: boolean
}

export interface IdentitySummary {
  totalUsers: number; riskyUsers: number; riskyHigh: number; riskyMedium: number; caPolicies: number
  caPoliciesTotal: number; deviceCount: number; nonCompliant: number; riskySignIns24h: number
  secureScore: number | null; mfaRegistered: number; mfaTotal: number; mfaPercent: number | null
}
export interface Overview {
  alerts: AlertCounts; agents: AgentStats; identity: IdentitySummary
  devices: { total: number; compliant: number; nonCompliant: number; encrypted: number }; lastUpdated: string
}
export interface RiskyUser {
  id: string; azureObjectId: string; userPrincipalName: string; displayName: string; riskLevel: string
  riskDetail: string | null; countryCode: string | null; ipAddress: string | null; riskLastUpdatedAt: string | null
}
export interface SignIn {
  id: string; userPrincipalName: string; riskLevel: string; riskDetail: string | null; ipAddress: string | null
  countryCode: string | null; city: string | null; appDisplayName: string | null; occurredAt: string
}
export interface SignInTrendPoint { date: string; high: number; medium: number; low: number; total: number }
export interface CountryCount { country: string; total: number; high: number }
export interface MfaStatus {
  collected: boolean
  allUsers: { registered: number; total: number; percent: number | null }
  privileged: { registered: number; total: number; percent: number | null }
  byCategory: { scope: string; category: string; users: number }[]
}
export interface AuthMethod { method: string; category: string; userCount: number; capturedAt: string }
export interface CaPolicy {
  id: string; policyId: string; name: string; state: string; requiresMfa: boolean | null
  requiresCompliantDevice: boolean | null; blocks: boolean | null; syncedAt: string
}

export interface Device {
  id: string; azureDeviceId: string; deviceName: string; operatingSystem: string; osVersion: string
  complianceState: string; userPrincipalName: string | null; encryptionState: string | null
  ownerType: string | null; lastSyncDateTime: string | null; syncedAt: string
}
export interface DeviceSummary {
  compliance: { compliant: number; nonCompliant: number }
  byOs: { os: string; count: number }[]
  encryption: { encrypted: number; notEncrypted: number }
}

export interface Agent {
  id: string; tenantId: string; agentId: string; hostname: string; platform: string; version: string
  status: string; osName: string | null; osVersion: string | null; architecture: string | null
  ipAddress: string | null; cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null
  uptimeSeconds: number | null; lastSeenAt: string | null; lastHeartbeatAt: string | null
  inventoryAt: string | null; createdAt: string
  netRxBps: number | null; netTxBps: number | null; connections: string | null; tags: string | null
}
export interface AgentStats { total: number; online: number; offline: number; windows: number; linux: number; macOs: number; docker: number }
export interface AgentMetricPoint { t: string; cpu: number; cpuMax: number; mem: number; disk: number; rxMbps: number; txMbps: number }
export interface AgentEvent { id: string; agentId: string; hostname: string; level: string; source: string; message: string; occurredAt: string }
export type AgentInventory = Record<string, unknown>
export interface EnrollmentToken { token: string; tokenId: string; tenantId: string; expiresAt: string }
export interface EnrollmentTokenInfo { tokenId: string; issuedAt: string; expiresAt: string; issuedBy: string; revoked: boolean }

export interface SecuritySummary {
  secureScore: {
    currentScore: number; maxScore: number; percentage: number; activeUsers: number | null
    licensedUsers: number | null; recordedAt: string; percentage7dAgo: number | null
  } | null
  incidents: { open: number; high: number; medium: number; low: number; new7d: number; resolved7d: number }
}
export interface ScorePoint { recordedAt: string; percentage: number; currentScore: number; maxScore: number }
export interface Incident {
  id: string; incidentId: string; displayName: string; severity: string; status: string
  classification: string | null; determination: string | null; assignedTo: string | null
  alertCount: number; webUrl: string | null; createdAt: string; lastUpdateAt: string | null
}
export interface ServiceHealth { service: string; status: string; detail: string | null; recordedAt: string }

export interface AnalyticsSummary {
  days: number
  kpis: {
    riskySignIns: number; riskySignInsPrev: number; alerts: number; alertsPrev: number; resolved: number
    openAlerts: number; mttrHours: number | null; mttaMinutes: number | null
  }
  bySource: { source: string; count: number }[]
  topUsers: { user: string; signIns: number; high: number; countries: number; lastSeen: string }[]
  // Written by analytics-engine (z-score of daily risky-user counts); null until it has run
  anomaly: {
    anomaly: { isAnomaly: boolean; score: number; direction: string; currentValue: number; baselineMean: number; baselineStd: number; message: string }
    trend: { direction: string; slope: number; percentChange: number; forecast7d: number }
    insight: { title: string; severity: string; description: string; recommendedActions: string[]; estimatedImpact: string } | null
    updatedAt: string
  } | null
}

export interface PosturePoint {
  riskyHigh: number; riskyMedium: number; devicesTotal: number; devicesNonCompliant: number
  caPolicies: number; secureScore: number | null; riskySignins: number; capturedAt: string
}
export interface Framework { id: string; name: string; score: number; controlsPassing: string; status: string }
export interface Control { ref: string; title: string; category: string | null; status: string; detail: string | null }
export interface ComplianceHistoryPoint { frameworkId: string; score: number; controlsPassed: number; controlsTotal: number; capturedAt: string }
export interface Retention { key: string; days: number; description: string }

export interface Tenant {
  id: string; displayName: string; azureTenantId: string; domain: string; status: string; description: string | null
  clientId: string; lastSyncAt: string | null; lastSyncError: string | null; userCount: number; deviceCount: number
  enabledModules: string[]; createdAt: string
}
export interface Channel {
  id: string; tenantId: string; name: string; type: string; config: string; isEnabled: boolean; minSeverity: Severity; createdAt: string
}
export interface PlatformUser {
  id: string; email: string; displayName: string; role: string; tenantId: string | null
  isActive: boolean; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string
}
export interface AuditEntry {
  id: string; tenantId: string | null; userEmail: string; action: string; resource: string
  resourceId: string | null; ipAddress: string | null; success: boolean; createdAt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function useTenantId(): string {
  return useTenantWardenStore((s) => s.activeTenant?.id ?? '')
}

/** A GET scoped to the active tenant; it waits until a tenant is selected. */
function useTenantQuery<T>(name: string, path: (tenantId: string) => string, opts: { refetch?: number; enabled?: boolean } = {}) {
  const tenantId = useTenantId()
  const url = path(tenantId)
  return useQuery({
    queryKey: [name, tenantId, url],
    queryFn: () => get<T>(url),
    enabled: !!tenantId && (opts.enabled ?? true),
    refetchInterval: opts.refetch,
  })
}

/** A mutation that toasts its outcome and refreshes the listed queries. */
function useAction<TArgs, TResult = unknown>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; errorPrefix?: string } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      opts.invalidate?.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
      const msg = typeof opts.success === 'function' ? opts.success(result) : opts.success
      if (msg) toast.success(msg)
    },
    onError: (err) => toast.error(errorMessage(err, opts.errorPrefix)),
  })
}

const qs = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()

// ── Session ──────────────────────────────────────────────────────────────────

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await authClient.get<CurrentUser>('/auth/me')).data,
    enabled,
    staleTime: 60_000,
  })
}

// ── Overview & posture ───────────────────────────────────────────────────────

export const useOverview = () => useTenantQuery<Overview>('overview', (t) => `/v1/overview/summary?tenantId=${t}`, { refetch: 30_000 })
export const usePostureHistory = (days = 30) =>
  useTenantQuery<PosturePoint[]>('posture', (t) => `/v1/history/posture?tenantId=${t}&days=${days}`)

// ── Alerts ───────────────────────────────────────────────────────────────────

export interface AlertFilters { severity?: string; status?: string; source?: string; search?: string; page?: number; pageSize?: number }

export const useAlerts = (f: AlertFilters) =>
  useTenantQuery<Paged<Alert>>('alerts', (t) => `/v1/alerts?${qs({ tenantId: t, ...f })}`, { refetch: 20_000 })
export const useAlertCounts = () => useTenantQuery<AlertCounts>('alert-counts', (t) => `/v1/alerts/counts?tenantId=${t}`, { refetch: 20_000 })
export const useAlertTrend = (days = 14) =>
  useTenantQuery<AlertTrendPoint[]>('alert-trend', (t) => `/v1/alerts/trend?tenantId=${t}&days=${days}`, { refetch: 60_000 })

const ALERT_KEYS: QueryKey[] = [['alerts'], ['alert-counts'], ['alert-trend'], ['overview']]
export const useAcknowledgeAlert = () =>
  useAction(({ id, comment }: { id: string; comment?: string }) => post(`/v1/alerts/${id}/acknowledge`, { comment }), { success: 'Alert acknowledged', invalidate: ALERT_KEYS })
export const useResolveAlert = () =>
  useAction(({ id, resolution }: { id: string; resolution: string }) => post(`/v1/alerts/${id}/resolve`, { resolution }), { success: 'Alert resolved', invalidate: ALERT_KEYS })
export const useAssignAlert = () =>
  useAction(({ id, assigneeId }: { id: string; assigneeId: string }) => post(`/v1/alerts/${id}/assign`, { assigneeId }), { success: 'Alert assigned', invalidate: ALERT_KEYS })
export const useDeleteAlert = () =>
  useAction((id: string) => del(`/v1/alerts/${id}`), { success: 'Alert deleted', invalidate: ALERT_KEYS })

// ── Alert rules ──────────────────────────────────────────────────────────────

export const useRules = () => useTenantQuery<AlertRule[]>('rules', (t) => `/v1/alert-rules?tenantId=${t}`)
export const useCatalogue = () => useQuery({ queryKey: ['catalogue'], queryFn: () => get<Catalogue>('/v1/alert-rules/catalogue'), staleTime: 300_000 })
export const useRuleMetrics = () => { const q = useCatalogue(); return { ...q, data: q.data?.metrics } }
export type RuleInput = Pick<AlertRule, 'name' | 'severity' | 'metric' | 'operator' | 'threshold' | 'windowMinutes' | 'cooldownMinutes' | 'isEnabled'> & { description?: string; param?: number | null; query?: string | null }
export const useSaveRule = () =>
  useAction(({ id, tenantId, rule }: { id?: string; tenantId: string; rule: RuleInput }) =>
    id ? patch(`/v1/alert-rules/${id}`, rule) : post('/v1/alert-rules', { tenantId, ...rule }),
  { success: 'Rule saved', invalidate: [['rules']] })
export const useToggleRule = () =>
  useAction(({ id, isEnabled }: { id: string; isEnabled: boolean }) => patch(`/v1/alert-rules/${id}`, { isEnabled }), { invalidate: [['rules']] })
export const useDeleteRule = () => useAction((id: string) => del(`/v1/alert-rules/${id}`), { success: 'Rule deleted', invalidate: [['rules']] })

// ── Identity ─────────────────────────────────────────────────────────────────

export const useIdentitySummary = () => useTenantQuery<IdentitySummary>('identity-summary', (t) => `/v1/identity/summary?tenantId=${t}`, { refetch: 60_000 })
export const useRiskyUsers = (riskLevel?: string, page = 1) =>
  useTenantQuery<Paged<RiskyUser>>('risky-users', (t) => `/v1/identity/risky-users?${qs({ tenantId: t, riskLevel, page, pageSize: 25 })}`)
export const useSignIns = () => useTenantQuery<SignIn[]>('sign-ins', (t) => `/v1/identity/sign-ins?tenantId=${t}&riskyOnly=true&hours=168`)
export const useSignInTrend = (days = 14) => useTenantQuery<SignInTrendPoint[]>('sign-in-trend', (t) => `/v1/identity/sign-ins/trend?tenantId=${t}&days=${days}`)
export const useSignInCountries = (days = 30) => useTenantQuery<CountryCount[]>('sign-in-countries', (t) => `/v1/identity/sign-ins/countries?tenantId=${t}&days=${days}`)
export const useMfaStatus = () => useTenantQuery<MfaStatus>('mfa', (t) => `/v1/identity/mfa-status?tenantId=${t}`)
export const useAuthMethods = (scope: 'all_users' | 'privileged_users' = 'all_users') => useTenantQuery<AuthMethod[]>('auth-methods', (t) => `/v1/identity/auth-methods?tenantId=${t}&scope=${scope}`)
export const useCaPolicies = () => useTenantQuery<CaPolicy[]>('ca-policies', (t) => `/v1/identity/ca-policies?tenantId=${t}`)
export const useRemediate = () =>
  useAction(({ tenantId, userId, action }: { tenantId: string; userId: string; action: 'dismiss' | 'confirm-compromised' | 'revoke-sessions' }) =>
    post(`/v1/identity/risky-users/${encodeURIComponent(userId)}/${action}?tenantId=${tenantId}`),
  { success: 'Done — Microsoft Entra ID accepted the change', invalidate: [['risky-users'], ['identity-summary'], ['overview']], errorPrefix: 'Remediation failed' })

// ── Devices ──────────────────────────────────────────────────────────────────

export const useDevices = (f: { search?: string; compliance?: string; page?: number }) =>
  useTenantQuery<Paged<Device>>('devices', (t) => `/v1/devices?${qs({ tenantId: t, pageSize: 25, ...f })}`)
export const useDeviceSummary = () => useTenantQuery<DeviceSummary>('device-summary', (t) => `/v1/devices/summary?tenantId=${t}`)

// ── Agents ───────────────────────────────────────────────────────────────────

export const useAgents = () => useTenantQuery<Agent[]>('agents', (t) => `/v1/agents?tenantId=${t}`, { refetch: 30_000 })
export const useAgentStats = () => useTenantQuery<AgentStats>('agent-stats', (t) => `/v1/agents/stats?tenantId=${t}`, { refetch: 30_000 })
export const useAgentEvents = (agentId?: string, limit = 50, source?: string) =>
  useTenantQuery<AgentEvent[]>('agent-events', (t) => `/v1/agents/events?${qs({ tenantId: t, agentId, limit, source })}`, { refetch: 60_000 })
export function useAgentMetrics(id: string | undefined, hours: number) {
  return useQuery({
    queryKey: ['agent-metrics', id, hours],
    queryFn: () => get<AgentMetricPoint[]>(`/v1/agents/${id}/metrics?hours=${hours}`),
    enabled: !!id,
    refetchInterval: 60_000,
  })
}
export function useAgentInventory(id: string | undefined) {
  return useQuery({ queryKey: ['agent-inventory', id], queryFn: () => get<AgentInventory>(`/v1/agents/${id}/inventory`), enabled: !!id })
}
export const useEnrollmentTokens = (enabled: boolean) =>
  useTenantQuery<EnrollmentTokenInfo[]>('enrollment-tokens', (t) => `/v1/agents/enrollment-tokens?tenantId=${t}`, { enabled })
export const useCreateEnrollmentToken = () =>
  useAction(({ tenantId, expiresInDays }: { tenantId: string; expiresInDays: number }) =>
    post<EnrollmentToken>('/v1/agents/enrollment-tokens', { tenantId, expiresInDays }), { invalidate: [['enrollment-tokens']] })
export const useRevokeEnrollmentToken = () =>
  useAction((tokenId: string) => del(`/v1/agents/enrollment-tokens/${tokenId}`), { success: 'Token revoked — agents using it are refused on their next connection', invalidate: [['enrollment-tokens']] })
export const useDeleteAgent = () =>
  useAction((id: string) => del(`/v1/agents/${id}`), { success: 'Agent removed', invalidate: [['agents'], ['agent-stats']] })

// ── Security ─────────────────────────────────────────────────────────────────

export const useSecuritySummary = () => useTenantQuery<SecuritySummary>('security-summary', (t) => `/v1/security/summary?tenantId=${t}`, { refetch: 60_000 })
export const useSecureScoreHistory = (days = 90) => useTenantQuery<ScorePoint[]>('score-history', (t) => `/v1/security/secure-score/history?tenantId=${t}&days=${days}`)
export const useIncidents = (status: string) => useTenantQuery<Incident[]>('incidents', (t) => `/v1/security/incidents?tenantId=${t}&status=${status}`)
export const useServiceHealth = () => useTenantQuery<ServiceHealth[]>('service-health', (t) => `/v1/service-health?tenantId=${t}`)

// ── Analytics & compliance ───────────────────────────────────────────────────

export const useAnalytics = (days: number) => useTenantQuery<AnalyticsSummary>('analytics', (t) => `/v1/analytics/summary?tenantId=${t}&days=${days}`)
export const useFrameworks = () => useTenantQuery<Framework[]>('frameworks', (t) => `/v1/compliance/frameworks?tenantId=${t}`)
export const useControls = (frameworkId: string | null) =>
  useTenantQuery<Control[]>('controls', (t) => `/v1/compliance/controls?tenantId=${t}&frameworkId=${frameworkId}`, { enabled: !!frameworkId })
export const useComplianceHistory = (days = 90) =>
  useTenantQuery<ComplianceHistoryPoint[]>('compliance-history', (t) => `/v1/history/compliance?tenantId=${t}&days=${days}`)

export const useCollectNow = () =>
  useAction((_: void) => post('/v1/collect'), { success: 'Collection started — new data appears within a minute or two', errorPrefix: 'Could not start collection' })

// ── Tenants ──────────────────────────────────────────────────────────────────

export const useTenants = (enabled = true) => useQuery({ queryKey: ['tenants'], queryFn: () => get<Tenant[]>('/v1/tenants'), enabled, staleTime: 30_000 })
export interface TenantInput { displayName: string; azureTenantId: string; domain: string; clientId: string; clientSecret: string; enabledModules: string[] }
export const useCreateTenant = () =>
  useAction((t: TenantInput) => post<Tenant>('/v1/tenants', t), { success: 'Tenant connected — the first collection starts now', invalidate: [['tenants']] })
export const useUpdateTenant = () =>
  useAction(({ id, ...body }: { id: string; displayName?: string; status?: string; enabledModules?: string[] }) => patch(`/v1/tenants/${id}`, body),
    { success: 'Tenant updated', invalidate: [['tenants']] })
export const useDeleteTenant = () => useAction((id: string) => del(`/v1/tenants/${id}`), { success: 'Tenant removed', invalidate: [['tenants']] })

// ── Admin ────────────────────────────────────────────────────────────────────

export const useUsers = (enabled: boolean) => useQuery({ queryKey: ['users'], queryFn: () => get<PlatformUser[]>('/v1/users'), enabled })
export const useCreateUser = () =>
  useAction(async (u: { email: string; displayName: string; role: string; tenantId: string | null; temporaryPassword: string }) =>
    (await authClient.post('/auth/users', u)).data, { success: 'User created — they set their own password at first sign-in', invalidate: [['users']] })
export const useUpdateUser = () =>
  useAction(async ({ id, ...body }: { id: string; role?: string; isActive?: boolean; tenantId?: string | null }) =>
    (await authClient.patch(`/auth/users/${id}`, body)).data, { success: 'User updated', invalidate: [['users']] })
export const useResetUserPassword = () =>
  useAction(async ({ id, temporaryPassword }: { id: string; temporaryPassword: string }) =>
    (await authClient.post(`/auth/users/${id}/reset-password`, { temporaryPassword })).data, { success: 'Temporary password set' })

export const useChannels = (enabled: boolean) => useTenantQuery<Channel[]>('channels', (t) => `/v1/channels?tenantId=${t}`, { enabled })
export const useCreateChannel = () =>
  useAction((c: { tenantId: string; name: string; type: string; config: Record<string, unknown>; minSeverity: string }) => post('/v1/channels', c),
    { success: 'Channel added', invalidate: [['channels']] })
export const useTestChannel = () => useAction((id: string) => post(`/v1/channels/${id}/test`), { success: 'Test notification sent — check the channel' })
export const useDeleteChannel = () => useAction((id: string) => del(`/v1/channels/${id}`), { success: 'Channel removed', invalidate: [['channels']] })

export const useAudit = (enabled: boolean, limit = 200) =>
  useQuery({ queryKey: ['audit', limit], queryFn: () => get<AuditEntry[]>(`/v1/audit?limit=${limit}`), enabled, refetchInterval: 60_000 })
export const useRetention = () => useQuery({ queryKey: ['retention'], queryFn: () => get<Retention[]>('/v1/history/retention') })
export const useSaveRetention = () =>
  useAction(async (items: { key: string; days: number }[]) => { for (const item of items) await put('/v1/history/retention', item) },
    { success: 'Retention saved', invalidate: [['retention']] })

export function useApiKeyStatus() {
  return useQuery({ queryKey: ['api-key'], queryFn: async () => (await authClient.get<{ active: boolean; createdAt: string | null }>('/auth/api-keys')).data })
}
export const useCreateApiKey = () =>
  useAction(async (_: void) => (await authClient.post<{ apiKey: string }>('/auth/api-keys')).data, { invalidate: [['api-key']] })
export const useRevokeApiKey = () =>
  useAction(async (_: void) => (await authClient.delete('/auth/api-keys')).data, { success: 'API key revoked', invalidate: [['api-key']] })

// ── Query, monitoring profile, network, workloads ────────────────────────────

/** Runs a query; errors carry the engine's message (and position) in response.data. */
export function useRunQuery() {
  return useMutation({
    mutationFn: ({ tenantId, query, windowMinutes, limit }: { tenantId: string; query: string; windowMinutes?: number | null; limit?: number }) =>
      post<QueryResult>('/v1/query', { tenantId, query, windowMinutes: windowMinutes ?? null, limit: limit ?? 500 }),
  })
}

export interface LogSource { name: string; path: string; include?: string; exclude?: string; level?: string; hosts?: string[]; tags?: string[]; platform?: string; fromStart?: boolean }
export interface EventChannel { channel: string; ids?: number[]; level?: string; hosts?: string[]; tags?: string[] }
export interface JournalUnit { unit: string; level?: string; hosts?: string[]; tags?: string[] }
export interface CheckDefinition { name: string; type: 'tcp' | 'http' | 'dns'; target: string; intervalSeconds?: number; timeoutSeconds?: number; expectStatus?: number; contains?: string; hosts?: string[]; tags?: string[] }
export interface MonitoringProfile { logs: LogSource[]; eventChannels: EventChannel[]; journalUnits: JournalUnit[]; checks: CheckDefinition[] }

export const useProfile = () =>
  useTenantQuery<{ profile: Partial<MonitoringProfile> | null; updatedAt: string | null; updatedBy: string | null }>('agent-profile', (t) => `/v1/agents/profile?tenantId=${t}`)
export const useSaveProfile = () =>
  useAction(({ tenantId, profile }: { tenantId: string; profile: MonitoringProfile }) => put(`/v1/agents/profile?tenantId=${tenantId}`, profile),
    { success: 'Saved — connected agents apply it within seconds', invalidate: [['agent-profile']] })

export interface NetworkHost {
  id: string; hostname: string; platform: string; online: boolean; rxMbps: number; txMbps: number
  connections: string | null; listeningPorts: number; exposedPorts: string[]
}
export interface NetworkSummary { hours: number; traffic: { t: string; rxMbps: number; txMbps: number }[]; hosts: NetworkHost[] }
export interface EndpointCheck {
  agentId: string; hostname: string; name: string; type: string; target: string; ok: boolean; latencyMs: number | null
  statusCode: number | null; error: string | null; certDaysLeft: number | null; checkedAt: string; failingSince: string | null; stale: boolean
}
export interface CheckPoint { t: string; name: string; latencyMs: number | null; availability: number }
export const useNetworkSummary = (hours: number) => useTenantQuery<NetworkSummary>('network', (t) => `/v1/network/summary?tenantId=${t}&hours=${hours}`, { refetch: 60_000 })
export const useChecks = () => useTenantQuery<EndpointCheck[]>('checks', (t) => `/v1/network/checks?tenantId=${t}`, { refetch: 30_000 })
export const useCheckHistory = (hours: number, name?: string) =>
  useTenantQuery<CheckPoint[]>('check-history', (t) => `/v1/network/checks/history?${qs({ tenantId: t, hours, name })}`, { refetch: 60_000 })

export interface WorkloadRow {
  agentDbId: string; agentId: string; hostname: string; platform: string; online: boolean; type: string; name: string
  status: string; startup: string | null; version: string | null; details: string | null; seenAt: string | null
}
export const useWorkloads = () => useTenantQuery<WorkloadRow[]>('workloads', (t) => `/v1/workloads?tenantId=${t}`, { refetch: 60_000 })

/** A query used as a dashboard widget (cached and refreshed like any other read). */
export function useQueryData(query: string | null, windowMinutes: number | null, refetch = 60_000) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['query-data', tenantId, query, windowMinutes],
    queryFn: () => post<QueryResult>('/v1/query', { tenantId, query, windowMinutes, limit: 1000 }),
    enabled: !!tenantId && !!query,
    refetchInterval: refetch,
  })
}
