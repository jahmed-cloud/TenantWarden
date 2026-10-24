using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Latest auth-method registration snapshot — feeds the Sankey chart.</summary>
[ApiController]
[Route("api/v1/identity/auth-methods")]
[Authorize]
public class AuthMethodsController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public AuthMethodsController(IDbConnectionFactory db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] Guid tenantId, [FromQuery] string scope = "all_users")
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        await using var conn = _db.CreateConnection();
        // Only the most recent snapshot per method (captured_at may have several rows over time)
        var rows = await conn.QueryAsync(
            @"SELECT DISTINCT ON (method) method, category, user_count AS ""userCount"", captured_at AS ""capturedAt""
              FROM auth_method_summary
              WHERE tenant_id = @tenantId AND scope = @scope
              ORDER BY method, captured_at DESC",
            new { tenantId, scope });
        return Ok(rows);
    }
}
