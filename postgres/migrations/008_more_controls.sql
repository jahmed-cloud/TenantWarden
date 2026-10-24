-- Expanded compliance control catalog — additional controls mapped to existing checks.
-- These reuse the 7 automated check_types already implemented in the scorer.

INSERT INTO compliance_controls (id, framework_id, ref, title, category, check_type, check_target, weight) VALUES
  -- ── ISO 27001 additional (Annex A) ──────────────────────────────────────────
  ('iso27001-A.9.1.2',  'iso27001', 'A.9.1.2',  'Access to networks and services',        'Access Control', 'conditional_access',      1,  2),
  ('iso27001-A.9.4.1',  'iso27001', 'A.9.4.1',  'Information access restriction',          'Access Control', 'conditional_access',      1,  2),
  ('iso27001-A.11.2.6', 'iso27001', 'A.11.2.6', 'Security of equipment off-premises',      'Physical',       'device_encryption',       90, 2),
  ('iso27001-A.12.2.1', 'iso27001', 'A.12.2.1', 'Controls against malware',                'Operations',     'device_inventory',        1,  2),
  ('iso27001-A.12.4.1', 'iso27001', 'A.12.4.1', 'Event logging',                           'Operations',     'risky_signins_monitored', 1,  2),
  ('iso27001-A.16.1.2', 'iso27001', 'A.16.1.2', 'Reporting information security events',   'Incident Mgmt',  'risky_signins_monitored', 1,  2),
  ('iso27001-A.16.1.4', 'iso27001', 'A.16.1.4', 'Assessment of security events',           'Incident Mgmt',  'risky_users_low',         5,  2),
  ('iso27001-A.6.2.1',  'iso27001', 'A.6.2.1',  'Mobile device policy',                    'Mobile',         'device_inventory',        1,  1),

  -- ── NIST CSF additional ─────────────────────────────────────────────────────
  ('nist_csf-PR.AC-3',  'nist_csf', 'PR.AC-3',  'Remote access managed',                   'Protect',        'conditional_access',      1,  2),
  ('nist_csf-PR.AC-7',  'nist_csf', 'PR.AC-7',  'Users/devices authenticated (MFA)',       'Protect',        'mfa_enforced',            1,  3),
  ('nist_csf-PR.DS-2',  'nist_csf', 'PR.DS-2',  'Data-in-transit protected',               'Protect',        'device_encryption',       90, 2),
  ('nist_csf-PR.PT-1',  'nist_csf', 'PR.PT-1',  'Audit/log records maintained',            'Protect',        'risky_signins_monitored', 1,  2),
  ('nist_csf-DE.CM-1',  'nist_csf', 'DE.CM-1',  'Network monitored for events',            'Detect',         'risky_signins_monitored', 1,  2),
  ('nist_csf-DE.CM-3',  'nist_csf', 'DE.CM-3',  'Personnel activity monitored',            'Detect',         'risky_users_low',         5,  2),
  ('nist_csf-ID.AM-2',  'nist_csf', 'ID.AM-2',  'Software platforms inventoried',          'Identify',       'device_inventory',        1,  1),
  ('nist_csf-PR.IP-1',  'nist_csf', 'PR.IP-1',  'Baseline configuration (Secure Score)',   'Protect',        'secure_score',            70, 2),

  -- ── SOC 2 additional (Trust Services Criteria) ──────────────────────────────
  ('soc2-CC6.3',        'soc2',     'CC6.3',    'Role-based access enforced',              'Access',         'conditional_access',      1,  2),
  ('soc2-CC6.7',        'soc2',     'CC6.7',    'Data transmission encrypted',             'Access',         'device_encryption',       90, 2),
  ('soc2-CC6.8',        'soc2',     'CC6.8',    'Malicious software prevented',            'Access',         'device_inventory',        1,  1),
  ('soc2-CC7.1',        'soc2',     'CC7.1',    'Vulnerabilities detected (Secure Score)', 'Operations',     'secure_score',            70, 2),
  ('soc2-CC7.4',        'soc2',     'CC7.4',    'Incident response executed',              'Operations',     'risky_users_low',         5,  2),
  ('soc2-CC8.1',        'soc2',     'CC8.1',    'Change management (CA policies)',         'Change',         'conditional_access',      1,  1),
  ('soc2-A1.2',         'soc2',     'A1.2',     'Availability monitoring',                 'Availability',   'risky_signins_monitored', 1,  1)
ON CONFLICT (id) DO NOTHING;
