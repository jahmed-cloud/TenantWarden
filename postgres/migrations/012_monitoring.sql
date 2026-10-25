-- ─── 012: network monitoring, endpoint checks, monitoring profiles, more default rules ─

-- Latest network figures per host (history lives in ClickHouse agent_metrics)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS net_rx_bps  BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS net_tx_bps  BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS connections JSONB;      -- {"established":n,"listen":n,"time_wait":n,"close_wait":n}

-- Synthetic checks (TCP / HTTP / DNS) the agents run from the monitoring profile: latest result per
-- agent and check, plus a short history for latency charts.
CREATE TABLE IF NOT EXISTS endpoint_checks (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL,
    hostname        TEXT NOT NULL,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,                  -- tcp | http | dns
    target          TEXT NOT NULL,
    ok              BOOLEAN NOT NULL,
    latency_ms      INT,
    status_code     INT,
    error           TEXT,
    cert_days_left  INT,
    checked_at      TIMESTAMPTZ NOT NULL,
    failing_since   TIMESTAMPTZ,                    -- set on the first failure, cleared on success
    PRIMARY KEY (tenant_id, agent_id, name)
);

CREATE TABLE IF NOT EXISTS endpoint_check_results (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL,
    name        TEXT NOT NULL,
    ok          BOOLEAN NOT NULL,
    latency_ms  INT,
    checked_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_check_results_tenant ON endpoint_check_results (tenant_id, name, checked_at DESC);

-- What agents of a tenant should monitor beyond the built-ins: custom log files, extra Windows
-- event channels / journald units, endpoint checks. Pushed to connected agents by the gateway.
CREATE TABLE IF NOT EXISTS agent_profiles (
    tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    profile     JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_events_source ON agent_events (tenant_id, source, occurred_at DESC);

INSERT INTO retention_config (key, days, description) VALUES
  ('endpoint_check_results', 14, 'Endpoint check history')
ON CONFLICT (key) DO NOTHING;

-- Default rules: the five from 011 plus host health, security posture and network. Each is only
-- added when the tenant has no rule with that name, so re-running never duplicates or overwrites.
CREATE OR REPLACE FUNCTION create_default_alert_rules(t UUID) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO alert_rules (tenant_id, name, description, severity, source, condition, threshold_value, window_minutes, cooldown_minutes)
  SELECT t, r.name, r.description, r.severity::alert_severity, r.source::alert_source, r.condition::jsonb, r.threshold, r.win, r.cooldown
  FROM (VALUES
    ('High-risk users present',      'Entra ID Identity Protection reports users at high risk.',          'high',     'entra_id', '{"metric":"risky_users_high","operator":"gt"}',                 0,  60,  240),
    ('Risky sign-in spike',          'More risky sign-ins than usual within the window.',                 'high',     'entra_id', '{"metric":"risky_signins","operator":"gt"}',                    5,  60,  120),
    ('Non-compliant devices',        'Intune reports devices that are not compliant.',                     'medium',   'intune',   '{"metric":"non_compliant_devices","operator":"gt"}',            0,  60, 1440),
    ('Secure Score below 50%',       'Microsoft Secure Score dropped under half of the maximum.',          'medium',   'defender', '{"metric":"secure_score","operator":"lt"}',                    50,  60, 1440),
    ('Agent offline',                'An endpoint agent has stopped reporting for more than 5 minutes.',   'medium',   'agent',    '{"metric":"agents_offline","operator":"gt"}',                   0,   5,   60),
    ('Disk almost full',             'A host has a disk more than 90% full.',                              'high',     'agent',    '{"metric":"hosts_disk_above","operator":"gt","param":90}',      0,  15,  240),
    ('Sustained high CPU',           'A host reports CPU above 95%.',                                      'medium',   'agent',    '{"metric":"hosts_cpu_above","operator":"gt","param":95}',       0,  15,  120),
    ('Brute-force login attempts',   'Failed logins against Windows, SSH or SQL Server in the window.',    'high',     'agent',    '{"metric":"failed_logins","operator":"gt"}',                   20,  15,   60),
    ('Security audit log cleared',   'Someone cleared the Windows Security log.',                          'critical', 'agent',    '{"metric":"audit_log_cleared","operator":"gt"}',                0,  60,   60),
    ('Host firewall off',            'A host has its firewall disabled.',                                  'high',     'agent',    '{"metric":"hosts_firewall_off","operator":"gt"}',               0,  60, 1440),
    ('Antivirus protection off',     'Microsoft Defender real-time protection is off on a host.',          'high',     'agent',    '{"metric":"hosts_antivirus_off","operator":"gt"}',              0,  60, 1440),
    ('Endpoint check failing',       'A monitored service, website or port is not responding.',           'high',     'agent',    '{"metric":"endpoint_checks_down","operator":"gt"}',             0,   5,   30),
    ('SQL Server service stopped',   'A discovered SQL Server instance is not running.',                   'critical', 'agent',    '{"metric":"sql_services_down","operator":"gt"}',                0,   5,   60),
    ('Certificates expiring soon',   'A host has a certificate expiring within 30 days.',                  'medium',   'agent',    '{"metric":"certificates_expiring","operator":"gt","param":30}', 0,  60, 1440),
    ('Admins without MFA',           'Privileged users have no MFA method registered.',                    'high',     'entra_id', '{"metric":"admins_without_mfa","operator":"gt"}',               0,  60, 1440)
  ) AS r(name, description, severity, source, condition, threshold, win, cooldown)
  WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE tenant_id = t AND name = r.name);
$$;

SELECT create_default_alert_rules(id) FROM tenants;
