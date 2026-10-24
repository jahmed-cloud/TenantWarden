# Architecture — TenantWarden

## ADR-001: PostgreSQL + ClickHouse dual database strategy

**Status:** Accepted

**Context:** Security monitoring requires both transactional consistency (for entities like tenants, users, alerts) and high-throughput time-series analytics (for metrics, sign-ins, agent telemetry). No single database excels at both.

**Decision:** Use PostgreSQL for all relational entity data and ClickHouse for all time-series and analytics data. The API service writes to both, and the analytics engine queries ClickHouse exclusively.

**Consequences:** Operational complexity of two database systems; significant query performance improvement for analytics (10-100x vs PostgreSQL for time-series aggregations).

---

## ADR-002: Go agent for cross-platform deployment

**Status:** Accepted

**Context:** Agents need to run on Windows, Linux (amd64 + arm64), and macOS as single static binaries with no runtime dependencies.

**Decision:** Implement the agent in Go. CGO disabled everywhere for fully static binaries. Cross-compile all targets from a single `make all` command.

**Consequences:** Excellent deployment simplicity; single binary per platform; no installer required.

---

## ADR-003: Redis pub/sub for inter-service communication

**Status:** Accepted

**Context:** Services need to communicate (alert engine → notification service, analytics → API) without tight coupling.

**Decision:** Use Redis pub/sub channels for real-time inter-service events. Kafka is optional and recommended only for deployments exceeding 1,000 tenants or requiring message replay/persistence.

**Consequences:** Simple for small/medium deployments; Kafka migration path available for enterprise scale.

---

## ADR-004: SignalR for live dashboard updates

**Status:** Accepted

**Context:** The React dashboard needs real-time updates (new alerts, agent heartbeats, live metrics) without polling.

**Decision:** Use ASP.NET Core SignalR over WebSockets with tenant-scoped groups. Clients join `tenant:{id}` groups on connect; the API publishes to these groups when state changes.

**Consequences:** Excellent browser compatibility; automatic fallback to long-polling; tight integration with ASP.NET Core auth pipeline.
