import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, patch, del } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────────

function useTenantId() {
  return useTenantWardenStore(s => s.activeTenant?.id ?? '')
}

// ── Overview ──────────────────────────────────────────────────────────────────

export function useOverviewSummary() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['overview', tenantId],
    queryFn:  () => get<OverviewSummary>(`/v1/overview/summary?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 30_000,
  })
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export function useAlerts(params?: AlertQueryParams) {
  const tenantId = useTenantId()
  const qs = new URLSearchParams({ tenantId, ...params as Record<string, string> }).toString()
  return useQuery({
    queryKey: ['alerts', tenantId, params],
    queryFn:  () => get<PagedResult<Alert>>(`/v1/alerts?${qs}`),
    enabled:  !!tenantId,
    refetchInterval: 15_000,
  })
}

export function useAlertCounts() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['alert-counts', tenantId],
    queryFn:  () => get<AlertCounts>(`/v1/alerts/counts?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 15_000,
  })
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      post(`/v1/alerts/${id}/acknowledge`, { comment }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Alert acknowledged') },
    onError:   () => toast.error('Failed to acknowledge alert'),
  })
}

export function useResolveAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      post(`/v1/alerts/${id}/resolve`, { resolution }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Alert resolved') },
    onError:   () => toast.error('Failed to resolve alert'),
  })
}

// ── Identity ──────────────────────────────────────────────────────────────────

export function useRiskyUsers() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['risky-users', tenantId],
    queryFn:  () => get<PagedResult<RiskyUser>>(`/v1/identity/risky-users?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 60_000,
  })
}

export function useIdentitySummary() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['identity-summary', tenantId],
    queryFn:  () => get<IdentitySummary>(`/v1/identity/summary?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 60_000,
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ userId, tenantId }: { userId: string; tenantId: string }) =>
      post(`/v1/identity/risky-users/${userId}/reset-password?tenantId=${tenantId}`),
    onSuccess: () => toast.success('Password reset initiated'),
    onError:   () => toast.error('Failed to reset password'),
  })
}

// ── Devices ───────────────────────────────────────────────────────────────────

export function useDevices() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['devices', tenantId],
    queryFn:  () => get<PagedResult<Device>>(`/v1/devices?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 60_000,
  })
}

// ── Agents ────────────────────────────────────────────────────────────────────

export function useAgents() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['agents', tenantId],
    queryFn:  () => get<Agent[]>(`/v1/agents?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 30_000,
  })
}

export function useAgentStats() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['agent-stats', tenantId],
    queryFn:  () => get<AgentStats>(`/v1/agents/stats?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 30_000,
  })
}

// ── Tenants ───────────────────────────────────────────────────────────────────

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn:  () => get<Tenant[]>('/v1/tenants'),
    staleTime: 60_000,
  })
}

export function useCreateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateTenantRequest) => post<Tenant>('/v1/tenants', req),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['tenants'] }); toast.success('Tenant connected') },
    onError:    () => toast.error('Failed to connect tenant'),
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Alert { id:string; tenantId:string; title:string; description:string; severity:string; status:string; source:string; category:string; affectedUsers:string[]; assignedTo:string|null; createdAt:string }
export interface AlertCounts { critical:number; high:number; medium:number; low:number }
export interface AlertQueryParams { severity?:string; status?:string; search?:string; page?:string; pageSize?:string }
export interface RiskyUser { id:string; userPrincipalName:string; displayName:string; riskLevel:string; riskDetail:string; countryCode:string|null; ipAddress:string|null }
export interface IdentitySummary { totalUsers:number; riskyUsers:number; mfaEnabled:number; mfaPercent:number; caPolicies:number; secureScore:number }
export interface Device { id:string; deviceName:string; operatingSystem:string; osVersion:string; complianceState:string; userPrincipalName:string; lastSyncDateTime:string }
export interface Agent { id:string; agentId:string; hostname:string; platform:string; version:string; status:string; osName:string; ipAddress:string; cpuPercent:number; memoryPercent:number; diskPercent:number; lastHeartbeatAt:string }
export interface AgentStats { total:number; online:number; windows:number; linux:number; macOs:number; docker:number }
export interface Tenant { id:string; displayName:string; azureTenantId:string; domain:string; status:string; userCount:number; deviceCount:number; lastSyncAt:string|null; enabledModules:string[] }
export interface CreateTenantRequest { displayName:string; azureTenantId:string; domain:string; clientId:string; clientSecret:string }
export interface PagedResult<T> { items:T[]; total:number; page:number; pageSize:number; totalPages:number }
export interface OverviewSummary { alerts:AlertCounts; agents:AgentStats; identity:IdentitySummary; devices:{total:number;compliant:number;nonCompliant:number}; lastUpdated:string }
