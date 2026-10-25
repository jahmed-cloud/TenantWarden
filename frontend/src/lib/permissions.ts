// Microsoft Graph application permissions, per collector module. Shown when connecting a
// tenant and kept in step with the README's permission table.
export const GRAPH_PERMISSIONS: { permission: string; module: string; why: string; optional?: boolean }[] = [
  { permission: 'User.Read.All', module: 'identity', why: 'Directory user count' },
  { permission: 'IdentityRiskyUser.Read.All', module: 'identity', why: 'Risky users (Entra ID P2)' },
  { permission: 'AuditLog.Read.All', module: 'identity', why: 'Risky sign-ins and MFA registration' },
  { permission: 'Policy.Read.All', module: 'identity', why: 'Conditional Access policies' },
  { permission: 'DeviceManagementManagedDevices.Read.All', module: 'intune', why: 'Managed devices and compliance' },
  { permission: 'SecurityEvents.Read.All', module: 'defender', why: 'Microsoft Secure Score' },
  { permission: 'SecurityIncident.Read.All', module: 'defender', why: 'Defender XDR incidents' },
  { permission: 'ServiceHealth.Read.All', module: 'all', why: 'Microsoft 365 service health' },
  { permission: 'IdentityRiskyUser.ReadWrite.All', module: 'identity', why: 'Dismiss risk / confirm compromised', optional: true },
  { permission: 'User.RevokeSessions.All', module: 'identity', why: 'Revoke a user’s sessions', optional: true },
]

export const MODULES = [
  { id: 'identity', label: 'Identity', detail: 'Entra ID risk, sign-ins, MFA, Conditional Access' },
  { id: 'intune', label: 'Devices', detail: 'Intune compliance and encryption' },
  { id: 'defender', label: 'Security', detail: 'Secure Score and Defender XDR incidents' },
]
