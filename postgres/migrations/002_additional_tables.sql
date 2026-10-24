-- TenantWarden — Migration 002: additional tables

BEGIN;

-- ── Notification failure log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_failures (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id  UUID,
    alert_id    UUID,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Service health snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_health (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service     TEXT NOT NULL,
    status      TEXT NOT NULL,
    detail      TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_svc_health_tenant ON service_health (tenant_id, recorded_at DESC);

-- ── Risky sign-ins ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risky_signins (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    azure_signin_id     TEXT NOT NULL,
    user_principal_name TEXT NOT NULL,
    ip_address          INET,
    country_code        CHAR(2),
    city                TEXT,
    risk_level          user_risk_level NOT NULL DEFAULT 'none',
    risk_detail         TEXT,
    app_display_name    TEXT,
    device_id           TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, azure_signin_id)
);

CREATE INDEX IF NOT EXISTS idx_risky_signins_tenant ON risky_signins (tenant_id, occurred_at DESC);

-- ── CA Policies cache ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ca_policies (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    policy_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    state       TEXT NOT NULL,
    conditions  JSONB,
    controls    JSONB,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, policy_id)
);

-- ── Devices cache ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managed_devices (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    azure_device_id      TEXT NOT NULL,
    device_name          TEXT NOT NULL,
    operating_system     TEXT,
    os_version           TEXT,
    compliance_state     TEXT,
    user_principal_name  TEXT,
    encryption_state     TEXT,
    last_sync_datetime   TIMESTAMPTZ,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, azure_device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_tenant     ON managed_devices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_compliance ON managed_devices (tenant_id, compliance_state);

-- ── Hangfire schema (created by Hangfire itself, but needs the DB connection) ──
-- Hangfire will auto-create its own tables on first startup.

COMMIT;
