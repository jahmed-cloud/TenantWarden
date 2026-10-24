-- ══════════════════════════════════════════════════════════════════════════════
--  Historical snapshots + retention configuration
-- ══════════════════════════════════════════════════════════════════════════════

-- Point-in-time posture snapshots (one row per tenant per collection), for trends
CREATE TABLE IF NOT EXISTS posture_history (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    risky_users_high    INT  NOT NULL DEFAULT 0,
    risky_users_medium  INT  NOT NULL DEFAULT 0,
    devices_total       INT  NOT NULL DEFAULT 0,
    devices_noncompliant INT NOT NULL DEFAULT 0,
    ca_policies_enabled INT  NOT NULL DEFAULT 0,
    secure_score        NUMERIC(5,2),
    risky_signins_24h   INT  NOT NULL DEFAULT 0,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posture_history_tenant ON posture_history (tenant_id, captured_at DESC);

-- Compliance score history (one row per framework per scoring run)
CREATE TABLE IF NOT EXISTS compliance_history (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    framework_id  TEXT NOT NULL,
    score         INT  NOT NULL,
    controls_passed INT NOT NULL,
    controls_total  INT NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_history_tenant ON compliance_history (tenant_id, framework_id, captured_at DESC);

-- Retention settings (days to keep each history type; 0 = keep forever)
CREATE TABLE IF NOT EXISTS retention_config (
    key           TEXT PRIMARY KEY,
    days          INT NOT NULL,
    description   TEXT
);
INSERT INTO retention_config (key, days, description) VALUES
  ('posture_history',    90,  'Security posture snapshots'),
  ('compliance_history', 365, 'Compliance score history'),
  ('secure_scores',      365, 'Secure Score history'),
  ('risky_signins',      90,  'Risky sign-in records'),
  ('audit_logs',         365, 'Audit log entries')
ON CONFLICT (key) DO NOTHING;
