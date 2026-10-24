-- TenantWarden — PostgreSQL schema
-- Applied automatically on first startup via docker-entrypoint-initdb.d

BEGIN;

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for full-text search on text fields

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE tenant_status    AS ENUM ('active', 'paused', 'error', 'provisioning');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE alert_severity   AS ENUM ('critical', 'high', 'medium', 'low', 'info');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE alert_status     AS ENUM ('active', 'acknowledged', 'investigating', 'resolved', 'suppressed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE alert_source     AS ENUM ('entra_id', 'defender', 'intune', 'purview', 'exchange', 'sharepoint', 'teams', 'agent', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE agent_status     AS ENUM ('online', 'offline', 'degraded', 'provisioning');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE agent_platform   AS ENUM ('windows', 'linux', 'macos', 'docker', 'kubernetes');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE user_role        AS ENUM ('super_admin', 'org_admin', 'security_admin', 'global_reader', 'soc_analyst', 'helpdesk', 'auditor', 'viewer', 'api_user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE user_risk_level  AS ENUM ('none', 'low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tenants ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_name            TEXT NOT NULL,
    azure_tenant_id         TEXT NOT NULL UNIQUE,
    domain                  TEXT NOT NULL,
    status                  tenant_status NOT NULL DEFAULT 'provisioning',
    description             TEXT,
    logo_url                TEXT,
    client_id               TEXT NOT NULL,
    encrypted_client_secret TEXT NOT NULL,
    last_sync_at            TIMESTAMPTZ,
    last_sync_error         TEXT,
    user_count              INT NOT NULL DEFAULT 0,
    device_count            INT NOT NULL DEFAULT 0,
    enabled_modules         TEXT[] NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_azure_id ON tenants (azure_tenant_id);

-- ─── Platform users ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_users (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email            TEXT NOT NULL UNIQUE,
    display_name     TEXT NOT NULL,
    role             user_role NOT NULL DEFAULT 'viewer',
    tenant_id        UUID REFERENCES tenants(id) ON DELETE SET NULL,
    azure_object_id  TEXT,
    password_hash    TEXT,                                        -- BCrypt, for local login
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    totp_secret      TEXT,                                        -- encrypted
    api_key_hash     TEXT,
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON platform_users (email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON platform_users (tenant_id);

-- ─── Alerts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    severity            alert_severity NOT NULL,
    status              alert_status NOT NULL DEFAULT 'active',
    source              alert_source NOT NULL,
    category            TEXT NOT NULL,
    affected_users      TEXT[] NOT NULL DEFAULT '{}',
    affected_devices    TEXT[] NOT NULL DEFAULT '{}',
    affected_ip         INET,
    affected_country    CHAR(2),
    recommended_action  TEXT,
    ai_insight          TEXT,
    risk_score          NUMERIC(5,2),
    external_id         TEXT,
    assigned_to         TEXT,
    acknowledged_at     TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    resolution          TEXT,
    metadata            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id  ON alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity   ON alerts (severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status     ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_source     ON alerts (source);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_gin        ON alerts USING GIN (title gin_trgm_ops);

-- ─── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hostname          TEXT NOT NULL,
    agent_id          UUID NOT NULL UNIQUE,
    platform          agent_platform NOT NULL,
    version           TEXT NOT NULL,
    status            agent_status NOT NULL DEFAULT 'provisioning',
    os_name           TEXT,
    os_version        TEXT,
    architecture      TEXT,
    ip_address        INET,
    mac_address       MACADDR,
    domain_name       TEXT,
    jwt_public_key    TEXT NOT NULL,
    fingerprint       TEXT NOT NULL,
    last_seen_at      TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    cpu_percent       NUMERIC(5,2),
    memory_percent    NUMERIC(5,2),
    disk_percent      NUMERIC(5,2),
    tags              TEXT[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_status    ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_agent_id  ON agents (agent_id);

-- ─── Risky users (from Entra ID Identity Protection) ──────────────────────────
CREATE TABLE IF NOT EXISTS risky_users (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    azure_object_id      TEXT NOT NULL,
    user_principal_name  TEXT NOT NULL,
    display_name         TEXT NOT NULL,
    risk_level           user_risk_level NOT NULL DEFAULT 'none',
    risk_detail          TEXT,
    country_code         CHAR(2),
    ip_address           INET,
    is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
    is_processed         BOOLEAN NOT NULL DEFAULT FALSE,
    risk_last_updated_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, azure_object_id)
);

CREATE INDEX IF NOT EXISTS idx_risky_users_tenant    ON risky_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_risky_users_risk      ON risky_users (risk_level);
CREATE INDEX IF NOT EXISTS idx_risky_users_processed ON risky_users (is_processed);

-- ─── Alert rules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL,
    severity          alert_severity NOT NULL,
    source            alert_source NOT NULL,
    condition         JSONB NOT NULL,
    threshold_value   INT NOT NULL DEFAULT 1,
    window_minutes    INT NOT NULL DEFAULT 5,
    is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    cooldown_minutes  INT NOT NULL DEFAULT 60,
    last_triggered_at TIMESTAMPTZ,
    channel_ids       UUID[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Notification channels ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_channels (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    config       JSONB NOT NULL,              -- sensitive values encrypted
    is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    min_severity alert_severity NOT NULL DEFAULT 'medium',
    categories   TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id     TEXT NOT NULL,
    user_email  TEXT NOT NULL,
    action      TEXT NOT NULL,
    resource    TEXT NOT NULL,
    resource_id TEXT,
    ip_address  INET,
    user_agent  TEXT,
    old_value   JSONB,
    new_value   JSONB,
    success     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions — 2 years rolling; add future partitions as needed
CREATE TABLE IF NOT EXISTS audit_logs_2024 PARTITION OF audit_logs
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2025 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE INDEX IF NOT EXISTS idx_audit_tenant    ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_logs (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs (action, created_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenants','platform_users','alerts','agents',
                              'risky_users','alert_rules','notification_channels']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl, tbl);
  END LOOP;
END; $$;

COMMIT;
