-- TenantWarden — Development seed data
-- Run: docker exec -i tenantwarden-postgres psql -U tenantwarden -d tenantwarden < scripts/seed-db.sql

BEGIN;

-- ── Sample tenant ──────────────────────────────────────────────────────────────
INSERT INTO tenants (
  id, display_name, azure_tenant_id, domain, status,
  client_id, encrypted_client_secret,
  user_count, device_count, enabled_modules
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Contoso Ltd.',
  'contoso-tenant-id-placeholder',
  'contoso.com',
  'active',
  'app-client-id-placeholder',
  'encrypted-placeholder',
  1847,
  2341,
  ARRAY['identity','defender','intune','exchange','purview','teams']
) ON CONFLICT (azure_tenant_id) DO NOTHING;

-- ── Sample platform admin user ─────────────────────────────────────────────────
INSERT INTO platform_users (
  id, email, display_name, role, tenant_id, is_active, mfa_enabled
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  'admin@tenantwarden.local',
  'Platform Admin',
  'super_admin',
  '11111111-1111-1111-1111-111111111111',
  TRUE, FALSE
) ON CONFLICT (email) DO NOTHING;

-- ── Sample alerts ──────────────────────────────────────────────────────────────
INSERT INTO alerts (tenant_id, title, description, severity, status, source, category, affected_users, recommended_action) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'Credential stuffing attack detected',
  '12 accounts targeted from Brazil, Russia, and Vietnam. Pattern consistent with automated credential stuffing.',
  'critical', 'active', 'entra_id', 'identity',
  ARRAY['jdoe@contoso.com','asmith@contoso.com','mlee@contoso.com'],
  'Enable Conditional Access policy for suspicious countries. Force MFA re-registration for affected accounts.'
),
(
  '11111111-1111-1111-1111-111111111111',
  'Admin account MFA disabled',
  'MFA was disabled for adm_jsmith@contoso.com by adm_jones@contoso.com.',
  'high', 'active', 'entra_id', 'identity',
  ARRAY['adm_jsmith@contoso.com'],
  'Re-enable MFA immediately. Review audit log for reason. Verify no unauthorized changes.'
),
(
  '11111111-1111-1111-1111-111111111111',
  'Impossible travel detected',
  'asmith@contoso.com signed in from Moscow and New York within 1 hour 48 minutes.',
  'high', 'active', 'entra_id', 'identity',
  ARRAY['asmith@contoso.com'],
  'Revoke all sessions for this user. Require fresh MFA. Investigate both sign-in events.'
),
(
  '11111111-1111-1111-1111-111111111111',
  'Devices out of compliance — OS update overdue',
  '2 devices have not installed OS updates in over 14 days.',
  'medium', 'active', 'intune', 'devices',
  ARRAY[]::TEXT[],
  'Push OS update policy. Contact device owners. Set deadline for compliance.'
),
(
  '11111111-1111-1111-1111-111111111111',
  'DLP policy match — Finance team',
  'A user in the Finance team sent an outbound email containing PII data.',
  'low', 'acknowledged', 'purview', 'compliance',
  ARRAY['finance.user@contoso.com'],
  'Review the email content. Educate the user on data handling policies. Update DLP rules if needed.'
);

-- ── Sample risky users ────────────────────────────────────────────────────────
INSERT INTO risky_users (
  tenant_id, azure_object_id, user_principal_name, display_name, risk_level,
  risk_detail, country_code, ip_address
) VALUES
('11111111-1111-1111-1111-111111111111', 'oid-jdoe',   'jdoe@contoso.com',   'John Doe',   'high',   'unfamiliarFeatures',    'BR', '189.47.100.1'),
('11111111-1111-1111-1111-111111111111', 'oid-asmith', 'asmith@contoso.com', 'Alice Smith','high',   'impossibleTravel',       'RU', '185.220.100.1'),
('11111111-1111-1111-1111-111111111111', 'oid-mlee',   'mlee@contoso.com',   'Mike Lee',   'medium', 'atypicalTravelBasedOnFrequentlyUsedLocations', 'VN', '116.103.100.1'),
('11111111-1111-1111-1111-111111111111', 'oid-rjones', 'rjones@contoso.com', 'Rob Jones',  'medium', 'leakedCredentials',      'US', '10.0.1.100')
ON CONFLICT (tenant_id, azure_object_id) DO NOTHING;

-- ── Sample CA policies ────────────────────────────────────────────────────────
INSERT INTO ca_policies (tenant_id, policy_id, name, state) VALUES
('11111111-1111-1111-1111-111111111111', 'ca-001', 'Require MFA for all users',           'enabled'),
('11111111-1111-1111-1111-111111111111', 'ca-002', 'Block legacy authentication',          'enabled'),
('11111111-1111-1111-1111-111111111111', 'ca-003', 'Require compliant device',             'enabled'),
('11111111-1111-1111-1111-111111111111', 'ca-004', 'High risk sign-in — require MFA step', 'enabled'),
('11111111-1111-1111-1111-111111111111', 'ca-005', 'Block high-risk users',                'reportOnly'),
('11111111-1111-1111-1111-111111111111', 'ca-006', 'Restrict risky countries',             'disabled')
ON CONFLICT (tenant_id, policy_id) DO NOTHING;

-- ── Sample managed devices ────────────────────────────────────────────────────
INSERT INTO managed_devices (
  tenant_id, azure_device_id, device_name, operating_system, os_version,
  compliance_state, user_principal_name, encryption_state
) VALUES
('11111111-1111-1111-1111-111111111111', 'dev-001', 'DESKTOP-A4KX2', 'Windows', '11.0.22621', 'noncompliant', 'jdoe@contoso.com',   'notEncrypted'),
('11111111-1111-1111-1111-111111111111', 'dev-002', 'LAPTOP-BZ991',  'Windows', '10.0.19041', 'noncompliant', 'mlee@contoso.com',   'notEncrypted'),
('11111111-1111-1111-1111-111111111111', 'dev-003', 'MAC-PRO-K11',   'macOS',   '13.6',       'compliant',    'tchen@contoso.com',  'encrypted'),
('11111111-1111-1111-1111-111111111111', 'dev-004', 'WORKSTATION-01','Windows', '11.0.22621', 'compliant',    'akim@contoso.com',   'encrypted'),
('11111111-1111-1111-1111-111111111111', 'dev-005', 'LAPTOP-HR-02',  'Windows', '11.0.22621', 'compliant',    'hruser@contoso.com', 'encrypted')
ON CONFLICT (tenant_id, azure_device_id) DO NOTHING;

-- ── Sample notification channels ─────────────────────────────────────────────
INSERT INTO notification_channels (
  tenant_id, name, type, config, is_enabled, min_severity
) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'Microsoft Teams — Security',
  'teams',
  '{"webhookUrl":"https://your-org.webhook.office.com/webhookb2/placeholder"}'::jsonb,
  TRUE, 'high'
),
(
  '11111111-1111-1111-1111-111111111111',
  'Slack — SOC alerts',
  'slack',
  '{"botToken":"xoxb-placeholder","channelId":"C00000000"}'::jsonb,
  TRUE, 'medium'
);

-- ── Sample alert rule ─────────────────────────────────────────────────────────
INSERT INTO alert_rules (
  tenant_id, name, description, severity, source,
  condition, threshold_value, window_minutes, is_enabled, cooldown_minutes
) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'Risky user spike',
  'Fire when risky user count exceeds threshold within the evaluation window',
  'high', 'entra_id',
  '{"metric":"risky_users","operator":"gt"}'::jsonb,
  10, 15, TRUE, 60
),
(
  '11111111-1111-1111-1111-111111111111',
  'Non-compliant device spike',
  'Fire when non-compliant device count exceeds threshold',
  'medium', 'intune',
  '{"metric":"non_compliant_devices","operator":"gt"}'::jsonb,
  5, 60, TRUE, 120
);

COMMIT;

-- Summary
SELECT
  (SELECT COUNT(*) FROM tenants)               AS tenants,
  (SELECT COUNT(*) FROM platform_users)        AS users,
  (SELECT COUNT(*) FROM alerts)                AS alerts,
  (SELECT COUNT(*) FROM risky_users)           AS risky_users,
  (SELECT COUNT(*) FROM managed_devices)       AS devices,
  (SELECT COUNT(*) FROM ca_policies)           AS ca_policies,
  (SELECT COUNT(*) FROM notification_channels) AS channels,
  (SELECT COUNT(*) FROM alert_rules)           AS rules;
