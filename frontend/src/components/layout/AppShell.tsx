import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { msalInstance } from '@/services/auth/msalConfig'
import { useState } from 'react'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import {
  LayoutDashboard, Bell, BarChart3, Fingerprint, Shield, Laptop2,
  Mail, ClipboardCheck, Cpu, Building2, FileBarChart, Settings,
  ChevronDown, Search, LogOut, Moon, Sun, Zap, Menu, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useTenantWardenStore } from '@/store/tenantWardenStore'

interface NavItem {
  label:  string
  path:   string
  icon:   React.ElementType
  badge?: number
  group:  string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview',   path: '/overview',   icon: LayoutDashboard, group: 'Platform' },
  { label: 'Alerts',     path: '/alerts',      icon: Bell,            group: 'Platform' },
  { label: 'Analytics',  path: '/analytics',   icon: BarChart3,        group: 'Platform' },
  { label: 'Identity',   path: '/identity',    icon: Fingerprint,     group: 'Microsoft 365' },
  { label: 'Security',   path: '/security',    icon: Shield,          group: 'Microsoft 365' },
  { label: 'Devices',    path: '/devices',     icon: Laptop2,         group: 'Microsoft 365' },
  { label: 'Exchange',   path: '/exchange',    icon: Mail,            group: 'Microsoft 365' },
  { label: 'Compliance', path: '/compliance',  icon: ClipboardCheck,  group: 'Microsoft 365' },
  { label: 'Agents',     path: '/agents',      icon: Cpu,             group: 'Infrastructure' },
  { label: 'Tenants',    path: '/tenants',     icon: Building2,       group: 'Infrastructure' },
  { label: 'Reports',    path: '/reports',     icon: FileBarChart,    group: 'Infrastructure' },
  { label: 'Admin',      path: '/admin',       icon: Settings,        group: 'Infrastructure' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname }       = useLocation()
  const logout = useTenantWardenStore((s) => s.logout)
  const currentUser = useTenantWardenStore((s) => s.currentUser)
  const [showPw, setShowPw] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { theme, setTheme, activeTenant, sidebarCollapsed, alertCounts, wsConnected } = useTenantWardenStore()

  const navGroups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  const totalAlerts = alertCounts.critical + alertCounts.high

  const pwModal = showPw ? <ChangePasswordModal onClose={() => setShowPw(false)} /> : null
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {pwModal}
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileOpen(false)} />}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={clsx(
        'w-56 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col z-40',
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform',
        mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
      )}>

        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <Shield size={14} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">TenantWarden</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">for Microsoft 365</div>
            </div>
          </div>

          {/* Tenant switcher */}
          <button className="mt-3 w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-md hover:bg-gray-100 dark:hover:bg-gray-750 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              <span className="truncate">{activeTenant?.displayName ?? 'Select tenant'}</span>
            </div>
            <ChevronDown size={11} className="flex-shrink-0" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {Object.entries(navGroups).map(([group, items]) => (
            <div key={group} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">{group}</div>
              {items.map(item => {
                const active  = pathname === item.path
                const badge   = item.label === 'Alerts' ? (totalAlerts > 0 ? totalAlerts : undefined) : undefined
                const Icon    = item.icon
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={clsx(
                      'flex items-center gap-2.5 px-2.5 py-1.5 text-xs rounded-md mb-0.5 transition-colors',
                      active
                        ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                    )}
                  >
                    <Icon size={14} />
                    <span className="flex-1" onClick={() => setMobileOpen(false)}>{item.label}</span>
                    {badge !== undefined && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 font-medium">
                        {badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-xs font-medium text-blue-700 dark:text-blue-300 flex-shrink-0">
              {currentUser?.displayName?.slice(0, 2).toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{currentUser?.displayName ?? 'User'}</div>
              <div className="text-[10px] text-gray-400 truncate">{currentUser?.email ?? ''}</div>
            </div>
            <button
              onClick={() => { logout(); msalInstance?.getActiveAccount() && msalInstance.logoutRedirect() }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Sign out"
            >
              <button onClick={() => setShowPw(true)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mr-3">Change password</button>
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header className="h-12 flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-3 md:px-5 gap-3">
          <button onClick={() => setMobileOpen(true)} className="md:hidden w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Menu size={18} />
          </button>
          <div className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {NAV_ITEMS.find(n => n.path === pathname)?.label ?? 'TenantWarden'}
          </div>

          {/* Search */}
          <div className="hidden sm:flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 w-56">
            <Search size={13} className="text-gray-400" />
            <input
              placeholder="Search..."
              className="bg-transparent text-xs text-gray-900 dark:text-gray-100 outline-none w-full placeholder:text-gray-400"
            />
            <kbd className="text-[10px] text-gray-300 dark:text-gray-600">⌘K</kbd>
          </div>

          {/* Live-updates indicator — only shown while the WebSocket is actually connected */}
          {wsConnected && (
            <div className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Live
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Alerts bell */}
          <Link to="/alerts" className="relative w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Bell size={14} />
            {totalAlerts > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
    </div>
  )
}
