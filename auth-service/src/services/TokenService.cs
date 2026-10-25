using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using TenantWarden.Auth.Models;
using TenantWarden.Auth.Config;
using Microsoft.Extensions.Options;
using StackExchange.Redis;

namespace TenantWarden.Auth.Services;

public interface ITokenService
{
    Task<TokenPair> IssueTokenPairAsync(PlatformUser user, CancellationToken ct = default);
    Task<ClaimsPrincipal?> ValidateAccessTokenAsync(string token);
    Task<TokenPair?> RefreshAsync(string refreshToken, CancellationToken ct = default);
    Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default);
    Task RevokeAllUserTokensAsync(string userId, CancellationToken ct = default);
}

public class TokenService : ITokenService
{
    private readonly JwtOptions _jwt;
    private readonly IDatabase _redis;
    private readonly IUserService _users;
    private readonly ILogger<TokenService> _log;

    private const string RefreshPrefix = "refresh:";
    private const string RevokedPrefix = "revoked:";

    public TokenService(IOptions<JwtOptions> jwt, IConnectionMultiplexer redis, IUserService users, ILogger<TokenService> log)
    {
        _jwt   = jwt.Value;
        _redis = redis.GetDatabase();
        _users = users;
        _log   = log;
    }

    public async Task<TokenPair> IssueTokenPairAsync(PlatformUser user, CancellationToken ct = default)
    {
        var accessToken   = BuildAccessToken(user);
        var refreshToken  = GenerateRefreshToken();
        var refreshExpiry = TimeSpan.FromDays(_jwt.RefreshTokenExpiryDays);

        // Store refresh token in Redis: refresh:{token} → userId
        await _redis.StringSetAsync(
            $"{RefreshPrefix}{refreshToken}",
            user.Id.ToString(),
            refreshExpiry);

        _log.LogInformation("Issued token pair for user {UserId} role {Role}", user.Id, user.Role);

        return new TokenPair
        {
            AccessToken        = accessToken,
            RefreshToken       = refreshToken,
            AccessTokenExpiry  = DateTime.UtcNow.AddMinutes(_jwt.AccessTokenExpiryMinutes),
            RefreshTokenExpiry = DateTime.UtcNow.Add(refreshExpiry),
            TokenType          = "Bearer",
        };
    }

    public Task<ClaimsPrincipal?> ValidateAccessTokenAsync(string token)
    {
        var handler    = new JwtSecurityTokenHandler();
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SigningKey));

        try
        {
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey        = signingKey,
                ValidateIssuer          = true,
                ValidIssuer             = _jwt.Issuer,
                ValidateAudience        = true,
                ValidAudience           = _jwt.Audience,
                ValidateLifetime        = true,
                ClockSkew               = TimeSpan.FromSeconds(30),
            }, out _);

            return Task.FromResult<ClaimsPrincipal?>(principal);
        }
        catch
        {
            return Task.FromResult<ClaimsPrincipal?>(null);
        }
    }

    public async Task<TokenPair?> RefreshAsync(string refreshToken, CancellationToken ct = default)
    {
        var userId = await _redis.StringGetAsync($"{RefreshPrefix}{refreshToken}");
        if (userId.IsNullOrEmpty) return null;

        // Check if explicitly revoked
        var revoked = await _redis.KeyExistsAsync($"{RevokedPrefix}{refreshToken}");
        if (revoked) return null;

        // Rotate: a refresh token works once. Deleting first means a replayed token finds nothing.
        if (!await _redis.KeyDeleteAsync($"{RefreshPrefix}{refreshToken}")) return null;

        // Re-read the user so a deactivated account or a changed role takes effect at the next refresh
        if (!Guid.TryParse(userId.ToString(), out var id)) return null;
        var user = await _users.GetByIdAsync(id, ct);
        if (user is null) return null;

        return await IssueTokenPairAsync(user, ct);
    }

    public async Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct = default)
    {
        await _redis.KeyDeleteAsync($"{RefreshPrefix}{refreshToken}");
        // Mark as revoked for a grace period
        await _redis.StringSetAsync($"{RevokedPrefix}{refreshToken}", "1", TimeSpan.FromMinutes(5));
        _log.LogInformation("Refresh token revoked");
    }

    public async Task RevokeAllUserTokensAsync(string userId, CancellationToken ct = default)
    {
        // In production: use Redis SCAN to find all refresh:{token} keys for this userId
        // For now mark user as force-logout
        await _redis.StringSetAsync($"force_logout:{userId}", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), TimeSpan.FromDays(7));
        _log.LogInformation("All tokens revoked for user {UserId}", userId);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private string BuildAccessToken(PlatformUser user)
    {
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SigningKey));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub,   user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name,  user.DisplayName),
            new(JwtRegisteredClaimNames.Jti,   Guid.NewGuid().ToString()),
            new(ClaimTypes.Role,               user.Role),
            new("tenant_id",                   user.TenantId?.ToString() ?? ""),
            new("azure_oid",                   user.AzureObjectId ?? ""),
            new("mfa_verified",                user.MfaEnabled.ToString().ToLower()),
        };

        var token = new JwtSecurityToken(
            issuer:             _jwt.Issuer,
            audience:           _jwt.Audience,
            claims:             claims,
            notBefore:          DateTime.UtcNow,
            expires:            DateTime.UtcNow.AddMinutes(_jwt.AccessTokenExpiryMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string GenerateRefreshToken()
    {
        var bytes = new byte[64];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }
}

public record TokenPair
{
    public required string   AccessToken        { get; init; }
    public required string   RefreshToken       { get; init; }
    public required DateTime AccessTokenExpiry  { get; init; }
    public required DateTime RefreshTokenExpiry { get; init; }
    public string            TokenType          { get; init; } = "Bearer";
}
