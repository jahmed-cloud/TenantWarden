using System.Security.Claims;
using TenantWarden.Auth.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace TenantWarden.Auth.Controllers;

/// <summary>
/// Platform user administration. super_admin manages everyone; org_admin manages users in
/// its own tenant and can't grant super_admin or move users between tenants.
/// New users and password resets get a temporary password that must be changed at first sign-in.
/// </summary>
[ApiController]
[Route("auth/users")]
[Authorize(Roles = "super_admin,org_admin")]
public class UsersAdminController : ControllerBase
{
    private static readonly HashSet<string> Roles =
        ["super_admin", "org_admin", "security_admin", "global_reader", "soc_analyst", "helpdesk", "auditor", "viewer", "api_user"];
    private const int MinPasswordLength = 12;

    private readonly IUserService _users;
    private readonly ILogger<UsersAdminController> _log;

    public UsersAdminController(IUserService users, ILogger<UsersAdminController> log)
    {
        _users = users;
        _log   = log;
    }

    private bool IsSuperAdmin => User.IsInRole("super_admin");
    private Guid? HomeTenant  => Guid.TryParse(User.FindFirstValue("tenant_id"), out var t) ? t : null;
    private Guid  CallerId    => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public record CreateUserRequest(string Email, string DisplayName, string Role, Guid? TenantId, string TemporaryPassword);

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@')) return BadRequest(new { error = "A valid email is required" });
        if (string.IsNullOrWhiteSpace(req.DisplayName)) return BadRequest(new { error = "Display name is required" });
        if (!Roles.Contains(req.Role)) return BadRequest(new { error = $"role must be one of: {string.Join(", ", Roles)}" });
        if ((req.TemporaryPassword ?? "").Length < MinPasswordLength)
            return BadRequest(new { error = $"Temporary password must be at least {MinPasswordLength} characters" });

        var tenantId = req.TenantId;
        if (!IsSuperAdmin)
        {
            if (req.Role == "super_admin") return Forbid();
            tenantId = HomeTenant;                         // org admins create users in their own tenant
            if (tenantId is null) return Forbid();
        }
        else if (tenantId is null && req.Role != "super_admin")
        {
            return BadRequest(new { error = "Choose a tenant — only super_admin users can work without one" });
        }

        try
        {
            var user = await _users.CreateUserAsync(req.Email, req.DisplayName, req.Role, tenantId, req.TemporaryPassword!, ct);
            _log.LogInformation("User {Email} ({Role}) created by {CallerId}", user.Email, user.Role, CallerId);
            return Created($"/auth/users/{user.Id}", user.ToProfile());
        }
        catch (PostgresException ex) when (ex.SqlState == "23505")
        {
            return Conflict(new { error = "A user with this email already exists" });
        }
    }

    public record UpdateUserRequest(string? Role, bool? IsActive, Guid? TenantId);

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest req, CancellationToken ct)
    {
        var target = await _users.GetAnyByIdAsync(id, ct);
        if (target is null || !CanManage(target.TenantId)) return NotFound();
        if (req.Role is not null && !Roles.Contains(req.Role)) return BadRequest(new { error = "Unknown role" });
        if (!IsSuperAdmin && (req.Role == "super_admin" || target.Role == "super_admin" || req.TenantId is not null)) return Forbid();
        if (id == CallerId && (req.IsActive == false || (req.Role is not null && req.Role != target.Role)))
            return BadRequest(new { error = "You can't deactivate yourself or change your own role" });

        await _users.UpdateUserAsync(id, req.Role, req.IsActive, req.TenantId, clearTenant: false, ct);
        _log.LogInformation("User {UserId} updated by {CallerId}: role={Role} active={Active}", id, CallerId, req.Role, req.IsActive);
        return NoContent();
    }

    public record ResetPasswordRequest(string TemporaryPassword);

    [HttpPost("{id:guid}/reset-password")]
    public async Task<IActionResult> ResetPassword(Guid id, [FromBody] ResetPasswordRequest req, CancellationToken ct)
    {
        var target = await _users.GetAnyByIdAsync(id, ct);
        if (target is null || !CanManage(target.TenantId)) return NotFound();
        if (!IsSuperAdmin && target.Role == "super_admin") return Forbid();
        if ((req.TemporaryPassword ?? "").Length < MinPasswordLength)
            return BadRequest(new { error = $"Temporary password must be at least {MinPasswordLength} characters" });

        await _users.SetTemporaryPasswordAsync(id, req.TemporaryPassword!, ct);
        _log.LogInformation("Temporary password set for {UserId} by {CallerId}", id, CallerId);
        return NoContent();
    }

    // POST /auth/users/{id}/api-key — key for a service account (role api_user); shown once
    [HttpPost("{id:guid}/api-key")]
    public async Task<IActionResult> GenerateApiKey(Guid id, CancellationToken ct)
    {
        var target = await _users.GetAnyByIdAsync(id, ct);
        if (target is null || !CanManage(target.TenantId)) return NotFound();
        if (!IsSuperAdmin && target.Role == "super_admin") return Forbid();

        var key = await _users.GenerateApiKeyAsync(id, ct);
        _log.LogInformation("API key issued for {UserId} by {CallerId}", id, CallerId);
        return Ok(new { apiKey = key, note = "Store this key safely — it will not be shown again." });
    }

    [HttpDelete("{id:guid}/api-key")]
    public async Task<IActionResult> RevokeApiKey(Guid id, CancellationToken ct)
    {
        var target = await _users.GetAnyByIdAsync(id, ct);
        if (target is null || !CanManage(target.TenantId)) return NotFound();
        await _users.RevokeApiKeyAsync(id, ct);
        return NoContent();
    }

    private bool CanManage(Guid? targetTenant) => IsSuperAdmin || (HomeTenant is not null && targetTenant == HomeTenant);
}
