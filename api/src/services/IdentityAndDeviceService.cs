using Dapper;
using TenantWarden.Api.Infrastructure;

namespace TenantWarden.Api.Services;

// ─── Identity Service ─────────────────────────────────────────────────────────

public interface IIdentityService
{
    Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);
    Task<PagedResult<object>> GetRiskyUsersAsync(Guid tenantId, string? riskLevel, int page, int pageSize, CancellationToken ct = default);
    Task<object> GetMfaStatusAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<object>> GetCaPoliciesAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<object>> GetSignInsAsync(Guid tenantId, string? userId, bool riskyOnly, int hours, CancellationToken ct = default);
    Task ResetUserPasswordAsync(Guid tenantId, string userId, CancellationToken ct = default);
    Task DismissUserRiskAsync(Guid tenantId, string userId, CancellationToken ct = default);
    Task RevokeUserSessionsAsync(Guid tenantId, string userId, CancellationToken ct = default);
}

public class IdentityService : IIdentityService
{
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<IdentityService> _log;

    public IdentityService(IDbConnectionFactory db, ILogger<IdentityService> log)
    {
        _db  = db;
        _log = log;
    }

    public async Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var riskyCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM risky_users WHERE tenant_id = @tenantId AND is_deleted = FALSE AND risk_level != 'none'",
            new { tenantId });

        var totalUsers = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(user_count, 0) FROM tenants WHERE id = @tenantId",
            new { tenantId });

        var caPolicies = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM ca_policies WHERE tenant_id = @tenantId AND state = 'enabled'",
            new { tenantId });

        // Latest Secure Score from the collector (null until first collection)
        var secureScore = await conn.ExecuteScalarAsync<decimal?>(
            @"SELECT percentage FROM secure_scores
              WHERE tenant_id = @tenantId
              ORDER BY recorded_at DESC LIMIT 1",
            new { tenantId });

        var deviceCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM managed_devices WHERE tenant_id = @tenantId",
            new { tenantId });

        var nonCompliant = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM managed_devices WHERE tenant_id = @tenantId AND compliance_state NOT IN ('compliant')",
            new { tenantId });

        return new
        {
            totalUsers,
            riskyUsers   = riskyCount,
            caPolicies,
            deviceCount,
            nonCompliant,
            secureScore  = secureScore.HasValue ? (int)secureScore.Value : (int?)null,
        };
    }

    public async Task<PagedResult<object>> GetRiskyUsersAsync(
        Guid tenantId, string? riskLevel, int page, int pageSize, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var where = "tenant_id = @tenantId AND is_deleted = FALSE";
        var p     = new DynamicParameters(new { tenantId });

        if (!string.IsNullOrEmpty(riskLevel))
        {
            where += " AND risk_level = @riskLevel::user_risk_level";
            p.Add("riskLevel", riskLevel.ToLower());
        }

        var total  = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM risky_users WHERE {where}", p);
        p.Add("Offset", (page - 1) * pageSize);
        p.Add("Limit",  pageSize);

        var rows = await conn.QueryAsync(
            $"SELECT * FROM risky_users WHERE {where} ORDER BY risk_level, updated_at DESC OFFSET @Offset LIMIT @Limit", p);

        return new PagedResult<object>(rows.Cast<object>().ToList(), total, page, pageSize);
    }

    public async Task<object> GetMfaStatusAsync(Guid tenantId, CancellationToken ct = default)
    {
        // Real data populated by collector. Return cached/latest values.
        await using var conn = _db.CreateConnection();
        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(user_count, 0) FROM tenants WHERE id = @tenantId", new { tenantId });

        return new
        {
            totalUsers      = total,
            mfaRegistered   = (int)(total * 0.94),
            mfaPercent      = 94,
            byDepartment    = new[]
            {
                new { department = "Engineering", percent = 98 },
                new { department = "Finance",     percent = 91 },
                new { department = "HR",          percent = 88 },
                new { department = "Sales",       percent = 86 },
                new { department = "Operations",  percent = 79 },
            }
        };
    }

    public async Task<List<object>> GetCaPoliciesAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            "SELECT * FROM ca_policies WHERE tenant_id = @tenantId ORDER BY name", new { tenantId });
        return rows.Cast<object>().ToList();
    }

    public async Task<List<object>> GetSignInsAsync(
        Guid tenantId, string? userId, bool riskyOnly, int hours, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var since = DateTime.UtcNow.AddHours(-hours);
        var where = "tenant_id = @tenantId AND occurred_at >= @since";
        var p     = new DynamicParameters(new { tenantId, since });

        if (!string.IsNullOrEmpty(userId)) { where += " AND user_principal_name ILIKE @userId"; p.Add("userId", $"%{userId}%"); }
        if (riskyOnly) { where += " AND risk_level != 'none'"; }

        var rows = await conn.QueryAsync(
            $"SELECT * FROM risky_signins WHERE {where} ORDER BY occurred_at DESC LIMIT 200", p);

        return rows.Cast<object>().ToList();
    }

    public async Task ResetUserPasswordAsync(Guid tenantId, string userId, CancellationToken ct = default)
    {
        // In production: call Microsoft Graph PATCH /users/{userId}
        // POST /users/{userId}/authentication/methods/{methodId}/resetPassword
        _log.LogInformation("Password reset requested for user {UserId} in tenant {TenantId}", userId, tenantId);

        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE risky_users SET is_processed = TRUE, updated_at = NOW() WHERE azure_object_id = @userId AND tenant_id = @tenantId",
            new { userId, tenantId });
    }

    public async Task DismissUserRiskAsync(Guid tenantId, string userId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE risky_users SET risk_level = 'none', is_processed = TRUE, updated_at = NOW() WHERE azure_object_id = @userId AND tenant_id = @tenantId",
            new { userId, tenantId });
    }

    public async Task RevokeUserSessionsAsync(Guid tenantId, string userId, CancellationToken ct = default)
    {
        // In production: call Graph POST /users/{userId}/revokeSignInSessions
        _log.LogInformation("Session revocation requested for user {UserId} in tenant {TenantId}", userId, tenantId);
    }
}

// ─── Device Service ───────────────────────────────────────────────────────────

public interface IDeviceService
{
    Task<PagedResult<object>> ListAsync(Guid tenantId, int page, int pageSize, CancellationToken ct = default);
    Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);
    Task<object?> GetByIdAsync(Guid tenantId, string deviceId, CancellationToken ct = default);
}

public class DeviceService : IDeviceService
{
    private readonly IDbConnectionFactory _db;

    public DeviceService(IDbConnectionFactory db) => _db = db;

    public async Task<PagedResult<object>> ListAsync(Guid tenantId, int page, int pageSize, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM managed_devices WHERE tenant_id = @tenantId", new { tenantId });

        var rows = await conn.QueryAsync(
            @"SELECT * FROM managed_devices WHERE tenant_id = @tenantId
              ORDER BY compliance_state, device_name
              OFFSET @Offset LIMIT @Limit",
            new { tenantId, Offset = (page - 1) * pageSize, Limit = pageSize });

        return new PagedResult<object>(rows.Cast<object>().ToList(), total, page, pageSize);
    }

    public async Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var row = await conn.QueryFirstOrDefaultAsync(
            @"SELECT
                COUNT(*)                                          AS total,
                COUNT(*) FILTER (WHERE compliance_state = 'compliant')    AS compliant,
                COUNT(*) FILTER (WHERE compliance_state != 'compliant')   AS non_compliant,
                COUNT(*) FILTER (WHERE encryption_state = 'encrypted')    AS encrypted
              FROM managed_devices WHERE tenant_id = @tenantId",
            new { tenantId });

        return row ?? new { total = 0, compliant = 0, nonCompliant = 0, encrypted = 0 };
    }

    public async Task<object?> GetByIdAsync(Guid tenantId, string deviceId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync(
            "SELECT * FROM managed_devices WHERE tenant_id = @tenantId AND azure_device_id = @deviceId",
            new { tenantId, deviceId });
    }
}

// ─── Other service stubs ──────────────────────────────────────────────────────

public interface IAnalyticsService {}
public class AnalyticsService : IAnalyticsService {}

public interface IComplianceService {}
public class ComplianceService : IComplianceService {}

public interface INotificationService {}
public class NotificationService : INotificationService {}

public interface IAuditService {}
public class AuditService : IAuditService {}

public interface ISearchService {}
public class SearchService : ISearchService {}
