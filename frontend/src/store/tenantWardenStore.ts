import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole =
  | 'super_admin' | 'org_admin' | 'security_admin' | 'global_reader' | 'soc_analyst'
  | 'helpdesk' | 'auditor' | 'viewer' | 'api_user'

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  tenantId: string | null
  mfaEnabled: boolean
  lastLoginAt: string | null
  mustChangePassword?: boolean
}

export interface ActiveTenant {
  id: string
  displayName: string
}

type Theme = 'light' | 'dark' | 'system'

interface TenantWardenState {
  // Session. The access token stays in memory only; a reload gets a new one from the
  // httpOnly refresh cookie (see services/api/client.ts).
  accessToken: string | null
  currentUser: CurrentUser | null
  setSession: (token: string, user?: CurrentUser | null) => void
  setAccessToken: (token: string) => void
  setCurrentUser: (user: CurrentUser | null) => void
  clearSession: () => void

  activeTenant: ActiveTenant | null
  setActiveTenant: (tenant: ActiveTenant | null) => void

  theme: Theme
  setTheme: (theme: Theme) => void
  navCollapsed: boolean
  setNavCollapsed: (v: boolean) => void
}

export const useTenantWardenStore = create<TenantWardenState>()(
  persist(
    (set) => ({
      accessToken: null,
      currentUser: null,
      setSession: (accessToken, user) => set((s) => ({ accessToken, currentUser: user ?? s.currentUser })),
      setAccessToken: (accessToken) => set({ accessToken }),
      setCurrentUser: (currentUser) => set({ currentUser }),
      clearSession: () => set({ accessToken: null, currentUser: null }),

      activeTenant: null,
      setActiveTenant: (activeTenant) => set({ activeTenant }),

      theme: 'light',
      setTheme: (theme) => set({ theme }),
      navCollapsed: false,
      setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
    }),
    {
      name: 'tenantwarden-store',
      version: 2,
      // Preferences only — never the token
      partialize: (s) => ({ theme: s.theme, navCollapsed: s.navCollapsed, activeTenant: s.activeTenant }),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<TenantWardenState>
        return { theme: p.theme ?? 'light', navCollapsed: false, activeTenant: p.activeTenant ?? null } as TenantWardenState
      },
    },
  ),
)

/** True when the dark palette is showing (explicit choice or the OS setting). */
export function useIsDark(): boolean {
  const theme = useTenantWardenStore((s) => s.theme)
  return theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

// What each role may do in the portal. The API enforces the same lists; this only hides
// controls a user can't use.
const ROLE_ACTIONS = {
  triageAlerts:  ['soc_analyst', 'security_admin', 'org_admin', 'super_admin'],
  editRules:     ['security_admin', 'org_admin', 'super_admin'],
  remediate:     ['security_admin', 'org_admin', 'super_admin'],
  manageAgents:  ['security_admin', 'org_admin', 'super_admin'],
  manageUsers:   ['org_admin', 'super_admin'],
  manageChannels:['org_admin', 'super_admin'],
  viewAudit:     ['auditor', 'org_admin', 'super_admin'],
  manageTenants: ['super_admin'],
} satisfies Record<string, UserRole[]>

export type RoleAction = keyof typeof ROLE_ACTIONS

export function useCan(action: RoleAction): boolean {
  const role = useTenantWardenStore((s) => s.currentUser?.role)
  return !!role && (ROLE_ACTIONS[action] as string[]).includes(role)
}
