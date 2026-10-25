using System.Text.Json;
using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StackExchange.Redis;

namespace TenantWarden.Api.Controllers;

/// <summary>Period KPIs (with the previous period for comparison) and the analytics engine's anomaly result.</summary>
[ApiController]
[Route("api/v1/analytics")]
[Authorize]
public class AnalyticsController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    private readonly IConnectionMultiplexer _redis;

    public AnalyticsController(IDbConnectionFactory db, IConnectionMultiplexer redis)
    {
        _db    = db;
        _redis = redis;
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] Guid tenantId, [FromQuery] int days = 30)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        days = Math.Clamp(days, 1, 180);
        await using var conn = _db.CreateConnection();

        var kpis = await conn.QueryFirstAsync(
            @"WITH p AS (SELECT NOW() - make_interval(days => @days) AS since, NOW() - make_interval(days => @days * 2) AS prev)
              SELECT
                (SELECT COUNT(*) FROM risky_signins, p WHERE tenant_id = @tenantId AND occurred_at >= p.since)::int                              AS ""riskySignIns"",
                (SELECT COUNT(*) FROM risky_signins, p WHERE tenant_id = @tenantId AND occurred_at >= p.prev AND occurred_at < p.since)::int     AS ""riskySignInsPrev"",
                (SELECT COUNT(*) FROM alerts, p WHERE tenant_id = @tenantId AND created_at >= p.since)::int                                      AS alerts,
                (SELECT COUNT(*) FROM alerts, p WHERE tenant_id = @tenantId AND created_at >= p.prev AND created_at < p.since)::int             AS ""alertsPrev"",
                (SELECT COUNT(*) FROM alerts, p WHERE tenant_id = @tenantId AND resolved_at >= p.since)::int                                     AS resolved,
                (SELECT COUNT(*) FROM alerts WHERE tenant_id = @tenantId AND status IN ('active', 'acknowledged', 'investigating'))::int          AS ""openAlerts"",
                (SELECT ROUND((AVG(EXTRACT(EPOCH FROM resolved_at - created_at)) / 3600)::numeric, 1)
                   FROM alerts, p WHERE tenant_id = @tenantId AND resolved_at >= p.since)                                                       AS ""mttrHours"",
                (SELECT ROUND((AVG(EXTRACT(EPOCH FROM acknowledged_at - created_at)) / 60)::numeric, 0)
                   FROM alerts, p WHERE tenant_id = @tenantId AND acknowledged_at >= p.since)                                                   AS ""mttaMinutes""",
            new { tenantId, days });

        var bySource = await conn.QueryAsync(
            @"SELECT source::text AS source, COUNT(*)::int AS count
              FROM alerts WHERE tenant_id = @tenantId AND created_at >= NOW() - make_interval(days => @days)
              GROUP BY 1 ORDER BY 2 DESC",
            new { tenantId, days });

        var topUsers = await conn.QueryAsync(
            @"SELECT user_principal_name AS ""user"", COUNT(*)::int AS ""signIns"",
                     COUNT(*) FILTER (WHERE risk_level = 'high')::int AS high,
                     COUNT(DISTINCT country_code)::int AS countries, MAX(occurred_at) AS ""lastSeen""
              FROM risky_signins WHERE tenant_id = @tenantId AND occurred_at >= NOW() - make_interval(days => @days)
              GROUP BY 1 ORDER BY 2 DESC LIMIT 8",
            new { tenantId, days });

        // Written by analytics-engine every cycle (z-score of daily risky-user counts)
        JsonElement? anomaly = null;
        var cached = await _redis.GetDatabase().StringGetAsync($"analytics:{tenantId}:risky_users");
        if (cached.HasValue)
        {
            try { anomaly = JsonDocument.Parse(cached.ToString()).RootElement.Clone(); }
            catch (JsonException) { /* ignore a malformed cache entry */ }
        }

        return Ok(new { days, kpis, bySource, topUsers, anomaly });
    }
}
