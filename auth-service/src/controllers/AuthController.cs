using TenantWarden.Auth.Services;
using TenantWarden.Auth.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace TenantWarden.Auth.Controllers;

[ApiController]
[Route("auth")]
public class AuthController : ControllerBase
{
    private readonly IUserService   _users;
    private readonly ITokenService  _tokens;
    private readonly IMfaService    _mfa;
    private readonly ILoginThrottle _throttle;
    private readonly ILogger<AuthController> _log;

    public AuthController(IUserService users, ITokenService tokens, IMfaService mfa, ILoginThrottle throttle, ILogger<AuthController> log)
    {
        _users    = users;
        _tokens   = tokens;
        _mfa      = mfa;
        _throttle = throttle;
        _log      = log;
    }

    // POST /auth/login  — local username/password
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req, CancellationToken ct)
    {
        var ipAddr   = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var throttleKey = $"{req.Email?.ToLower()}|{ipAddr}";

        if (await _throttle.IsLockedAsync(throttleKey))
        {
            _log.LogWarning("Login blocked (locked out): {Email} from {Ip}", req.Email, ipAddr);
            return StatusCode(429, new { error = "Too many failed attempts. Try again in 15 minutes." });
        }

        var user = await _users.AuthenticateLocalAsync(req.Email, req.Password, ct);
        if (user is null)
        {
            var fails = await _throttle.RegisterFailureAsync(throttleKey);
            _log.LogWarning("Failed login {Attempt}/5 for {Email} from {Ip}", fails, req.Email, ipAddr);
            return Unauthorized(new { error = "Invalid credentials" });
        }

        // MFA required?
        if (user.MfaEnabled)
        {
            if (string.IsNullOrEmpty(req.TotpCode))
                return Ok(new { requiresMfa = true, mfaChallenge = Guid.NewGuid() });

            // Wrong codes count toward the same lockout as wrong passwords
            if (!_mfa.ValidateTotp(user.TotpSecret!, req.TotpCode))
            {
                var fails = await _throttle.RegisterFailureAsync(throttleKey);
                _log.LogWarning("Failed MFA code {Attempt}/5 for {Email} from {Ip}", fails, req.Email, ipAddr);
                return Unauthorized(new { error = "Invalid MFA code" });
            }
        }

        await _throttle.ResetAsync(throttleKey);
        await _users.UpdateLastLoginAsync(user.Id, ipAddr, ct);
        var pair   = await _tokens.IssueTokenPairAsync(user, ct);

        SetRefreshCookie(pair.RefreshToken, pair.RefreshTokenExpiry);
        return Ok(new LoginResponse(pair.AccessToken, pair.AccessTokenExpiry, pair.TokenType, user.ToProfile()));
    }

    // POST /auth/msal  — Microsoft Entra ID / MSAL token exchange
    [HttpPost("msal")]
    public async Task<IActionResult> MsalExchange([FromBody] MsalExchangeRequest req, CancellationToken ct)
    {
        // Validate the Microsoft token
        var principal = await _tokens.ValidateAccessTokenAsync(req.MicrosoftToken);
        if (principal is null)
            return Unauthorized(new { error = "Invalid Microsoft token" });

        var info = new MsalUserInfo(
            ObjectId:    principal.FindFirstValue("oid")   ?? throw new InvalidOperationException("Missing oid"),
            Email:       principal.FindFirstValue("email") ?? principal.FindFirstValue("preferred_username") ?? "",
            DisplayName: principal.FindFirstValue("name")  ?? "",
            TenantId:    principal.FindFirstValue("tid"));

        var user = await _users.GetByAzureOidAsync(info.ObjectId, ct)
                ?? await _users.ProvisionFromMsalAsync(info, ct);

        var ip   = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        await _users.UpdateLastLoginAsync(user.Id, ip, ct);
        var pair = await _tokens.IssueTokenPairAsync(user, ct);

        SetRefreshCookie(pair.RefreshToken, pair.RefreshTokenExpiry);
        return Ok(new LoginResponse(pair.AccessToken, pair.AccessTokenExpiry, pair.TokenType, user.ToProfile()));
    }

    // POST /auth/refresh
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(CancellationToken ct)
    {
        var refreshToken = Request.Cookies["tenantwarden_refresh"];
        if (string.IsNullOrEmpty(refreshToken))
            return Unauthorized(new { error = "No refresh token" });

        var result = await _tokens.RefreshAsync(refreshToken, ct);
        if (result is null)
            return Unauthorized(new { error = "Invalid or expired refresh token" });

        SetRefreshCookie(result.RefreshToken, result.RefreshTokenExpiry);
        return Ok(new { accessToken = result.AccessToken, expiry = result.AccessTokenExpiry });
    }

    // POST /auth/logout
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        var refreshToken = Request.Cookies["tenantwarden_refresh"];
        if (!string.IsNullOrEmpty(refreshToken))
            await _tokens.RevokeRefreshTokenAsync(refreshToken, ct);

        Response.Cookies.Delete("tenantwarden_refresh", new CookieOptions { Path = "/auth" });
        return NoContent();
    }

    // GET /auth/me
    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId is null) return Unauthorized();

        var user = await _users.GetByIdAsync(Guid.Parse(userId), ct);
        return user is null ? NotFound() : Ok(user.ToProfile());
    }

    // POST /auth/mfa/setup
    [HttpPost("mfa/setup")]
    [Authorize]
    public IActionResult MfaSetup()
    {
        var email          = User.FindFirstValue(ClaimTypes.Email) ?? "";
        var (secret, uri)  = _mfa.GenerateTotpSetup(email);
        return Ok(new { secret, qrUri = uri });
    }

    // POST /auth/mfa/verify
    [HttpPost("mfa/verify")]
    [Authorize]
    public async Task<IActionResult> MfaVerify([FromBody] MfaVerifyRequest req, CancellationToken ct)
    {
        if (!_mfa.ValidateTotp(req.Secret, req.Code))
            return BadRequest(new { error = "Invalid TOTP code" });

        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        await _users.EnableMfaAsync(userId, req.Secret, ct);
        return Ok(new { enabled = true });
    }

    // GET /auth/api-keys — whether the signed-in user has an API key, and since when
    [HttpGet("api-keys")]
    [Authorize]
    public async Task<IActionResult> ApiKeyStatus(CancellationToken ct)
    {
        var userId    = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var createdAt = await _users.GetApiKeyCreatedAtAsync(userId, ct);
        return Ok(new { active = createdAt is not null, createdAt });
    }

    // POST /auth/api-keys — create (or rotate) the signed-in user's API key; sent as X-API-Key
    [HttpPost("api-keys")]
    [Authorize]
    public async Task<IActionResult> GenerateApiKey(CancellationToken ct)
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var key    = await _users.GenerateApiKeyAsync(userId, ct);
        return Ok(new { apiKey = key, note = "Store this key safely — it will not be shown again." });
    }

    // DELETE /auth/api-keys — revoke the signed-in user's API key
    [HttpDelete("api-keys")]
    [Authorize]
    public async Task<IActionResult> RevokeApiKey(CancellationToken ct)
    {
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        await _users.RevokeApiKeyAsync(userId, ct);
        return NoContent();
    }

    // POST /auth/change-password  — authenticated user rotates their own password
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req, CancellationToken ct)
    {
        var sub = User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                  ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(sub, out var userId)) return Unauthorized();
        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 12)
            return BadRequest(new { error = "New password must be at least 12 characters" });

        var ok = await _users.ChangePasswordAsync(userId, req.CurrentPassword, req.NewPassword, ct);
        return ok ? Ok(new { status = "password changed" })
                  : BadRequest(new { error = "Current password incorrect" });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private void SetRefreshCookie(string token, DateTime expiry)
    {
        Response.Cookies.Append("tenantwarden_refresh", token, new CookieOptions
        {
            HttpOnly  = true,
            // Browsers drop Secure cookies on plain-HTTP origins other than localhost (e.g. a LAN IP),
            // which would end every session after 15 minutes. HTTPS (via X-Forwarded-Proto) keeps Secure.
            Secure    = Request.IsHttps,
            SameSite  = SameSiteMode.Strict,
            Expires   = expiry,
            Path      = "/auth",
        });
    }
}

// ── Request / Response records ────────────────────────────────────────────────

public record LoginRequest(string Email, string Password, string? TotpCode = null);
public record MsalExchangeRequest(string MicrosoftToken);
public record MfaVerifyRequest(string Secret, string Code);
public record LoginResponse(string AccessToken, DateTime Expiry, string TokenType, UserProfile User);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
