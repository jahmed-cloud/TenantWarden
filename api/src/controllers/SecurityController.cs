using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Microsoft Secure Score and Defender XDR incidents, as collected from Microsoft Graph.</summary>
[ApiController]
[Route("api/v1/security")]
[Authorize]
public class SecurityController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public SecurityController(IDbConnectionFactory db) => _db = db;

    /// <summary>Latest Secure Score with the change over the last 7 days, plus open-incident counts.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] Guid tenantId)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();

        var score = await conn.QueryFirstOrDefaultAsync(
            @"SELECT current_score AS ""currentScore"", max_score AS ""maxScore"", ROUND(percentage)::int AS percentage,
                     active_user_count AS ""activeUsers"", licensed_user_count AS ""licensedUsers"", recorded_at AS ""recordedAt"",
                     (SELECT ROUND(percentage)::int FROM secure_scores
                       WHERE tenant_id = @tenantId AND recorded_at <= NOW() - INTERVAL '7 days'
                       ORDER BY recorded_at DESC LIMIT 1) AS ""percentage7dAgo""
              FROM secure_scores WHERE tenant_id = @tenantId ORDER BY recorded_at DESC LIMIT 1",
            new { tenantId });

        var incidents = await conn.QueryFirstAsync(
            @"SELECT COUNT(*) FILTER (WHERE status <> 'resolved')::int                          AS open,
                     COUNT(*) FILTER (WHERE status <> 'resolved' AND severity = 'high')::int    AS high,
                     COUNT(*) FILTER (WHERE status <> 'resolved' AND severity = 'medium')::int  AS medium,
                     COUNT(*) FILTER (WHERE status <> 'resolved' AND severity IN ('low', 'informational'))::int AS low,
                     COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int       AS ""new7d"",
                     COUNT(*) FILTER (WHERE status = 'resolved' AND last_update_at >= NOW() - INTERVAL '7 days')::int AS ""resolved7d""
              FROM security_incidents WHERE tenant_id = @tenantId",
            new { tenantId });

        return Ok(new { secureScore = score, incidents });
    }

    /// <summary>Secure Score history for trend charts.</summary>
    [HttpGet("secure-score/history")]
    public async Task<IActionResult> SecureScoreHistory([FromQuery] Guid tenantId, [FromQuery] int days = 90)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT recorded_at AS ""recordedAt"", ROUND(percentage)::int AS percentage,
                     current_score AS ""currentScore"", max_score AS ""maxScore""
              FROM secure_scores
              WHERE tenant_id = @tenantId AND recorded_at >= NOW() - make_interval(days => @days)
              ORDER BY recorded_at",
            new { tenantId, days = Math.Clamp(days, 1, 730) });
        return Ok(rows);
    }

    /// <summary>Defender XDR incidents. status: open (default) | resolved | all.</summary>
    [HttpGet("incidents")]
    public async Task<IActionResult> Incidents([FromQuery] Guid tenantId, [FromQuery] string status = "open")
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT id, incident_id AS ""incidentId"", display_name AS ""displayName"", severity, status,
                     classification, determination, assigned_to AS ""assignedTo"", alert_count AS ""alertCount"",
                     incident_web_url AS ""webUrl"", created_at AS ""createdAt"", last_update_at AS ""lastUpdateAt""
              FROM security_incidents
              WHERE tenant_id = @tenantId
                AND (@status = 'all' OR (@status = 'open' AND status <> 'resolved') OR (@status = 'resolved' AND status = 'resolved'))
              ORDER BY created_at DESC LIMIT 200",
            new { tenantId, status });
        return Ok(rows);
    }
}
