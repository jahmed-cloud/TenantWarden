using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Compliance framework scores computed from real security signals.</summary>
[ApiController]
[Route("api/v1/compliance")]
[Authorize]
public class ComplianceController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public ComplianceController(IDbConnectionFactory db) => _db = db;

    /// <summary>Per-framework rollup: score %, controls passing, status.</summary>
    [HttpGet("frameworks")]
    public async Task<IActionResult> Frameworks([FromQuery] Guid tenantId)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT
                f.id,
                f.name,
                COUNT(a.control_id)                                   AS total,
                COUNT(*) FILTER (WHERE a.status = 'pass')            AS passed,
                COUNT(*) FILTER (WHERE a.status = 'partial')         AS partial,
                COUNT(*) FILTER (WHERE a.status = 'not_applicable')  AS na
              FROM compliance_frameworks f
              JOIN compliance_controls   c ON c.framework_id = f.id
              LEFT JOIN compliance_assessments a
                     ON a.control_id = c.id AND a.tenant_id = @tenantId
              GROUP BY f.id, f.name, f.display_order
              ORDER BY f.display_order",
            new { tenantId });

        var result = rows.Select(r =>
        {
            int total   = (int)r.total;
            int passed  = (int)r.passed;
            int partial = (int)r.partial;
            int na      = (int)r.na;
            int scorable = total - na;
            // partial counts as half credit
            double score = scorable == 0 ? 0 : Math.Round(((passed + partial * 0.5) / scorable) * 100);
            string status = score >= 80 ? "compliant" : score >= 60 ? "partial" : "at_risk";
            return new
            {
                id = (string)r.id,
                name = (string)r.name,
                score = (int)score,
                controlsPassing = $"{passed}/{scorable}",
                status,
            };
        });
        return Ok(result);
    }

    /// <summary>Individual control results for one framework (drill-down).</summary>
    [HttpGet("controls")]
    public async Task<IActionResult> Controls([FromQuery] Guid tenantId, [FromQuery] string frameworkId)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT c.ref, c.title, c.category,
                     COALESCE(a.status, 'not_assessed') AS status,
                     a.detail, a.assessed_at AS ""assessedAt""
              FROM compliance_controls c
              LEFT JOIN compliance_assessments a
                     ON a.control_id = c.id AND a.tenant_id = @tenantId
              WHERE c.framework_id = @frameworkId
              ORDER BY c.ref",
            new { tenantId, frameworkId });
        return Ok(rows);
    }
}
