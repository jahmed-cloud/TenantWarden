-- ─── 011: Defender incidents, agent telemetry, retention, default alert rules ─

-- Defender XDR incidents (collector upserts one row per incident)
CREATE TABLE IF NOT EXISTS security_incidents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id      TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    severity         TEXT NOT NULL,              -- informational | low | medium | high
    status           TEXT NOT NULL,              -- active | inProgress | resolved | redirected
    classification   TEXT,
    determination    TEXT,
    assigned_to      TEXT,
    alert_count      INT  NOT NULL DEFAULT 0,
    incident_web_url TEXT,
    created_at       TIMESTAMPTZ NOT NULL,
    last_update_at   TIMESTAMPTZ,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, incident_id)
);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created ON security_incidents (tenant_id, created_at DESC);

-- Alerts raised from an external record (incident, rule run, agent event) carry an
-- external_id so the same record never raises a second open alert.
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_external ON alerts (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_created  ON alerts (tenant_id, created_at DESC);

-- Agents registered through the agent gateway have no key/fingerprint of their own
ALTER TABLE agents ALTER COLUMN jwt_public_key SET DEFAULT '';
ALTER TABLE agents ALTER COLUMN fingerprint    SET DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS inventory      JSONB;       -- latest services / updates / disks / BitLocker
ALTER TABLE agents ADD COLUMN IF NOT EXISTS inventory_at   TIMESTAMPTZ;

-- Warnings and errors reported by agents (event logs, journald, failed services)
CREATE TABLE IF NOT EXISTS agent_events (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id     UUID NOT NULL,
    hostname     TEXT NOT NULL,
    level        TEXT NOT NULL,                  -- critical | error | warning
    source       TEXT NOT NULL,
    message      TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_tenant ON agent_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent  ON agent_events (agent_id, occurred_at DESC);

-- Tables appended every collection cycle need a retention window too
INSERT INTO retention_config (key, days, description) VALUES
  ('service_health',      30, 'M365 service health snapshots'),
  ('auth_method_summary', 90, 'Authentication-method registration snapshots'),
  ('agent_events',        30, 'Agent warnings and errors'),
  ('security_incidents', 365, 'Defender XDR incidents')
ON CONFLICT (key) DO NOTHING;

-- Starter alert rules for every tenant that has none. threshold_value / window_minutes
-- are the source of truth; condition holds the metric and comparison operator.
CREATE OR REPLACE FUNCTION create_default_alert_rules(t UUID) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO alert_rules (tenant_id, name, description, severity, source, condition, threshold_value, window_minutes, cooldown_minutes)
  SELECT t, r.name, r.description, r.severity::alert_severity, r.source::alert_source, r.condition::jsonb, r.threshold, r.win, r.cooldown
  FROM (VALUES
    ('High-risk users present',      'Entra ID Identity Protection reports users at high risk.',          'high',   'entra_id', '{"metric":"risky_users_high","operator":"gt"}',      0, 60,   240),
    ('Risky sign-in spike',          'More risky sign-ins than usual within the window.',                 'high',   'entra_id', '{"metric":"risky_signins","operator":"gt"}',         5, 60,   120),
    ('Non-compliant devices',        'Intune reports devices that are not compliant.',                     'medium', 'intune',   '{"metric":"non_compliant_devices","operator":"gt"}', 0, 60,  1440),
    ('Secure Score below 50%',       'Microsoft Secure Score dropped under half of the maximum.',          'medium', 'defender', '{"metric":"secure_score","operator":"lt"}',         50, 60, 1440),
    ('Agent offline',                'An endpoint agent has stopped reporting for more than 5 minutes.',   'medium', 'agent',    '{"metric":"agents_offline","operator":"gt"}',        0, 5,     60)
  ) AS r(name, description, severity, source, condition, threshold, win, cooldown)
  WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = t AND name = r.name);
$$;

SELECT create_default_alert_rules(id) FROM tenants;

-- API keys: SHA-256 of a 256-bit random key, looked up by hash (see auth-service UserService.HashApiKey).
-- Keys from older builds were bcrypt-hashed and can't be looked up — clear them.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ;
UPDATE platform_users SET api_key_hash = NULL WHERE api_key_hash LIKE '$2%';
CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON platform_users (api_key_hash) WHERE api_key_hash IS NOT NULL;
