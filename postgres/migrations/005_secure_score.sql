-- Secure Score history (Graph /security/secureScores)
CREATE TABLE IF NOT EXISTS secure_scores (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    current_score       NUMERIC(6,2) NOT NULL,
    max_score           NUMERIC(6,2) NOT NULL,
    percentage          NUMERIC(5,2),
    active_user_count   INT,
    licensed_user_count INT,
    recorded_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_secure_scores_tenant ON secure_scores (tenant_id, recorded_at DESC);
