import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { AppShell }  from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/OtherPages'
import { useCurrentUser, useAlertCounts } from '@/hooks/useCurrentUser'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useThemeSync } from '@/hooks/useThemeSync'

// Lazy-loaded route pages — each becomes its own chunk, shrinking initial load
const OverviewPage      = lazy(() => import('@/components/dashboard/OverviewPageFull').then(m => ({ default: m.OverviewPage })))
const AlertsPageFull    = lazy(() => import('@/components/alerts/AlertsPageFull').then(m => ({ default: m.AlertsPageFull })))
const IdentityPageFull  = lazy(() => import('@/components/identity/IdentityPageFull').then(m => ({ default: m.IdentityPageFull })))
const AnalyticsPageFull = lazy(() => import('@/components/analytics/AnalyticsPageFull').then(m => ({ default: m.AnalyticsPageFull })))
const AgentsPageFull    = lazy(() => import('@/components/agents/AgentsPageFull').then(m => ({ default: m.AgentsPageFull })))
const AdminPageFull     = lazy(() => import('@/components/admin/AdminPageFull').then(m => ({ default: m.AdminPageFull })))
const SecurityPage      = lazy(() => import('@/pages/OtherPages').then(m => ({ default: m.SecurityPage })))
const TenantsPage       = lazy(() => import('@/pages/OtherPages').then(m => ({ default: m.TenantsPage })))
const CompliancePage    = lazy(() => import('@/pages/OtherPages').then(m => ({ default: m.CompliancePage })))
const ReportsPage       = lazy(() => import('@/pages/OtherPages').then(m => ({ default: m.ReportsPage })))
const DevicesPage       = lazy(() => import('@/pages/AlertsAndMorePages').then(m => ({ default: m.DevicesPage })))

function AuthenticatedApp() {
  useThemeSync()

  // Auto-select a tenant so data hooks (which require tenantId) start firing
  // immediately — without this, every dashboard silently shows nothing until
  // the user manually picks a tenant from the header dropdown.
  const activeTenant    = useTenantWardenStore((s) => s.activeTenant)
  const setActiveTenant = useTenantWardenStore((s) => s.setActiveTenant)
  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => (await apiClient.get('/v1/tenants')).data as any[],
  })
  useEffect(() => {
    if (!activeTenant && tenants && tenants.length > 0) {
      setActiveTenant(tenants[0])
    }
  }, [activeTenant, tenants, setActiveTenant])
   // applies .dark class to <html> — without this the theme toggle does nothing
  useCurrentUser()
  useAlertCounts()
  useWebSocket()
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading…</div>}>
      <Routes>
        <Route path="/"           element={<Navigate to="/overview" replace />} />
        <Route path="/overview"   element={<OverviewPage />} />
        <Route path="/alerts"     element={<AlertsPageFull />} />
        <Route path="/identity"   element={<IdentityPageFull />} />
        <Route path="/security"   element={<SecurityPage />} />
        <Route path="/devices"    element={<DevicesPage />} />
        <Route path="/agents"     element={<AgentsPageFull />} />
        <Route path="/tenants"    element={<TenantsPage />} />
        <Route path="/analytics"  element={<AnalyticsPageFull />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/reports"    element={<ReportsPage />} />
        <Route path="/admin"      element={<AdminPageFull />} />
        <Route path="*"           element={<Navigate to="/overview" replace />} />
      </Routes>
      </Suspense>
    </AppShell>
  )
}

export default function App() {
  const hasSession   = useTenantWardenStore((s) => !!s.accessToken)
  const mustChange   = useTenantWardenStore((s) => s.mustChangePassword || (s.currentUser as any)?.mustChangePassword)
  if (!hasSession) return <LoginPage />
  return (
    <>
      <AuthenticatedApp />
      {mustChange && <ChangePasswordModal forced />}
    </>
  )
}
