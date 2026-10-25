using Dapper;
using TenantWarden.Api.Infrastructure;

namespace TenantWarden.Api.Services;

// ─── Identity Service ─────────────────────────────────────────────────────────
// Every query aliases its columns to camelCase: rows are returned as dynamic objects
// and serialised as-is, and the frontend reads camelCase.

public interface IIdentityService
{
    Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);
    Task<PagedResult<object>> GetRiskyUsersAsync(Guid tenantId, string? riskLevel, int page, int pageSize, CancellationToken ct = default);
    Task<object> GetMfaStatusAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<object>> GetCaPoliciesAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<object>> GetSignInsAsync(Guid tenantId, string? userId, bool riskyOnly, int hours, CancellationToken ct = default);
    Task<List<object>> GetSignInTrendAsync(Guid tenantId, int days, CancellationToken ct = default);
    Task<List<object>> GetSignInCountriesAsync(Guid tenantId, int days, CancellationToken ct = default);
    Task<string?> GetRiskyUserObjectIdAsync(Guid tenantId, string userId, CancellationToken ct = default);
    Task MarkRiskyUserAsync(Guid tenantId, string azureObjectId, string riskLevel, CancellationToken ct = default);
}

public class IdentityService : IIdentityService
{
    private readonly IDbConnectionFactory _db;

    public IdentityService(IDbConnectionFactory db) => _db = db;

    public async Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var row = await conn.QueryFirstAsync(
            @"SELECT
                (SELECT COALESCE(user_count, 0) FROM tenants WHERE id = @tenantId)                                       AS ""totalUsers"",
                (SELECT COUNT(*)::int FROM risky_users WHERE tenant_id = @tenantId AND NOT COALESCE(is_deleted, FALSE) AND risk_level <> 'none') AS ""riskyUsers"",
                (SELECT COUNT(*)::int FROM risky_users WHERE tenant_id = @tenantId AND NOT COALESCE(is_deleted, FALSE) AND risk_level = 'high')  AS ""riskyHigh"",
                (SELECT COUNT(*)::int FROM risky_users WHERE tenant_id = @tenantId AND NOT COALESCE(is_deleted, FALSE) AND risk_level = 'medium') AS ""riskyMedium"",
                (SELECT COUNT(*)::int FROM ca_policies WHERE tenant_id = @tenantId AND state = 'enabled')               AS ""caPolicies"",
                (SELECT COUNT(*)::int FROM ca_policies WHERE tenant_id = @tenantId)                                     AS ""caPoliciesTotal"",
                (SELECT COUNT(*)::int FROM managed_devices WHERE tenant_id = @tenantId)                                 AS ""deviceCount"",
                (SELECT COUNT(*)::int FROM managed_devices WHERE tenant_id = @tenantId AND compliance_state <> 'compliant') AS ""nonCompliant"",
                (SELECT COUNT(*)::int FROM risky_signins WHERE tenant_id = @tenantId AND occurred_at >= NOW() - INTERVAL '24 hours') AS ""riskySignIns24h"",
                (SELECT ROUND(percentage)::int FROM secure_scores WHERE tenant_id = @tenantId ORDER BY recorded_at DESC LIMIT 1) AS ""secureScore""",
            new { tenantId });

        var mfa = await MfaCoverageAsync(conn, tenantId, "all_users");
        var dict = (IDictionary<string, object?>)row;
        dict["mfaRegistered"] = mfa.Registered;
        dict["mfaTotal"]      = mfa.Total;
        dict["mfaPercent"]    = mfa.Percent;
        return dict;
    }

    public async Task<PagedResult<object>> GetRiskyUsersAsync(
        Guid tenantId, string? riskLevel, int page, int pageSize, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var where = "tenant_id = @tenantId AND NOT COALESCE(is_deleted, FALSE) AND risk_level <> 'none'";
        var p     = new DynamicParameters(new { tenantId });
        if (!string.IsNullOrEmpty(riskLevel))
        {
            where += " AND risk_level = @riskLevel::user_risk_level";
            p.Add("riskLevel", riskLevel.ToLowerInvariant());
        }

        var total = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM risky_users WHERE {where}", p);
        p.Add("Offset", (Math.Max(page, 1) - 1) * pageSize);
        p.Add("Limit",  Math.Clamp(pageSize, 1, 200));

        var rows = await conn.QueryAsync(
            $@"SELECT id, azure_object_id AS ""azureObjectId"", user_principal_name AS ""userPrincipalName"",
                      display_name AS ""displayName"", risk_level::text AS ""riskLevel"", risk_detail AS ""riskDetail"",
                      country_code AS ""countryCode"", host(ip_address) AS ""ipAddress"",
                      risk_last_updated_at AS ""riskLastUpdatedAt"", is_processed AS ""isProcessed""
               FROM risky_users WHERE {where}
               ORDER BY risk_level DESC, risk_last_updated_at DESC NULLS LAST
               OFFSET @Offset LIMIT @Limit", p);

        return new PagedResult<object>(rows.Cast<object>().ToList(), total, Math.Max(page, 1), pageSize);
    }

    public async Task<object> GetMfaStatusAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var all        = await MfaCoverageAsync(conn, tenantId, "all_users");
        var privileged = await MfaCoverageAsync(conn, tenantId, "privileged_users");

        var byCategory = await conn.QueryAsync(
            @"SELECT scope, category, SUM(user_count)::int AS users
              FROM (SELECT DISTINCT ON (scope, method) scope, method, category, user_count
                    FROM auth_method_summary WHERE tenant_id = @tenantId
                    ORDER BY scope, method, captured_at DESC) latest
              GROUP BY scope, category ORDER BY scope, category", new { tenantId });

        return new
        {
            collected  = all.Total > 0,
            allUsers   = new { registered = all.Registered, total = all.Total, percent = all.Percent },
            privileged = new { registered = privileged.Registered, total = privileged.Total, percent = privileged.Percent },
            byCategory,
        };
    }

    // Users with any registered strong-or-phishable method count as MFA-registered.
    private static async Task<(int Registered, int Total, int? Percent)> MfaCoverageAsync(
        Npgsql.NpgsqlConnection conn, Guid tenantId, string scope)
    {
        var r = await conn.QueryFirstAsync<(long total, long registered)>(
            @"SELECT COALESCE(SUM(user_count), 0) AS total,
                     COALESCE(SUM(user_count) FILTER (WHERE category IN ('phish_resistant', 'phishable')), 0) AS registered
              FROM (SELECT DISTINCT ON (method) category, user_count
                    FROM auth_method_summary WHERE tenant_id = @tenantId AND scope = @scope
                    ORDER BY method, captured_at DESC) latest",
            new { tenantId, scope });
        return ((int)r.registered, (int)r.total, r.total > 0 ? (int)Math.Round(100.0 * r.registered / r.total) : null);
    }

    public async Task<List<object>> GetCaPoliciesAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT id, policy_id AS ""policyId"", name, state,
                     (controls::text ILIKE '%mfa%')               AS ""requiresMfa"",
                     (controls::text ILIKE '%compliantDevice%')   AS ""requiresCompliantDevice"",
                     (controls::text ILIKE '%block%')             AS ""blocks"",
                     synced_at AS ""syncedAt""
              FROM ca_policies WHERE tenant_id = @tenantId
              ORDER BY (state = 'enabled') DESC, name", new { tenantId });
        return rows.Cast<object>().ToList();
    }

    public async Task<List<object>> GetSignInsAsync(
        Guid tenantId, string? userId, bool riskyOnly, int hours, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var where = "tenant_id = @tenantId AND occurred_at >= NOW() - make_interval(hours => @hours)";
        var p     = new DynamicParameters(new { tenantId, hours = Math.Clamp(hours, 1, 24 * 90) });
        if (!string.IsNullOrEmpty(userId)) { where += " AND user_principal_name ILIKE @userId"; p.Add("userId", $"%{userId}%"); }
        if (riskyOnly) where += " AND risk_level <> 'none'";

        var rows = await conn.QueryAsync(
            $@"SELECT id, user_principal_name AS ""userPrincipalName"", host(ip_address) AS ""ipAddress"",
                      country_code AS ""countryCode"", city, risk_level::text AS ""riskLevel"", risk_detail AS ""riskDetail"",
                      app_display_name AS ""appDisplayName"", occurred_at AS ""occurredAt""
               FROM risky_signins WHERE {where}
               ORDER BY occurred_at DESC LIMIT 200", p);
        return rows.Cast<object>().ToList();
    }

    public async Task<List<object>> GetSignInTrendAsync(Guid tenantId, int days, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT to_char(d, 'YYYY-MM-DD') AS date,
                     COUNT(s.id) FILTER (WHERE s.risk_level = 'high')::int   AS high,
                     COUNT(s.id) FILTER (WHERE s.risk_level = 'medium')::int AS medium,
                     COUNT(s.id) FILTER (WHERE s.risk_level = 'low')::int    AS low,
                     COUNT(s.id)::int                                        AS total
              FROM generate_series(date_trunc('day', NOW()) - make_interval(days => @days - 1), date_trunc('day', NOW()), INTERVAL '1 day') d
              LEFT JOIN risky_signins s
                     ON s.tenant_id = @tenantId AND s.occurred_at >= d AND s.occurred_at < d + INTERVAL '1 day'
              GROUP BY d ORDER BY d",
            new { tenantId, days = Math.Clamp(days, 1, 180) });
        return rows.Cast<object>().ToList();
    }

    public async Task<List<object>> GetSignInCountriesAsync(Guid tenantId, int days, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT COALESCE(NULLIF(TRIM(country_code), ''), '??') AS country,
                     COUNT(*)::int                                     AS total,
                     COUNT(*) FILTER (WHERE risk_level = 'high')::int  AS high,
                     COUNT(DISTINCT user_principal_name)::int          AS users
              FROM risky_signins
              WHERE tenant_id = @tenantId AND occurred_at >= NOW() - make_interval(days => @days)
              GROUP BY 1 ORDER BY total DESC LIMIT 10",
            new { tenantId, days = Math.Clamp(days, 1, 180) });
        return rows.Cast<object>().ToList();
    }

    /// <summary>Resolves a risky-user row id or Azure object id to the Azure object id Graph needs.</summary>
    public async Task<string?> GetRiskyUserObjectIdAsync(Guid tenantId, string userId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.ExecuteScalarAsync<string?>(
            @"SELECT azure_object_id FROM risky_users
              WHERE tenant_id = @tenantId AND (azure_object_id = @userId OR id::text = @userId) LIMIT 1",
            new { tenantId, userId });
    }

    public async Task MarkRiskyUserAsync(Guid tenantId, string azureObjectId, string riskLevel, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE risky_users SET risk_level = @riskLevel::user_risk_level, is_processed = TRUE, updated_at = NOW()
              WHERE azure_object_id = @azureObjectId AND tenant_id = @tenantId",
            new { azureObjectId, tenantId, riskLevel });
    }
}

// ─── Device Service ───────────────────────────────────────────────────────────

public interface IDeviceService
{
    Task<PagedResult<object>> ListAsync(Guid tenantId, int page, int pageSize, string? search, string? compliance, CancellationToken ct = default);
    Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);
    Task<object?> GetByIdAsync(Guid tenantId, string deviceId, CancellationToken ct = default);
}

public class DeviceService : IDeviceService
{
    private const string Columns =
        @"id, azure_device_id AS ""azureDeviceId"", device_name AS ""deviceName"", operating_system AS ""operatingSystem"",
          os_version AS ""osVersion"", compliance_state AS ""complianceState"", user_principal_name AS ""userPrincipalName"",
          encryption_state AS ""encryptionState"", owner_type AS ""ownerType"",
          last_sync_datetime AS ""lastSyncDateTime"", synced_at AS ""syncedAt""";

    private readonly IDbConnectionFactory _db;

    public DeviceService(IDbConnectionFactory db) => _db = db;

    public async Task<PagedResult<object>> ListAsync(Guid tenantId, int page, int pageSize, string? search, string? compliance, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var where = "tenant_id = @tenantId";
        var p     = new DynamicParameters(new { tenantId });
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND (device_name ILIKE @search OR user_principal_name ILIKE @search OR operating_system ILIKE @search)";
            p.Add("search", $"%{search.Trim()}%");
        }
        if (compliance == "compliant")     where += " AND compliance_state = 'compliant'";
        if (compliance == "noncompliant")  where += " AND compliance_state <> 'compliant'";

        var total = await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM managed_devices WHERE {where}", p);
        p.Add("Offset", (Math.Max(page, 1) - 1) * pageSize);
        p.Add("Limit",  Math.Clamp(pageSize, 1, 200));

        var rows = await conn.QueryAsync(
            $@"SELECT {Columns} FROM managed_devices WHERE {where}
               ORDER BY (compliance_state = 'compliant'), device_name
               OFFSET @Offset LIMIT @Limit", p);

        return new PagedResult<object>(rows.Cast<object>().ToList(), total, Math.Max(page, 1), pageSize);
    }

    public async Task<object> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstAsync(
            @"SELECT
                COUNT(*)::int                                                AS total,
                COUNT(*) FILTER (WHERE compliance_state = 'compliant')::int  AS compliant,
                COUNT(*) FILTER (WHERE compliance_state <> 'compliant')::int AS ""nonCompliant"",
                COUNT(*) FILTER (WHERE encryption_state = 'encrypted')::int  AS encrypted
              FROM managed_devices WHERE tenant_id = @tenantId",
            new { tenantId });
    }

    public async Task<object?> GetByIdAsync(Guid tenantId, string deviceId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync(
            $"SELECT {Columns} FROM managed_devices WHERE tenant_id = @tenantId AND azure_device_id = @deviceId",
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


public interface ISearchService {}
public class SearchService : ISearchService {}
