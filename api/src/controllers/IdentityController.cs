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
    private readonly IIdentityService   _identity;
    private readonly IRemediationClient _remediation;
    private readonly ILogger<IdentityController> _log;

    public IdentityController(IIdentityService identity, IRemediationClient remediation, ILogger<IdentityController> log)
    {
        _identity    = identity;
        _remediation = remediation;
        _log         = log;
    }

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
        return Ok(await _identity.GetRiskyUsersAsync(tenantId, riskLevel, page, pageSize, ct));
    }

    // POST /api/v1/identity/risky-users/{userId}/{action}
    // action: dismiss | confirm-compromised | revoke-sessions — executed in Entra ID through Microsoft Graph
    [HttpPost("risky-users/{userId}/{action}")]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> Remediate(string userId, string action, [FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        if (!RemediationClient.Actions.Contains(action)) return NotFound();

        var objectId = await _identity.GetRiskyUserObjectIdAsync(tenantId, userId, ct);
        if (objectId is null) return NotFound(new { error = "Risky user not found" });

        var result = await _remediation.RunAsync(tenantId, action, objectId, ct);
        if (!result.Ok)
        {
            _log.LogWarning("Remediation {Action} for {ObjectId} in {TenantId} failed: {Error}", action, objectId, tenantId, result.Error);
            return StatusCode(502, new { error = result.Error });
        }

        // Mirror the change locally so the dashboard reflects it before the next collection
        if (action == "dismiss")             await _identity.MarkRiskyUserAsync(tenantId, objectId, "none", ct);
        if (action == "confirm-compromised") await _identity.MarkRiskyUserAsync(tenantId, objectId, "high", ct);

        _log.LogInformation("Remediation {Action} for {ObjectId} in {TenantId} by {UserId}", action, objectId, tenantId, User.UserId());
        return Ok(new { status = "done", action });
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
        return Ok(await _identity.GetSignInsAsync(tenantId, userId, riskyOnly, hours, ct));
    }

    // GET /api/v1/identity/sign-ins/trend — risky sign-ins per day, split by risk level
    [HttpGet("sign-ins/trend")]
    public async Task<IActionResult> SignInTrend([FromQuery] Guid tenantId, [FromQuery] int days = 14, CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _identity.GetSignInTrendAsync(tenantId, days, ct));
    }

    // GET /api/v1/identity/sign-ins/countries — where risky sign-ins come from
    [HttpGet("sign-ins/countries")]
    public async Task<IActionResult> SignInCountries([FromQuery] Guid tenantId, [FromQuery] int days = 30, CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _identity.GetSignInCountriesAsync(tenantId, days, ct));
    }

    // GET /api/v1/identity/mfa-status
    [HttpGet("mfa-status")]
    public async Task<IActionResult> MfaStatus([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _identity.GetMfaStatusAsync(tenantId, ct));
    }

    // GET /api/v1/identity/ca-policies
    [HttpGet("ca-policies")]
    public async Task<IActionResult> ConditionalAccessPolicies([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _identity.GetCaPoliciesAsync(tenantId, ct));
    }

    // GET /api/v1/identity/summary
    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _identity.GetSummaryAsync(tenantId, ct));
    }
}
