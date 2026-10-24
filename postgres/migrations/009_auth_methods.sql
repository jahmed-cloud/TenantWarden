-- Auth method registration snapshot (aggregated, one row per method-category per cycle)
CREATE TABLE IF NOT EXISTS auth_method_summary (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scope         TEXT NOT NULL,        -- 'all_users' or 'privileged_users'
    method        TEXT NOT NULL,        -- 'passkey','whfb','authenticator','phone','singleFactor'
    category      TEXT NOT NULL,        -- 'phish_resistant','phishable','single_factor'
    user_count    INT  NOT NULL DEFAULT 0,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_method_summary_tenant ON auth_method_summary (tenant_id, scope, captured_at DESC);

-- Device ownership (Graph: managedDevice.ownerType — 'company' | 'personal')
ALTER TABLE managed_devices ADD COLUMN IF NOT EXISTS owner_type TEXT;
