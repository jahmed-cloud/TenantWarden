using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Historical trends + retention config.</summary>
[ApiController]
[Route("api/v1/history")]
[Authorize]
public class HistoryController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public HistoryController(IDbConnectionFactory db) => _db = db;

    /// <summary>Posture trend (risky users, devices, secure score over time).</summary>
    [HttpGet("posture")]
    public async Task<IActionResult> Posture([FromQuery] Guid tenantId, [FromQuery] int days = 30)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT risky_users_high AS ""riskyHigh"", risky_users_medium AS ""riskyMedium"",
                     devices_total AS ""devicesTotal"", devices_noncompliant AS ""devicesNonCompliant"",
                     ca_policies_enabled AS ""caPolicies"", secure_score AS ""secureScore"",
                     risky_signins_24h AS ""riskySignins"", captured_at AS ""capturedAt""
              FROM posture_history
              WHERE tenant_id = @tenantId AND captured_at >= NOW() - (@days || ' days')::interval
              ORDER BY captured_at",
            new { tenantId, days });
        return Ok(rows);
    }

    /// <summary>Compliance score trend per framework.</summary>
    [HttpGet("compliance")]
    public async Task<IActionResult> Compliance([FromQuery] Guid tenantId, [FromQuery] int days = 90)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT framework_id AS ""frameworkId"", score,
                     controls_passed AS ""controlsPassed"", controls_total AS ""controlsTotal"",
                     captured_at AS ""capturedAt""
              FROM compliance_history
              WHERE tenant_id = @tenantId AND captured_at >= NOW() - (@days || ' days')::interval
              ORDER BY captured_at",
            new { tenantId, days });
        return Ok(rows);
    }

    /// <summary>Read retention settings (the "expand it" options).</summary>
    [HttpGet("retention")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetRetention()
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT key, days, description FROM retention_config ORDER BY key");
        return Ok(rows);
    }

    public record RetentionUpdate(string Key, int Days);

    /// <summary>Update a retention window (0 = keep forever). Platform-wide, so super_admin only.</summary>
    [HttpPut("retention")]
    [Authorize(Roles = "super_admin")]
    public async Task<IActionResult> SetRetention([FromBody] RetentionUpdate req)
    {
        await using var conn = _db.CreateConnection();
        var n = await conn.ExecuteAsync(
            "UPDATE retention_config SET days = @Days WHERE key = @Key",
            new { req.Key, Days = Math.Max(0, req.Days) });
        return n > 0 ? Ok(new { updated = true }) : NotFound();
    }
}
