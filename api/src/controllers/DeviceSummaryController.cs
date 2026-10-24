using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Aggregated device stats for the compliance donut + OS bar chart.</summary>
[ApiController]
[Route("api/v1/devices/summary")]
[Authorize]
public class DeviceSummaryController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public DeviceSummaryController(IDbConnectionFactory db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] Guid tenantId)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();

        var compliance = await conn.QueryFirstOrDefaultAsync(
            @"SELECT
                COUNT(*) FILTER (WHERE compliance_state = 'compliant')::int     AS compliant,
                COUNT(*) FILTER (WHERE compliance_state <> 'compliant')::int   AS ""nonCompliant""
              FROM managed_devices WHERE tenant_id = @tenantId", new { tenantId });

        var byOs = await conn.QueryAsync(
            @"SELECT COALESCE(NULLIF(operating_system,''),'Unknown') AS os, COUNT(*)::int AS count
              FROM managed_devices WHERE tenant_id = @tenantId
              GROUP BY os ORDER BY count DESC", new { tenantId });

        var encryption = await conn.QueryFirstOrDefaultAsync(
            @"SELECT
                COUNT(*) FILTER (WHERE encryption_state = 'encrypted')::int    AS encrypted,
                COUNT(*) FILTER (WHERE encryption_state = 'notEncrypted')::int AS ""notEncrypted""
              FROM managed_devices WHERE tenant_id = @tenantId", new { tenantId });

        return Ok(new { compliance, byOs, encryption });
    }
}
