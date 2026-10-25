using Dapper;
using TenantWarden.Api.Models;
using TenantWarden.Api.Infrastructure;
using System.Security.Cryptography;
using System.Text;

namespace TenantWarden.Api.Services;

public interface ITenantService
{
    Task<List<Tenant>> ListAsync(CancellationToken ct = default);
    Task<Tenant?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Tenant> CreateAsync(CreateTenantRequest req, CancellationToken ct = default);
    Task UpdateAsync(Guid id, UpdateTenantRequest req, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<Tenant?> GetByAzureTenantIdAsync(string azureTenantId, CancellationToken ct = default);
    Task UpdateSyncMetadataAsync(Guid id, int userCount, int deviceCount, string? error, CancellationToken ct = default);
    Task<string> DecryptClientSecretAsync(Guid id, CancellationToken ct = default);
}

public class TenantService : ITenantService
{
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<TenantService> _log;
    // In production: use Azure Key Vault or AWS KMS. For now: AES-256-GCM with env key.
    private readonly byte[] _encKey;

    public TenantService(IDbConnectionFactory db, IConfiguration cfg, ILogger<TenantService> log)
    {
        _db     = db;
        _log    = log;
        var raw = cfg["Encryption:TenantSecretKey"] ?? cfg["JWT_SIGNING_KEY"] ?? "tenantwarden-default-key-change-me";
        _encKey = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
    }

    public async Task<List<Tenant>> ListAsync(CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var items = await conn.QueryAsync<Tenant>("SELECT * FROM tenants ORDER BY display_name");
        return items.ToList();
    }

    public async Task<Tenant?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Tenant>("SELECT * FROM tenants WHERE id = @id", new { id });
    }

    public async Task<Tenant?> GetByAzureTenantIdAsync(string azureTenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Tenant>(
            "SELECT * FROM tenants WHERE azure_tenant_id = @azureTenantId", new { azureTenantId });
    }

    public async Task<Tenant> CreateAsync(CreateTenantRequest req, CancellationToken ct = default)
    {
        var encryptedSecret = Encrypt(req.ClientSecret);
        await using var conn = _db.CreateConnection();

        // RETURNING only scalar columns — Dapper can't hydrate TEXT[] / enum into the
        // full Tenant model, so we fetch the id and return a lightweight object.
        var id = await conn.ExecuteScalarAsync<Guid>(
            @"INSERT INTO tenants
                (display_name, azure_tenant_id, domain, client_id, encrypted_client_secret,
                 description, enabled_modules, status)
              VALUES
                (@DisplayName, @AzureTenantId, @Domain, @ClientId, @EncryptedSecret,
                 @Description, @Modules, 'active')
              RETURNING id",
            new
            {
                req.DisplayName, req.AzureTenantId, req.Domain, req.ClientId,
                EncryptedSecret = encryptedSecret,
                req.Description,
                Modules = req.EnabledModules?.ToArray() ?? ["identity", "defender", "intune"],
            });

        _log.LogInformation("Tenant created {TenantId} {Name}", id, req.DisplayName);

        // Starter alert rules (migration 011) so a new tenant is monitored from the first collection
        try { await conn.ExecuteAsync("SELECT create_default_alert_rules(@id)", new { id }); }
        catch (Npgsql.PostgresException ex) { _log.LogWarning(ex, "Default alert rules not created for {TenantId} — run make seed", id); }

        return new Tenant
        {
            Id             = id,
            DisplayName    = req.DisplayName,
            AzureTenantId  = req.AzureTenantId,
            Domain         = req.Domain,
            ClientId       = req.ClientId,
            EncryptedClientSecret = encryptedSecret,
            Description    = req.Description,
            Status         = TenantStatus.Active,
            EnabledModules = req.EnabledModules ?? ["identity", "defender", "intune"],
        };
    }

    public async Task UpdateAsync(Guid id, UpdateTenantRequest req, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE tenants SET
                display_name     = COALESCE(@DisplayName, display_name),
                description      = COALESCE(@Description, description),
                enabled_modules  = COALESCE(@Modules, enabled_modules),
                status           = COALESCE(@Status::tenant_status, status),
                updated_at       = NOW()
              WHERE id = @id",
            new { id, req.DisplayName, req.Description, req.Status,
                  Modules = req.EnabledModules?.ToArray() });
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        // Collected data cascades; platform users and audit entries keep their rows with tenant_id cleared.
        // Pausing (PATCH status=paused) is the way to stop collection but keep the data.
        await conn.ExecuteAsync("DELETE FROM tenants WHERE id = @id", new { id });
    }

    public async Task UpdateSyncMetadataAsync(Guid id, int userCount, int deviceCount, string? error, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE tenants SET
                user_count      = @userCount,
                device_count    = @deviceCount,
                last_sync_at    = NOW(),
                last_sync_error = @error,
                status          = CASE WHEN @error IS NULL THEN 'active'::tenant_status ELSE 'error'::tenant_status END,
                updated_at      = NOW()
              WHERE id = @id",
            new { id, userCount, deviceCount, error });
    }

    public async Task<string> DecryptClientSecretAsync(Guid id, CancellationToken ct = default)
    {
        var tenant = await GetByIdAsync(id, ct);
        if (tenant is null) throw new KeyNotFoundException($"Tenant {id} not found");
        return Decrypt(tenant.EncryptedClientSecret);
    }

    // ── AES-256-GCM encryption ────────────────────────────────────────────────

    private string Encrypt(string plaintext)
    {
        var nonce      = new byte[12];
        var tag        = new byte[16];
        var ciphertext = new byte[Encoding.UTF8.GetByteCount(plaintext)];
        RandomNumberGenerator.Fill(nonce);

        using var aes = new AesGcm(_encKey, 16);
        aes.Encrypt(nonce, Encoding.UTF8.GetBytes(plaintext), ciphertext, tag);

        var result = new byte[12 + 16 + ciphertext.Length];
        nonce.CopyTo(result, 0);
        tag.CopyTo(result, 12);
        ciphertext.CopyTo(result, 28);
        return Convert.ToBase64String(result);
    }

    private string Decrypt(string base64)
    {
        var data       = Convert.FromBase64String(base64);
        var nonce      = data[..12];
        var tag        = data[12..28];
        var ciphertext = data[28..];
        var plaintext  = new byte[ciphertext.Length];

        using var aes = new AesGcm(_encKey, 16);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);
        return Encoding.UTF8.GetString(plaintext);
    }
}

public record CreateTenantRequest(
    string        DisplayName,
    string        AzureTenantId,
    string        Domain,
    string        ClientId,
    string        ClientSecret,
    string?       Description      = null,
    List<string>? EnabledModules   = null);

public record UpdateTenantRequest(
    string?       DisplayName     = null,
    string?       Description     = null,
    string?       Status          = null,
    List<string>? EnabledModules  = null);
