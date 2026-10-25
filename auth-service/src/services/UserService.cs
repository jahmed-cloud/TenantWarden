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
    Task<DateTime?> GetApiKeyCreatedAtAsync(Guid userId, CancellationToken ct = default);
    Task RevokeApiKeyAsync(Guid userId, CancellationToken ct = default);
    Task<PlatformUser> CreateUserAsync(string email, string displayName, string role, Guid? tenantId, string temporaryPassword, CancellationToken ct = default);
    Task UpdateUserAsync(Guid id, string? role, bool? isActive, Guid? tenantId, bool clearTenant, CancellationToken ct = default);
    Task SetTemporaryPasswordAsync(Guid id, string temporaryPassword, CancellationToken ct = default);
    Task<PlatformUser?> GetAnyByIdAsync(Guid id, CancellationToken ct = default);
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

    // API keys are 256 random bits, so a plain SHA-256 is enough (no brute-force risk) and lets the
    // API look a key up by its hash in one indexed query. Must match ApiKeyAuthenticationHandler in api/.
    public static string HashApiKey(string key) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    public async Task<string> GenerateApiKeyAsync(Guid userId, CancellationToken ct = default)
    {
        var rawKey = "twk_" + Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
                                     .Replace("+", "-").Replace("/", "_").TrimEnd('=');

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            @"UPDATE platform_users SET api_key_hash = @hash, api_key_created_at = NOW(), updated_at = NOW()
              WHERE id = @userId",
            new { hash = HashApiKey(rawKey), userId });

        return rawKey; // shown once — only the hash is stored
    }

    public async Task<DateTime?> GetApiKeyCreatedAtAsync(Guid userId, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT api_key_created_at FROM platform_users WHERE id = @userId AND api_key_hash IS NOT NULL", new { userId });
    }

    public async Task RevokeApiKeyAsync(Guid userId, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            "UPDATE platform_users SET api_key_hash = NULL, api_key_created_at = NULL, updated_at = NOW() WHERE id = @userId",
            new { userId });
    }

    // ── User administration ───────────────────────────────────────────────────

    public async Task<PlatformUser> CreateUserAsync(string email, string displayName, string role, Guid? tenantId,
        string temporaryPassword, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.QueryFirstAsync<PlatformUser>(
            @"INSERT INTO platform_users (email, display_name, role, tenant_id, is_active, password_hash, must_change_password)
              VALUES (lower(@email), @displayName, @role::user_role, @tenantId, TRUE, @hash, TRUE)
              RETURNING *",
            new { email = email.Trim(), displayName = displayName.Trim(), role, tenantId,
                  hash = BCrypt.Net.BCrypt.HashPassword(temporaryPassword, workFactor: 12) });
    }

    public async Task UpdateUserAsync(Guid id, string? role, bool? isActive, Guid? tenantId, bool clearTenant, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            @"UPDATE platform_users SET
                role       = COALESCE(@role::user_role, role),
                is_active  = COALESCE(@isActive, is_active),
                tenant_id  = CASE WHEN @clearTenant THEN NULL ELSE COALESCE(@tenantId, tenant_id) END,
                updated_at = NOW()
              WHERE id = @id",
            new { id, role, isActive, tenantId, clearTenant });
    }

    public async Task SetTemporaryPasswordAsync(Guid id, string temporaryPassword, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.ExecuteAsync(
            @"UPDATE platform_users SET password_hash = @hash, must_change_password = TRUE, updated_at = NOW()
              WHERE id = @id",
            new { id, hash = BCrypt.Net.BCrypt.HashPassword(temporaryPassword, workFactor: 12) });
    }

    public async Task<PlatformUser?> GetAnyByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        return await conn.QueryFirstOrDefaultAsync<PlatformUser>("SELECT * FROM platform_users WHERE id = @id", new { id });
    }
}

public record MsalUserInfo(string ObjectId, string Email, string DisplayName, string? TenantId);
