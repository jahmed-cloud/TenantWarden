import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'
import pLimit from 'p-limit'
import pRetry from 'p-retry'
import { logger } from '../utils/logger.js'
import type { TenantConfig, RiskyUser, DeviceComplianceResult } from '../types/index.js'

const GRAPH_SCOPES = ['https://graph.microsoft.com/.default']

// ─── Graph client factory ─────────────────────────────────────────────────────

export function createGraphClient(tenant: TenantConfig): Client {
  if (!tenant.clientSecret) {
    throw new Error(`clientSecret not set for tenant ${tenant.id} — decrypt before calling collector`)
  }
  const credential = new ClientSecretCredential(
    tenant.azureTenantId,
    tenant.clientId,
    tenant.clientSecret,
  )
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: GRAPH_SCOPES,
  })
  return Client.initWithMiddleware({ authProvider })
}

// ─── Identity Protection ──────────────────────────────────────────────────────

export async function collectRiskyUsers(client: Client): Promise<RiskyUser[]> {
  const result: RiskyUser[] = []
  let url: string | undefined =
    "/identityProtection/riskyUsers?$top=100&$filter=riskLevel ne 'none'"

  while (url) {
    const page = await pRetry(
      () => client.api(url as string).get() as Promise<{ value: RiskyUser[]; '@odata.nextLink'?: string }>,
      { retries: 3, minTimeout: 1000, onFailedAttempt: (e) => logger.warn({ err: e }, 'Graph retry') },
    )
    result.push(...page.value)
    url = page['@odata.nextLink']
  }

  logger.info({ count: result.length }, 'collected risky users')
  return result
}

export async function collectRiskySignIns(client: Client, hours = 24): Promise<unknown[]> {
  const since  = new Date(Date.now() - hours * 3_600_000).toISOString()
  const result: unknown[] = []
  let url: string | undefined =
    `/auditLogs/signIns?$filter=createdDateTime ge ${since} and riskLevelAggregated ne 'none'&$top=200&$orderby=createdDateTime desc`

  while (url) {
    const page = await pRetry(
      () => client.api(url as string).get() as Promise<{ value: unknown[]; '@odata.nextLink'?: string }>,
      { retries: 3, minTimeout: 1000 },
    )
    result.push(...page.value)
    url = page['@odata.nextLink']
  }

  return result
}

// ─── Intune device compliance ─────────────────────────────────────────────────

export async function collectDeviceCompliance(client: Client): Promise<DeviceComplianceResult[]> {
  const result: DeviceComplianceResult[] = []
  let url: string | undefined =
    '/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName,azureADRegistered,isEncrypted,ownerType&$top=100'

  while (url) {
    const page = await pRetry(
      () => client.api(url as string).get() as Promise<{ value: DeviceComplianceResult[]; '@odata.nextLink'?: string }>,
      { retries: 3, minTimeout: 1000 },
    )
    result.push(...page.value)
    url = page['@odata.nextLink']
  }

  return result
}

// ─── Secure Score ─────────────────────────────────────────────────────────────

export async function collectSecureScore(client: Client): Promise<unknown> {
  const res = await pRetry(
    () => client.api('/security/secureScores?$top=1').get(),
    { retries: 3 },
  )
  return (res.value as unknown[])?.[0] ?? null
}

// ─── Conditional Access policies ──────────────────────────────────────────────

export async function collectCAPolicies(client: Client): Promise<unknown[]> {
  const res = await pRetry(
    () => client.api('/identity/conditionalAccess/policies').get(),
    { retries: 3 },
  )
  return (res.value as unknown[]) ?? []
}

// ─── Defender incidents ───────────────────────────────────────────────────────

export async function collectDefenderIncidents(client: Client): Promise<unknown[]> {
  const result: unknown[] = []
  // Everything touched in the last 30 days — resolved incidents too, so their alerts can be closed
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  let url: string | undefined = `/security/incidents?$filter=lastUpdateDateTime ge ${since}&$top=50`

  while (url) {
    const page = await pRetry(
      () => client.api(url as string).get() as Promise<{ value: unknown[]; '@odata.nextLink'?: string }>,
      { retries: 3 },
    )
    result.push(...page.value)
    url = page['@odata.nextLink']
  }

  return result
}

// ─── Service health ───────────────────────────────────────────────────────────

export async function collectServiceHealth(client: Client): Promise<unknown[]> {
  const res = await pRetry(
    () => client.api('/admin/serviceAnnouncement/healthOverviews?$expand=issues').get(),
    { retries: 3 },
  )
  return (res.value as unknown[]) ?? []
}

// ─── Auth method registration detail (drives the auth-method Sankey chart) ────
// Classification mirrors Microsoft's Zero Trust Assessment tool:
//   phish-resistant: passKeyDeviceBound, windowsHelloForBusiness, fido2
//   phishable:       microsoftAuthenticatorPush, softwareOneTimePasscode
//   single-factor:   email, mobilePhone, alternateMobilePhone (no MFA)
const METHOD_CATEGORY: Record<string, 'phish_resistant' | 'phishable' | 'single_factor'> = {
  passKeyDeviceBound:        'phish_resistant',
  passKeyDeviceBoundAuthenticator: 'phish_resistant',
  windowsHelloForBusiness:   'phish_resistant',
  fido2:                     'phish_resistant',
  microsoftAuthenticatorPush:'phishable',
  softwareOneTimePasscode:   'phishable',
  hardwareOneTimePasscode:   'phishable',
  mobilePhone:               'single_factor',
  alternateMobilePhone:      'single_factor',
  email:                     'single_factor',
}

export interface AuthMethodUser {
  isAdmin: boolean
  strongestMethod: string   // Graph's userPreferredMethodForSecondaryAuthentication-equivalent
}

export async function collectAuthMethodRegistrations(client: Client): Promise<AuthMethodUser[]> {
  const result: AuthMethodUser[] = []
  let url: string | undefined =
    '/reports/authenticationMethods/userRegistrationDetails?$select=isAdmin,methodsRegistered,userPreferredMethodForSecondaryAuthentication&$top=200'

  while (url) {
    const page = await pRetry(
      () => client.api(url as string).get() as Promise<{ value: any[]; '@odata.nextLink'?: string }>,
      { retries: 3, minTimeout: 1000 },
    )
    for (const u of page.value) {
      const methods: string[] = u.methodsRegistered ?? []
      // Pick the strongest registered method (phish-resistant > phishable > single-factor)
      const ranked = methods
        .filter(m => METHOD_CATEGORY[m])
        .sort((a, b) => {
          const rank = { phish_resistant: 0, phishable: 1, single_factor: 2 }
          return rank[METHOD_CATEGORY[a]] - rank[METHOD_CATEGORY[b]]
        })
      result.push({
        isAdmin: !!u.isAdmin,
        strongestMethod: ranked[0] ?? 'none',
      })
    }
    url = page['@odata.nextLink']
  }
  return result
}

export { METHOD_CATEGORY }

// ─── Full tenant collection cycle ─────────────────────────────────────────────

export async function runCollectionCycle(tenant: TenantConfig) {
  const client = createGraphClient(tenant)
  const limit  = pLimit(3)

  logger.info({ tenantId: tenant.id }, 'starting collection cycle')

  // Partial failure tolerance: a tenant may lack a licence (Entra P2, Intune,
  // Defender) or a permission for one dataset. Collect what we CAN rather than
  // failing the whole cycle — each failure is logged and returns an empty set.
  const settle = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      logger.warn(
        { collector: name, statusCode: e?.statusCode, msg: e?.message },
        e?.statusCode === 403
          ? `${name}: permission/licence missing — skipping (grant admin consent or check licensing)`
          : `${name}: failed — skipping`,
      )
      return fallback
    }
  }

  // Modules the tenant enabled when it was connected (empty = everything)
  const modules = new Set((tenant.enabledModules ?? []).map(m => m.toLowerCase()))
  const on = (m: string) => modules.size === 0 || modules.has(m)
  const skip = <T>(fallback: T) => Promise.resolve(fallback)

  const [
    riskyUsers,
    riskySignIns,
    devices,
    secureScore,
    caPolicies,
    incidents,
    serviceHealth,
    authMethods,
    userCount,
  ] = await Promise.all([
    on('identity') ? limit(() => settle('riskyUsers',   () => collectRiskyUsers(client),       [] as RiskyUser[])) : skip([] as RiskyUser[]),
    on('identity') ? limit(() => settle('riskySignIns', () => collectRiskySignIns(client),     [] as unknown[]))   : skip([] as unknown[]),
    on('intune')   ? limit(() => settle('devices',      () => collectDeviceCompliance(client), [] as DeviceComplianceResult[])) : skip([] as DeviceComplianceResult[]),
    on('defender') ? limit(() => settle('secureScore',  () => collectSecureScore(client),      null as unknown))   : skip(null as unknown),
    on('identity') ? limit(() => settle('caPolicies',   () => collectCAPolicies(client),       [] as unknown[]))   : skip([] as unknown[]),
    on('defender') ? limit(() => settle('incidents',    () => collectDefenderIncidents(client),[] as unknown[]))   : skip([] as unknown[]),
    limit(() => settle('serviceHealth', () => collectServiceHealth(client), [] as unknown[])),
    on('identity') ? limit(() => settle('authMethods',  () => collectAuthMethodRegistrations(client), [] as AuthMethodUser[])) : skip([] as AuthMethodUser[]),
    on('identity') ? limit(() => settle('userCount',    () => collectUserCount(client), null as number | null)) : skip(null as number | null),
  ])

  logger.info(
    { tenantId: tenant.id, riskyUsers: riskyUsers.length, devices: devices.length, incidents: incidents.length, userCount },
    'collection cycle complete',
  )

  return { riskyUsers, riskySignIns, devices, secureScore, caPolicies, incidents, serviceHealth, authMethods, userCount }
}

// ─── Total user count (needs User.Read.All) ──────────────────────────────────

export async function collectUserCount(client: Client): Promise<number | null> {
  const n = await pRetry(
    () => client.api('/users/$count').header('ConsistencyLevel', 'eventual').get(),
    { retries: 2 },
  )
  const count = typeof n === 'number' ? n : parseInt(String(n), 10)
  return Number.isFinite(count) ? count : null
}

// ─── Identity remediation ─────────────────────────────────────────────────────
// Requires IdentityRiskyUser.ReadWrite.All (dismiss / confirm) and User.RevokeSessions.All (revoke).

export type RemediationAction = 'dismiss' | 'confirm-compromised' | 'revoke-sessions'

export async function remediate(tenant: TenantConfig, action: RemediationAction, userId: string): Promise<void> {
  const client = createGraphClient(tenant)
  switch (action) {
    case 'dismiss':
      await client.api('/identityProtection/riskyUsers/dismiss').post({ userIds: [userId] })
      break
    case 'confirm-compromised':
      await client.api('/identityProtection/riskyUsers/confirmCompromised').post({ userIds: [userId] })
      break
    case 'revoke-sessions':
      await client.api(`/users/${encodeURIComponent(userId)}/revokeSignInSessions`).post({})
      break
  }
  logger.info({ tenantId: tenant.id, action, userId }, 'remediation executed')
}
