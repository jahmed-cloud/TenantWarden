import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string
  displayName: string
  tenantId: string
  userCount: number
  deviceCount: number
  agentCount: number
  status: 'active' | 'paused' | 'error'
  lastSync: string
  modules: string[]
}

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  tenantId: string
  avatar?: string
}

export type UserRole =
  | 'super_admin'
  | 'org_admin'
  | 'security_admin'
  | 'global_reader'
  | 'soc_analyst'
  | 'helpdesk'
  | 'auditor'
  | 'viewer'
  | 'api_user'

export interface LiveStats {
  riskyUsers: number
  activeAlerts: number
  nonCompliantDevices: number
  secureScore: number
  agentsOnline: number
  eventsPerSecond: number
  lastUpdated: string
}

interface TenantWardenState {
  // Active tenant context
  activeTenant: Tenant | null
  tenants: Tenant[]
  setActiveTenant: (tenant: Tenant) => void
  setTenants: (tenants: Tenant[]) => void

  // Current user + local session
  currentUser: CurrentUser | null
  setCurrentUser: (user: CurrentUser | null) => void
  accessToken: string | null
  setAccessToken: (token: string | null) => void
  logout: () => void
  mustChangePassword: boolean
  setMustChangePassword: (v: boolean) => void

  // Live stats (updated via WebSocket)
  liveStats: LiveStats | null
  updateLiveStats: (stats: Partial<LiveStats>) => void

  // UI preferences
  sidebarCollapsed: boolean
  theme: 'light' | 'dark' | 'system'
  setSidebarCollapsed: (v: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void

  // Alert badge counts
  alertCounts: { critical: number; high: number; medium: number; low: number }
  setAlertCounts: (counts: TenantWardenState['alertCounts']) => void

  // WebSocket connection state
  wsConnected: boolean
  setWsConnected: (v: boolean) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTenantWardenStore = create<TenantWardenState>()(
  persist(
    immer((set) => ({
      activeTenant: null,
      tenants: [],
      setActiveTenant: (tenant) => set((s) => { s.activeTenant = tenant }),
      setTenants: (tenants) => set((s) => { s.tenants = tenants }),

      currentUser: null,
      setCurrentUser: (user) => set((s) => { s.currentUser = user }),
      accessToken: null,
      setAccessToken: (token) => set((s) => { s.accessToken = token }),
      logout: () => set((s) => { s.accessToken = null; s.currentUser = null; s.mustChangePassword = false }),
      mustChangePassword: false,
      setMustChangePassword: (v) => set((s) => { s.mustChangePassword = v }),

      liveStats: null,
      updateLiveStats: (stats) =>
        set((s) => {
          s.liveStats = { ...(s.liveStats ?? {}) as LiveStats, ...stats }
        }),

      sidebarCollapsed: false,
      theme: 'light',
      setSidebarCollapsed: (v) => set((s) => { s.sidebarCollapsed = v }),
      setTheme: (theme) => set((s) => { s.theme = theme }),

      alertCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      setAlertCounts: (counts) => set((s) => { s.alertCounts = counts }),

      wsConnected: false,
      setWsConnected: (v) => set((s) => { s.wsConnected = v }),
    })),
    {
      name: 'tenantwarden-store',
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        activeTenant: s.activeTenant,
        accessToken: s.accessToken,
        currentUser: s.currentUser,
      }),
    },
  ),
)
