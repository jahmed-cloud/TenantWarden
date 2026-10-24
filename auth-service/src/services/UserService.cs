using Dapper;
using Npgsql;
using TenantWarden.Auth.Models;
using Microsoft.Extensions.Options;
using TenantWarden.Auth.Config;

namespace TenantWarden.Auth.Services;

public interface IUserService
{
    Task<PlatformUser?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<PlatformUser?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<PlatformUser?> GetByAzureOidAsync(string oid, CancellationToken ct = default);
    Task<PlatformUser?> AuthenticateLocalAsync(string email, string password, CancellationToken ct = default);
    Task<PlatformUser> ProvisionFromMsalAsync(MsalUserInfo info, CancellationToken ct = default);
    Task<bool> ChangePasswordAsync(Guid userId, string currentPassword, string newPassword, CancellationToken ct = default);
    Task EnableMfaAsync(Guid userId, string totpSecret, CancellationToken ct = default);
    Task UpdateLastLoginAsync(Guid userId, string ipAddress, CancellationToken ct = default);
    Task<string> GenerateApiKeyAsync(Guid userId, CancellationToken ct = default);
    Task<PlatformUser?> GetByApiKeyAsync(string apiKey, CancellationToken ct = default);
}

public class UserService : IUserService
{
    private readonly string _connStr;
    private readonly ILogger<UserService> _log;

    public UserService(IOptions<DatabaseOptions> db, ILogger<UserService> log)
    {
        _connStr = db.Value.Postgres;
        _log     = log;
    }

    public async Task<PlatformUser?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.QueryFirstOrDefaultAsync<PlatformUser>(
            "SELECT * FROM platform_users WHERE id = @id AND is_active = TRUE", new { id });
    }

    public async Task<PlatformUser?> GetByEmailAsync(string email, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.QueryFirstOrDefaultAsync<PlatformUser>(
            "SELECT * FROM platform_users WHERE lower(email) = lower(@email) AND is_active = TRUE",
            new { email });
    }

    public async Task<PlatformUser?> GetByAzureOidAsync(string oid, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.QueryFirstOrDefaultAsync<PlatformUser>(
            "SELECT * FROM platform_users WHERE azure_object_id = @oid AND is_active = TRUE",
            new { oid });
    }

    public async Task<PlatformUser?> AuthenticateLocalAsync(string email, string password, CancellationToken ct = default)
    {
        var user = await GetByEmailAsync(email, ct);
        if (user is null || string.IsNullOrEmpty(user.PasswordHash)) return null;
        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)) return null;
        return user;
    }

    public async Task<bool> ChangePasswordAsync(Guid userId, string currentPassword, string newPassword, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        var user = await conn.QueryFirstOrDefaultAsync<PlatformUser>(
            "SELECT * FROM platform_users WHERE id = @userId AND is_active = TRUE", new { userId });
        if (user is null || string.IsNullOrEmpty(user.PasswordHash)) return false;
        if (!BCrypt.Net.BCrypt.Verify(currentPassword, user.PasswordHash)) return false;
        if (newPassword.Length < 8) return false;

        var newHash = BCrypt.Net.BCrypt.HashPassword(newPassword, workFactor: 12);
        await conn.ExecuteAsync(
            @"UPDATE platform_users
              SET password_hash = @newHash, must_change_password = FALSE, updated_at = NOW()
              WHERE id = @userId",
            new { userId, newHash });
        return true;
    }

    public async Task<PlatformUser> ProvisionFromMsalAsync(MsalUserInfo info, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);

        // Upsert: update if exists, insert if new
        var user = await conn.QueryFirstOrDefaultAsync<PlatformUser>(
            @"INSERT INTO platform_users (email, display_name, azure_object_id, role, is_active)
              VALUES (@Email, @DisplayName, @Oid, 'viewer', TRUE)
              ON CONFLICT (email) DO UPDATE
                SET display_name   = EXCLUDED.display_name,
                    azure_object_id = EXCLUDED.azure_object_id,
                    updated_at      = NOW()
              RETURNING *",
            new { info.Email, info.DisplayName, Oid = info.ObjectId });

        _log.LogInformation("Provisioned MSAL user {Email} oid:{Oid}", info.Email, info.ObjectId);
        return user!;
    }

    public async Task EnableMfaAsync(Guid userId, string totpSecret, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            "UPDATE platform_users SET totp_secret = @secret, mfa_enabled = TRUE, updated_at = NOW() WHERE id = @userId",
            new { secret = totpSecret, userId });
    }

    public async Task UpdateLastLoginAsync(Guid userId, string ipAddress, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            "UPDATE platform_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = @userId",
            new { userId });

        // Write audit log — a failure here (e.g. missing partition) must not block login
        try
        {
            await conn.ExecuteAsync(
                @"INSERT INTO audit_logs (tenant_id, user_id, user_email, action, resource, ip_address, success)
                  SELECT pu.tenant_id, pu.id::text, pu.email, 'login', 'session', @ip::inet, TRUE
                  FROM platform_users pu WHERE pu.id = @userId",
                new { userId, ip = ipAddress });
        }
        catch (PostgresException ex)
        {
            _log.LogError(ex, "Login audit write failed for user {UserId}", userId);
        }
    }

    public async Task<string> GenerateApiKeyAsync(Guid userId, CancellationToken ct = default)
    {
        var rawKey  = $"grd_{Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)).Replace("+","-").Replace("/","_").TrimEnd('=')}";
        var keyHash = BCrypt.Net.BCrypt.HashPassword(rawKey, workFactor: 10);

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            "UPDATE platform_users SET api_key_hash = @keyHash, updated_at = NOW() WHERE id = @userId",
            new { keyHash, userId });

        return rawKey; // Return raw only once — never stored in plain text
    }

    public async Task<PlatformUser?> GetByApiKeyAsync(string apiKey, CancellationToken ct = default)
    {
        // Load all active users with api_key_hash set (paginated in production)
        await using var conn = new NpgsqlConnection(_connStr);
        var candidates = await conn.QueryAsync<PlatformUser>(
            "SELECT * FROM platform_users WHERE api_key_hash IS NOT NULL AND is_active = TRUE LIMIT 1000");

        return candidates.FirstOrDefault(u => BCrypt.Net.BCrypt.Verify(apiKey, u.PasswordHash ?? ""));
    }
}

public record MsalUserInfo(string ObjectId, string Email, string DisplayName, string? TenantId);
