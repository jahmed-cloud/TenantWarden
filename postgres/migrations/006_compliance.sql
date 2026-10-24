-- ══════════════════════════════════════════════════════════════════════════════
--  Compliance frameworks, controls, and computed assessments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_frameworks (
    id            TEXT PRIMARY KEY,             -- 'iso27001', 'nist_csf', 'soc2'
    name          TEXT NOT NULL,
    description   TEXT,
    display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance_controls (
    id            TEXT PRIMARY KEY,             -- e.g. 'iso27001-A.9.4.2'
    framework_id  TEXT NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
    ref           TEXT NOT NULL,                -- 'A.9.4.2'
    title         TEXT NOT NULL,
    category      TEXT,
    -- The automated check: which signal proves this control, and the threshold.
    -- check_type maps to logic in the compliance engine.
    check_type    TEXT NOT NULL,                -- 'mfa_enforced','risky_users_low','device_compliance', etc.
    check_target  NUMERIC,                      -- threshold (e.g. 95 for 95% compliant)
    weight        INT NOT NULL DEFAULT 1
);

-- Per-tenant computed result, refreshed by the compliance engine
CREATE TABLE IF NOT EXISTS compliance_assessments (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    control_id    TEXT NOT NULL REFERENCES compliance_controls(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,                -- 'pass','fail','partial','not_applicable'
    detail        TEXT,                         -- human-readable "why"
    measured_value NUMERIC,
    assessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, control_id)
);
CREATE INDEX IF NOT EXISTS idx_compliance_assess_tenant ON compliance_assessments (tenant_id);

-- ── Seed frameworks ───────────────────────────────────────────────────────────
INSERT INTO compliance_frameworks (id, name, description, display_order) VALUES
  ('iso27001', 'ISO 27001',     'Information security management (Annex A controls)', 1),
  ('nist_csf', 'NIST CSF',      'Cybersecurity Framework functions',                  2),
  ('soc2',     'SOC 2 Type II', 'Trust Services Criteria (Security)',                 3)
ON CONFLICT (id) DO NOTHING;

-- ── Seed controls with automated checks mapped to real collected signals ──────
-- check_type values are implemented in compliance-engine.
INSERT INTO compliance_controls (id, framework_id, ref, title, category, check_type, check_target, weight) VALUES
  -- ISO 27001 (Annex A)
  ('iso27001-A.9.4.2',  'iso27001', 'A.9.4.2', 'Secure log-on (MFA)',              'Access Control',   'mfa_enforced',      1,  3),
  ('iso27001-A.9.2.1',  'iso27001', 'A.9.2.1', 'User registration & de-registration','Access Control', 'conditional_access', 1,  2),
  ('iso27001-A.12.6.1', 'iso27001', 'A.12.6.1','Management of technical vulnerabilities','Operations', 'risky_users_low',   5,  3),
  ('iso27001-A.8.1.1',  'iso27001', 'A.8.1.1', 'Inventory of assets (devices)',    'Asset Mgmt',       'device_inventory',  1,  1),
  ('iso27001-A.10.1.1', 'iso27001', 'A.10.1.1','Cryptographic controls (encryption)','Cryptography',   'device_encryption', 90, 2),
  ('iso27001-A.18.2.3', 'iso27001', 'A.18.2.3','Technical compliance review (score)','Compliance',     'secure_score',      70, 2),

  -- NIST CSF
  ('nist_csf-PR.AC-1',  'nist_csf', 'PR.AC-1', 'Identities and credentials managed','Protect',         'mfa_enforced',      1,  3),
  ('nist_csf-PR.AC-4',  'nist_csf', 'PR.AC-4', 'Access permissions (least privilege)','Protect',       'conditional_access', 1,  2),
  ('nist_csf-DE.CM-7',  'nist_csf', 'DE.CM-7', 'Monitoring for unauthorized activity','Detect',        'risky_signins_monitored', 1, 2),
  ('nist_csf-ID.AM-1',  'nist_csf', 'ID.AM-1', 'Physical devices inventoried',     'Identify',         'device_inventory',  1,  1),
  ('nist_csf-PR.DS-1',  'nist_csf', 'PR.DS-1', 'Data-at-rest protected (encryption)','Protect',        'device_encryption', 90, 2),
  ('nist_csf-RS.MI-1',  'nist_csf', 'RS.MI-1', 'Incidents contained (risk remediation)','Respond',     'risky_users_low',   5,  2),

  -- SOC 2 (Trust Services — Security)
  ('soc2-CC6.1',        'soc2',     'CC6.1',   'Logical access — MFA',             'Access',           'mfa_enforced',      1,  3),
  ('soc2-CC6.2',        'soc2',     'CC6.2',   'Access provisioning (CA policies)','Access',           'conditional_access', 1,  2),
  ('soc2-CC6.6',        'soc2',     'CC6.6',   'Encryption of data',               'Access',           'device_encryption', 90, 2),
  ('soc2-CC7.2',        'soc2',     'CC7.2',   'Security monitoring',              'Operations',       'risky_signins_monitored', 1, 2),
  ('soc2-CC7.3',        'soc2',     'CC7.3',   'Security incident evaluation',     'Operations',       'risky_users_low',   5,  3)
ON CONFLICT (id) DO NOTHING;
