export interface UserProfile {
  id:          string
  email:       string
  displayName: string
  role:        string
  tenantId:    string | null
  mfaEnabled:  boolean
  lastLoginAt: string | null
}
