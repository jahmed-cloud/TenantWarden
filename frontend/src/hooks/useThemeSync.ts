import { useEffect } from 'react'
import { useTenantWardenStore } from '@/store/tenantWardenStore'

export function useThemeSync() {
  const theme = useTenantWardenStore(s => s.theme)

  useEffect(() => {
    const root = document.documentElement
    const mq   = window.matchMedia('(prefers-color-scheme: dark)')

    function apply() {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches)
      root.classList.toggle('dark', isDark)
    }

    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])
}
