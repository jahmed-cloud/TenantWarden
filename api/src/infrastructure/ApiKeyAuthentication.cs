using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace TenantWarden.Api.Infrastructure;

/// <summary>
/// Authenticates <c>X-API-Key</c> requests (SDKs, SIEM ingestion, scripts). Keys are issued by
/// auth-service (<c>POST /auth/api-keys</c>) and stored as SHA-256 — the same hash as
/// UserService.HashApiKey there. The key's owner supplies role and tenant, so tenant scoping
/// and role checks apply exactly as for a signed-in user.
/// </summary>
public class ApiKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "ApiKey";
    public const string HeaderName = "X-API-Key";

    private readonly IDbConnectionFactory _db;

    public ApiKeyAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
        UrlEncoder encoder, IDbConnectionFactory db) : base(options, logger, encoder) => _db = db;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var key = Request.Headers[HeaderName].ToString();
        if (string.IsNullOrEmpty(key)) return AuthenticateResult.NoResult();

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
        await using var conn = _db.CreateConnection();
        var user = await conn.QueryFirstOrDefaultAsync<(Guid id, string email, string role, Guid? tenantId)>(
            @"SELECT id, email, role::text, tenant_id FROM platform_users
              WHERE api_key_hash = @hash AND is_active = TRUE",
            new { hash });
        if (user == default) return AuthenticateResult.Fail("Invalid API key");

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.id.ToString()),
            new(ClaimTypes.Email,          user.email),
            new(ClaimTypes.Role,           user.role),
            new("tenant_id",               user.tenantId?.ToString() ?? ""),
            new("auth_method",             "api_key"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }
}
