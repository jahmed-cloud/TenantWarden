export interface TenantConfig {
  id:                    string
  displayName:           string
  azureTenantId:         string
  clientId:              string
  encryptedClientSecret: string
  clientSecret:          string   // must be set (decrypted) before calling collector
  enabledModules:        string[]
}

export interface RiskyUser {
  id:                       string
  userPrincipalName:        string
  displayName:              string
  riskLevel:                string
  riskDetail:               string
  riskLastUpdatedDateTime:  string
}

export interface DeviceComplianceResult {
  id:                   string
  deviceName:           string
  operatingSystem:      string
  osVersion:            string
  complianceState:      string
  lastSyncDateTime:     string
  userPrincipalName:    string
  isEncrypted?:         boolean
  azureADRegistered?:   boolean
}

export interface GraphPage<T> {
  value:              T[]
  '@odata.nextLink'?: string
}
