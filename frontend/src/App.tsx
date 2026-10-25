import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { refreshAccessToken } from '@/services/api/client'
import { useMe, useTenants } from '@/services/api/hooks'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { useThemeSync } from '@/hooks/useThemeSync'
import { AppShell } from '@/components/AppShell'
import { ChangePasswordDialog } from '@/components/AccountDialogs'
import { LoginPage } from '@/pages/LoginPage'

// One chunk per page
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const OverviewPage   = page(() => import('@/pages/OverviewPage'), 'OverviewPage')
const AlertsPage     = page(() => import('@/pages/AlertsPage'), 'AlertsPage')
const AnalyticsPage  = page(() => import('@/pages/AnalyticsPage'), 'AnalyticsPage')
const IdentityPage   = page(() => import('@/pages/IdentityPage'), 'IdentityPage')
const SecurityPage   = page(() => import('@/pages/SecurityPage'), 'SecurityPage')
const DevicesPage    = page(() => import('@/pages/DevicesPage'), 'DevicesPage')
const CompliancePage = page(() => import('@/pages/CompliancePage'), 'CompliancePage')
const AgentsPage     = page(() => import('@/pages/AgentsPage'), 'AgentsPage')
const QueryPage      = page(() => import('@/pages/QueryPage'), 'QueryPage')
const WorkloadsPage  = page(() => import('@/pages/WorkloadsPage'), 'WorkloadsPage')
const NetworkPage    = page(() => import('@/pages/NetworkPage'), 'NetworkPage')
const TenantsPage    = page(() => import('@/pages/TenantsPage'), 'TenantsPage')
const ReportsPage    = page(() => import('@/pages/ReportsPage'), 'ReportsPage')
const AdminPage      = page(() => import('@/pages/AdminPage'), 'AdminPage')

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface-variant">
      <Loader2 className="animate-spin" />
    </div>
  )
}

function AuthenticatedApp() {
  const { data: me } = useMe(true)
  const setCurrentUser = useTenantWardenStore((s) => s.setCurrentUser)
  const currentUser = useTenantWardenStore((s) => s.currentUser)
  const activeTenant = useTenantWardenStore((s) => s.activeTenant)
  const setActiveTenant = useTenantWardenStore((s) => s.setActiveTenant)
  const { data: tenants } = useTenants()

  useEffect(() => { if (me) setCurrentUser(me) }, [me, setCurrentUser])

  // Keep a valid tenant selected so every page has data without a manual pick
  useEffect(() => {
    if (!tenants) return
    if (tenants.length === 0) { if (activeTenant) setActiveTenant(null); return }
    if (!activeTenant || !tenants.some((t) => t.id === activeTenant.id))
      setActiveTenant({ id: tenants[0].id, displayName: tenants[0].displayName })
  }, [tenants, activeTenant, setActiveTenant])

  const noTenants = tenants?.length === 0

  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-24 text-on-surface-variant"><Loader2 className="animate-spin" /></div>}>
        <Routes>
          <Route path="/" element={<Navigate to={noTenants ? '/tenants' : '/overview'} replace />} />
          <Route path="/overview" element={noTenants ? <Navigate to="/tenants" replace /> : <OverviewPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/identity" element={<IdentityPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/query" element={<QueryPage />} />
          <Route path="/workloads" element={<WorkloadsPage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Suspense>
      <ChangePasswordDialog open={!!currentUser?.mustChangePassword} onClose={() => undefined} forced />
    </AppShell>
  )
}

export default function App() {
  useThemeSync()
  const token = useTenantWardenStore((s) => s.accessToken)
  // On load, try the refresh cookie first so a reload doesn't mean signing in again
  const [restoring, setRestoring] = useState(!token)
  useEffect(() => {
    if (!token) void refreshAccessToken().finally(() => setRestoring(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (restoring) return <Splash />
  return token ? <AuthenticatedApp /> : <LoginPage />
}
