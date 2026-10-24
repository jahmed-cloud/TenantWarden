using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class IdentityController : ControllerBase
{
    private readonly IIdentityService _identity;

    public IdentityController(IIdentityService identity) => _identity = identity;

    // GET /api/v1/identity/risky-users
    [HttpGet("risky-users")]
    public async Task<IActionResult> RiskyUsers(
        [FromQuery] Guid tenantId,
        [FromQuery] string? riskLevel,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var result = await _identity.GetRiskyUsersAsync(tenantId, riskLevel, page, pageSize, ct);
        return Ok(result);
    }

    // POST /api/v1/identity/risky-users/{userId}/reset-password
    [HttpPost("risky-users/{userId}/reset-password")]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> ResetPassword(string userId, [FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await _identity.ResetUserPasswordAsync(tenantId, userId, ct);
        return Ok(new { message = "Password reset initiated" });
    }

    // POST /api/v1/identity/risky-users/{userId}/dismiss
    [HttpPost("risky-users/{userId}/dismiss")]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> DismissRisk(string userId, [FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await _identity.DismissUserRiskAsync(tenantId, userId, ct);
        return NoContent();
    }

    // POST /api/v1/identity/risky-users/{userId}/revoke-sessions
    [HttpPost("risky-users/{userId}/revoke-sessions")]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> RevokeSessions(string userId, [FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await _identity.RevokeUserSessionsAsync(tenantId, userId, ct);
        return Ok(new { message = "All sessions revoked" });
    }

    // GET /api/v1/identity/sign-ins
    [HttpGet("sign-ins")]
    public async Task<IActionResult> SignIns(
        [FromQuery] Guid tenantId,
        [FromQuery] string? userId,
        [FromQuery] bool riskyOnly = false,
        [FromQuery] int hours = 24,
        CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var result = await _identity.GetSignInsAsync(tenantId, userId, riskyOnly, hours, ct);
        return Ok(result);
    }

    // GET /api/v1/identity/mfa-status
    [HttpGet("mfa-status")]
    public async Task<IActionResult> MfaStatus([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var result = await _identity.GetMfaStatusAsync(tenantId, ct);
        return Ok(result);
    }

    // GET /api/v1/identity/ca-policies
    [HttpGet("ca-policies")]
    public async Task<IActionResult> ConditionalAccessPolicies([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var result = await _identity.GetCaPoliciesAsync(tenantId, ct);
        return Ok(result);
    }

    // GET /api/v1/identity/summary
    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var summary = await _identity.GetSummaryAsync(tenantId, ct);
        return Ok(summary);
    }
}
