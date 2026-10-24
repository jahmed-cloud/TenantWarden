-- Performance indexes for hot query paths (idempotent)

-- Users are looked up by Azure OID on every SSO login
CREATE INDEX IF NOT EXISTS idx_platform_users_azure_oid
  ON platform_users (azure_object_id) WHERE azure_object_id IS NOT NULL;

-- The hottest alert query: "active alerts for tenant, newest first"
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_status_created
  ON alerts (tenant_id, status, created_at DESC);

-- Risky users filtered by tenant + risk level
CREATE INDEX IF NOT EXISTS idx_risky_users_tenant_risk
  ON risky_users (tenant_id, risk_level) WHERE risk_level != 'none';

-- Devices by tenant + compliance state (dashboard tiles)
CREATE INDEX IF NOT EXISTS idx_devices_tenant_compliance
  ON managed_devices (tenant_id, compliance_state);

-- Notification channel lookup by tenant (dispatch path, runs per alert)
CREATE INDEX IF NOT EXISTS idx_notif_channels_tenant_enabled
  ON notification_channels (tenant_id, is_enabled) WHERE is_enabled = TRUE;

-- Agent heartbeat staleness sweep (scheduler runs this nightly)
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat
  ON agents (last_heartbeat_at) WHERE status != 'offline';
