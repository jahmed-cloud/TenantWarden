// types/index.ts
export interface Alert {
  id:                string
  tenantId:          string
  title:             string
  description:       string
  severity:          'critical' | 'high' | 'medium' | 'low' | 'info'
  status:            string
  source:            string
  category:          string
  affectedUsers:     string[]
  recommendedAction: string | null
  createdAt:         string
}

export interface NotificationChannel {
  id:          string
  tenantId:    string
  name:        string
  type:        string
  config:      Record<string, unknown>
  isEnabled:   boolean
  minSeverity: string
  categories:  string[]
}
