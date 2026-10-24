-- Force-change flag for first-login password rotation
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Default admin (password: TenantWarden!) — must change on first login.
-- BCrypt hash of 'TenantWarden!' (workfactor 10).
-- DO NOTHING on conflict: `make seed` re-runs this file and must never reset an
-- existing admin's password back to the public default.
INSERT INTO platform_users (email, display_name, role, is_active, password_hash, must_change_password)
VALUES ('admin@tenantwarden.local', 'Platform Admin', 'super_admin', TRUE,
        '$2a$10$1NoYdQa6uFCtwCYyZci4W.FuK3cISGKalPmFg0ZpgZW5L9.dwQuSm', TRUE)
ON CONFLICT (email) DO NOTHING;
