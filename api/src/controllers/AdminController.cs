using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>Platform users (RBAC tab) — real data from platform_users.</summary>
[ApiController]
[Route("api/v1/users")]
[Authorize(Policy = "AdminOnly")]
public class UsersController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public UsersController(IDbConnectionFactory db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> List()
    {
        if (!User.TryScopeTenant(null, out var scoped)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT id, email, display_name AS ""displayName"", role,
                     tenant_id AS ""tenantId"", is_active AS ""isActive"",
                     mfa_enabled AS ""mfaEnabled"", last_login_at AS ""lastLoginAt"",
                     created_at AS ""createdAt""
              FROM platform_users
              WHERE (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              ORDER BY created_at DESC",
            new { TenantId = scoped });
        return Ok(rows);
    }

    /// <summary>Counts per role — drives the RBAC tab.</summary>
    [HttpGet("role-summary")]
    public async Task<IActionResult> RoleSummary()
    {
        if (!User.TryScopeTenant(null, out var scoped)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT role, COUNT(*)::int AS users
              FROM platform_users
              WHERE is_active = TRUE AND (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              GROUP BY role ORDER BY role",
            new { TenantId = scoped });
        return Ok(rows);
    }
}

/// <summary>Audit log (Admin → Audit tab) — real data from audit_logs.</summary>
[ApiController]
[Route("api/v1/audit")]
[Authorize(Roles = "super_admin,org_admin,auditor")]
public class AuditController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public AuditController(IDbConnectionFactory db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? tenantId, [FromQuery] int limit = 50)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT id, tenant_id AS ""tenantId"", user_email AS ""userEmail"",
                     action, resource AS ""resource"", resource_id AS ""resourceId"",
                     ip_address AS ""ipAddress"", success, created_at AS ""createdAt""
              FROM audit_logs
              WHERE (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              ORDER BY created_at DESC
              LIMIT @Limit",
            new { TenantId = scoped, Limit = Math.Clamp(limit, 1, 500) });
        return Ok(rows);
    }
}

/// <summary>M365 service health — real data from service_health.</summary>
[ApiController]
[Route("api/v1/service-health")]
[Authorize]
public class ServiceHealthController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    public ServiceHealthController(IDbConnectionFactory db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? tenantId)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT DISTINCT ON (service)
                     service, status, detail, recorded_at AS ""recordedAt""
              FROM service_health
              WHERE (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              ORDER BY service, recorded_at DESC",
            new { TenantId = scoped });
        return Ok(rows);
    }
}
