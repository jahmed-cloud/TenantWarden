import { useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3, Bell, Building2, Cable, ChevronDown, Database, SearchCode, ClipboardCheck, Cpu, ExternalLink, FileBarChart, Fingerprint, KeyRound,
  LayoutDashboard, Laptop2, LogOut, Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw,
  Settings, Shield, ShieldCheck, Sun, type LucideIcon,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/services/api/client'
import { useAlertCounts, useCollectNow, useTenants } from '@/services/api/hooks'
import { useTenantWardenStore, useCan } from '@/store/tenantWardenStore'
import { ChangePasswordDialog, MfaDialog } from '@/components/AccountDialogs'
import { MachineScopePicker } from '@/components/MachineScope'
import { WEBSITE, Wordmark } from '@/components/Brand'
import { IconButton, Menu, MenuItem, cx } from '@/components/ui'

interface NavItem { label: string; path: string; icon: LucideIcon }

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Monitor', items: [
    { label: 'Overview', path: '/overview', icon: LayoutDashboard },
    { label: 'Alerts', path: '/alerts', icon: Bell },
    { label: 'Query', path: '/query', icon: SearchCode },
    { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  ] },
  { group: 'Microsoft 365', items: [
    { label: 'Identity', path: '/identity', icon: Fingerprint },
    { label: 'Security', path: '/security', icon: Shield },
    { label: 'Devices', path: '/devices', icon: Laptop2 },
    { label: 'Compliance', path: '/compliance', icon: ClipboardCheck },
  ] },
  { group: 'Endpoints', items: [
    { label: 'Agents', path: '/agents', icon: Cpu },
    { label: 'Workloads', path: '/workloads', icon: Database },
    { label: 'Network', path: '/network', icon: Cable },
  ] },
  { group: 'Manage', items: [
    { label: 'Tenants', path: '/tenants', icon: Building2 },
    { label: 'Reports', path: '/reports', icon: FileBarChart },
    { label: 'Admin', path: '/admin', icon: Settings },
  ] },
]

function NavContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const counts = useAlertCounts().data
  const urgent = (counts?.critical ?? 0) + (counts?.high ?? 0)
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4">
      {NAV.map((g) => (
        <div key={g.group} className="mt-3">
          {!collapsed && <div className="px-4 pb-1 text-[11px] font-medium tracking-wider uppercase text-on-surface-variant/80">{g.group}</div>}
          {g.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) => cx(
                'state-layer flex items-center gap-3 h-12 rounded-full text-sm font-medium my-0.5',
                collapsed ? 'justify-center px-0' : 'px-4',
                isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant',
              )}
            >
              <span className="relative">
                <item.icon size={20} />
                {collapsed && item.path === '/alerts' && urgent > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-error" />}
              </span>
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.path === '/alerts' && urgent > 0 && (
                <span className="min-w-[22px] h-5 px-1.5 rounded-full bg-error text-on-error text-[11px] flex items-center justify-center">{urgent}</span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function TenantSwitcher() {
  const { data: tenants } = useTenants()
  const active = useTenantWardenStore((s) => s.activeTenant)
  const setActive = useTenantWardenStore((s) => s.setActiveTenant)
  const navigate = useNavigate()
  const canManage = useCan('manageTenants')
  const current = tenants?.find((t) => t.id === active?.id)
  return (
    <Menu align="left" trigger={(toggle) => (
      <button type="button" onClick={toggle} className="state-layer h-10 pl-3 pr-2 rounded-full flex items-center gap-2 bg-surface-container-high max-w-full">
        <Building2 size={16} className="text-on-surface-variant shrink-0" />
        <span className="text-sm font-medium truncate">{current?.displayName ?? active?.displayName ?? 'No tenant'}</span>
        {current && current.status !== 'active' && <span className="w-2 h-2 rounded-full bg-warning shrink-0" title={current.status} />}
        <ChevronDown size={16} className="text-on-surface-variant shrink-0" />
      </button>
    )}>
      {(close) => (
        <>
          <div className="px-4 pt-1 pb-2 text-[11px] uppercase tracking-wider text-on-surface-variant">Tenants</div>
          {tenants?.map((t) => (
            <MenuItem key={t.id} active={t.id === active?.id} onClick={() => { setActive({ id: t.id, displayName: t.displayName }); close() }}>
              {t.displayName}
            </MenuItem>
          ))}
          {canManage && (
            <>
              <div className="my-1 border-t border-outline-variant" />
              <MenuItem icon={Building2} onClick={() => { navigate('/tenants'); close() }}>Manage tenants</MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  )
}

function AccountMenu() {
  const user = useTenantWardenStore((s) => s.currentUser)
  const clearSession = useTenantWardenStore((s) => s.clearSession)
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<'password' | 'mfa' | null>(null)
  const initials = (user?.displayName || user?.email || '?').split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')

  async function signOut() {
    try { await authClient.post('/auth/logout') } catch { /* the session ends locally either way */ }
    qc.clear()
    clearSession()
  }

  return (
    <>
      <Menu trigger={(toggle) => (
        <button type="button" onClick={toggle} aria-label="Account" className="state-layer w-10 h-10 rounded-full bg-primary-container text-on-primary-container text-sm font-medium">
          {initials}
        </button>
      )}>
        {(close) => (
          <>
            <div className="px-4 pt-2 pb-3 border-b border-outline-variant mb-1">
              <div className="text-sm font-medium text-on-surface truncate">{user?.displayName}</div>
              <div className="text-xs text-on-surface-variant truncate">{user?.email}</div>
              <div className="text-[11px] text-on-surface-variant mt-1">{user?.role.replace('_', ' ')}</div>
            </div>
            <MenuItem icon={KeyRound} onClick={() => { setDialog('password'); close() }}>Change password</MenuItem>
            <MenuItem icon={ShieldCheck} onClick={() => { setDialog('mfa'); close() }}>
              Two-step sign-in {user?.mfaEnabled ? '(on)' : '(off)'}
            </MenuItem>
            <MenuItem icon={ExternalLink} onClick={() => { window.open(WEBSITE, '_blank', 'noopener'); close() }}>Website and docs</MenuItem>
            <div className="my-1 border-t border-outline-variant" />
            <MenuItem icon={LogOut} onClick={() => { close(); void signOut() }}>Sign out</MenuItem>
          </>
        )}
      </Menu>
      <ChangePasswordDialog open={dialog === 'password'} onClose={() => setDialog(null)} />
      <MfaDialog open={dialog === 'mfa'} onClose={() => setDialog(null)} />
    </>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useTenantWardenStore((s) => s.navCollapsed)
  const setCollapsed = useTenantWardenStore((s) => s.setNavCollapsed)
  const theme = useTenantWardenStore((s) => s.theme)
  const setTheme = useTenantWardenStore((s) => s.setTheme)
  const [mobileOpen, setMobileOpen] = useState(false)
  const collect = useCollectNow()
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const dark = theme === 'dark'

  const brand = (compact: boolean) => (
    <a href={WEBSITE} target="_blank" rel="noreferrer" title="tenantwarden.org"
      className={cx('flex items-center gap-3 h-16 shrink-0', compact ? 'justify-center' : 'px-6')}>
      <Wordmark compact={compact} />
    </a>
  )

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Standard drawer (desktop) */}
      <aside className={cx('hidden lg:flex flex-col sticky top-0 h-screen bg-surface-container-low transition-[width] duration-200',
        collapsed ? 'w-20' : 'w-[264px]')}>
        {brand(collapsed)}
        <NavContent collapsed={collapsed} />
        <div className={cx('flex items-center gap-2 p-3 text-[11px] text-on-surface-variant', collapsed ? 'justify-center' : 'justify-between px-6')}>
          {!collapsed && <a href={WEBSITE} target="_blank" rel="noreferrer" className="hover:text-primary">tenantwarden.org · v1.0</a>}
          <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(!collapsed)} />
        </div>
      </aside>

      {/* Modal drawer (mobile) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setMobileOpen(false)}>
          <aside className="w-[280px] h-full bg-surface-container-low rounded-r-2xl flex flex-col shadow-e3" onClick={(e) => e.stopPropagation()}>
            {brand(false)}
            <NavContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 flex items-center gap-2 px-3 sm:px-6 bg-surface/90 backdrop-blur">
          <IconButton icon={MenuIcon} label="Open navigation" className="lg:hidden" onClick={() => setMobileOpen(true)} />
          <TenantSwitcher />
          <MachineScopePicker />
          <div className="flex-1" />
          <IconButton icon={RefreshCw} label="Collect from Microsoft Graph now"
            className={collect.isPending ? 'animate-spin' : undefined}
            onClick={() => collect.mutate(undefined, { onSuccess: () => setTimeout(() => qc.invalidateQueries(), 20_000) })} />
          <IconButton icon={dark ? Sun : Moon} label={dark ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')} />
          <AccountMenu />
        </header>
        {/* Keyed by route so each page fades up as it opens */}
        <main key={pathname} className="flex-1 px-3 sm:px-6 pb-10 pt-2 max-w-[1600px] w-full mx-auto animate-fade-up">{children}</main>
      </div>
    </div>
  )
}
