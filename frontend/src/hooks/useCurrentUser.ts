import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import type { UserProfile } from '@/types'

export function useCurrentUser() {
  const accessToken = useTenantWardenStore((s) => s.accessToken)
  const { setCurrentUser, setTenants, setActiveTenant, tenants, activeTenant } = useTenantWardenStore()

  const { data: profile } = useQuery({
    queryKey: ['current-user'],
    queryFn:  () => get<UserProfile>('/auth/me'),
    enabled:  !!accessToken,
    retry:    false,
  })

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-init'],
    queryFn:  () => get<any[]>('/v1/tenants'),
    enabled:  !!profile,
  })

  useEffect(() => {
    if (profile) setCurrentUser(profile as any)
  }, [profile, setCurrentUser])

  useEffect(() => {
    if (tenantsData?.length) {
      setTenants(tenantsData as any)
      if (!activeTenant) setActiveTenant(tenantsData[0] as any)
    }
  }, [tenantsData, setTenants, setActiveTenant, activeTenant])
}

export function useAlertCounts() {
  const tenantId = useTenantWardenStore(s => s.activeTenant?.id ?? '')
  const setAlertCounts = useTenantWardenStore(s => s.setAlertCounts)

  const { data } = useQuery({
    queryKey: ['alert-counts-global', tenantId],
    queryFn:  () => get<{ critical:number; high:number; medium:number; low:number }>(`/v1/alerts/counts?tenantId=${tenantId}`),
    enabled:  !!tenantId,
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (data) setAlertCounts(data)
  }, [data, setAlertCounts])
}
