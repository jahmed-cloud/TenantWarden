-- TenantWarden — ClickHouse analytics schema
-- Optimized for high-throughput time-series writes and fast aggregation queries.

-- ─── Agent metrics (MergeTree — 1 year retention) ────────────────────────────
CREATE TABLE IF NOT EXISTS agent_metrics
(
    tenant_id     UUID,
    agent_id      UUID,
    hostname      String,
    platform      LowCardinality(String),
    collected_at  DateTime64(3, 'UTC'),
    cpu_percent   Float32,
    mem_percent   Float32,
    disk_percent  Float32,
    bytes_sent    UInt64,
    bytes_recv    UInt64,
    extra         String DEFAULT ''         -- JSON blob for platform-specific extras
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(collected_at)
ORDER BY (tenant_id, agent_id, collected_at)
TTL collected_at + INTERVAL 1 YEAR
SETTINGS index_granularity = 8192;

-- Materialized view: per-tenant hourly CPU average
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_metrics_hourly
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, agent_id, hour)
AS SELECT
    tenant_id,
    agent_id,
    toStartOfHour(collected_at) AS hour,
    avgState(cpu_percent)       AS avg_cpu,
    avgState(mem_percent)       AS avg_mem,
    maxState(cpu_percent)       AS max_cpu,
    maxState(mem_percent)       AS max_mem
FROM agent_metrics
GROUP BY tenant_id, agent_id, hour;

-- ─── Sign-in events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signin_events
(
    tenant_id           UUID,
    event_id            String,
    occurred_at         DateTime64(3, 'UTC'),
    user_id             String,
    user_principal_name LowCardinality(String),
    app_display_name    LowCardinality(String),
    ip_address          IPv6,
    country_code        FixedString(2),
    city                String,
    is_risky            UInt8,
    risk_level          LowCardinality(String),
    risk_detail         String,
    status_code         UInt32,
    failure_reason      String,
    device_id           String,
    device_os           LowCardinality(String),
    client_app          LowCardinality(String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, occurred_at, user_id)
TTL occurred_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- ─── Alert history ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_history
(
    tenant_id    UUID,
    alert_id     UUID,
    occurred_at  DateTime64(3, 'UTC'),
    severity     LowCardinality(String),
    source       LowCardinality(String),
    category     LowCardinality(String),
    country_code FixedString(2),
    risk_score   Float32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, occurred_at, severity)
TTL occurred_at + INTERVAL 1 YEAR;

-- ─── Secure score history ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS secure_score_history
(
    tenant_id        UUID,
    recorded_at      DateTime64(3, 'UTC'),
    current_score    Float32,
    max_score        Float32,
    identity_score   Float32,
    device_score     Float32,
    app_score        Float32,
    data_score       Float32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(recorded_at)
ORDER BY (tenant_id, recorded_at)
TTL recorded_at + INTERVAL 2 YEAR;

-- ─── Custom event ingestion table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_events
(
    tenant_id    UUID,
    source       LowCardinality(String),
    event_type   LowCardinality(String),
    occurred_at  DateTime64(3, 'UTC'),
    severity     LowCardinality(String) DEFAULT 'info',
    message      String,
    data         String DEFAULT ''   -- raw JSON payload
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, source, occurred_at)
TTL occurred_at + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
