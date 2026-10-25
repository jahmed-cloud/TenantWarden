using TenantWarden.Api.Controllers;
using TenantWarden.Api.Hubs;
using Dapper;
using TenantWarden.Api.Models;
using TenantWarden.Api.Infrastructure;
using StackExchange.Redis;
using System.Text.Json;

namespace TenantWarden.Api.Services;

public interface IAlertService
{
    Task<PagedResult<Alert>> ListAsync(AlertQuery q, CancellationToken ct = default);
    Task<Alert?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Alert> CreateAsync(CreateAlertRequest req, CancellationToken ct = default);
    Task AcknowledgeAsync(Guid id, string userId, string? comment, CancellationToken ct = default);
    Task ResolveAsync(Guid id, string userId, string resolution, CancellationToken ct = default);
    Task AssignAsync(Guid id, string assigneeId, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<AlertCounts> GetCountsAsync(Guid? tenantId, CancellationToken ct = default);
    Task<List<Alert>> GetRecentAsync(Guid tenantId, int limit = 10, CancellationToken ct = default);
    Task<List<object>> GetTrendAsync(Guid? tenantId, int days, CancellationToken ct = default);
}

public class AlertService : IAlertService
{
    // notification-service subscribes to this channel and dispatches to the tenant's channels
    public static readonly RedisChannel NotificationChannel = RedisChannel.Literal("tenantwarden:alerts");

    private readonly IDbConnectionFactory _db;
    private readonly ITenantWardenHubPublisher _hub;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<AlertService> _log;

    public AlertService(IDbConnectionFactory db, ITenantWardenHubPublisher hub, IConnectionMultiplexer redis, ILogger<AlertService> log)
    {
        _db    = db;
        _hub   = hub;
        _redis = redis;
        _log   = log;
    }

    public async Task<PagedResult<Alert>> ListAsync(AlertQuery q, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var where  = new List<string> { "1=1" };
        var p      = new DynamicParameters();

        if (q.TenantId.HasValue) { where.Add("tenant_id = @TenantId"); p.Add("TenantId", q.TenantId.Value); }
        if (q.Severity.HasValue) { where.Add("severity = @Severity::alert_severity"); p.Add("Severity", q.Severity.Value.ToPg()); }
        if (q.Status.HasValue)   { where.Add("status = @Status::alert_status");       p.Add("Status",   q.Status.Value.ToPg()); }
        if (q.Source.HasValue)   { where.Add("source = @Source::alert_source");       p.Add("Source",   q.Source.Value.ToPg()); }
        if (!string.IsNullOrEmpty(q.Search)) { where.Add("title ILIKE @Search"); p.Add("Search", $"%{q.Search}%"); }

        var whereClause = string.Join(" AND ", where);
        p.Add("Offset", (q.Page - 1) * q.PageSize);
        p.Add("Limit",  q.PageSize);

        var countSql = $"SELECT COUNT(*) FROM alerts WHERE {whereClause}";
        var dataSql  = $@"SELECT * FROM alerts WHERE {whereClause}
                          ORDER BY created_at DESC OFFSET @Offset LIMIT @Limit";

        var total = await conn.ExecuteScalarAsync<int>(countSql, p);
        var items = (await conn.QueryAsync<Alert>(dataSql, p)).ToList();

        return new PagedResult<Alert>(items, total, q.Page, q.PageSize);
    }

    public async Task<Alert?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Alert>("SELECT * FROM alerts WHERE id = @id", new { id });
    }

    public async Task<Alert> CreateAsync(CreateAlertRequest req, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var alert = await conn.QueryFirstAsync<Alert>(
            @"INSERT INTO alerts
                (tenant_id, title, description, severity, status, source, category,
                 affected_users, affected_devices, metadata, external_id)
              VALUES
                (@TenantId, @Title, @Description, @Severity::alert_severity, 'active',
                 @Source::alert_source, @Category, @AffectedUsers, @AffectedDevices, @Metadata::jsonb, @ExternalId)
              RETURNING *",
            new
            {
                req.TenantId, req.Title, req.Description,
                Severity        = req.Severity.ToPg(),
                Source          = req.Source.ToPg(),
                req.Category,
                AffectedUsers   = req.AffectedUsers?.ToArray() ?? [],
                AffectedDevices = req.AffectedDevices?.ToArray() ?? [],
                Metadata        = req.Metadata,
                req.ExternalId,
            });

        // Push live via SignalR
        await _hub.PublishAlert(req.TenantId.ToString(), alert);
        await PublishNotificationAsync(alert);

        _log.LogInformation("Alert created {AlertId} severity:{Severity}", alert.Id, alert.Severity);
        return alert;
    }

    /// <summary>Hands the alert to notification-service (Teams, Slack, email, …) via Redis.</summary>
    private async Task PublishNotificationAsync(Alert alert)
    {
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                tenantId = alert.TenantId,
                alert = new
                {
                    id = alert.Id, tenantId = alert.TenantId, title = alert.Title, description = alert.Description,
                    severity = alert.Severity.ToPg(), status = alert.Status.ToPg(), source = alert.Source.ToPg(),
                    category = alert.Category, affectedUsers = alert.AffectedUsers,
                    recommendedAction = alert.RecommendedAction, createdAt = alert.CreatedAt,
                },
            });
            await _redis.GetSubscriber().PublishAsync(NotificationChannel, payload);
        }
        catch (RedisException ex)
        {
            _log.LogWarning(ex, "Could not queue notifications for alert {AlertId}", alert.Id);
        }
    }

    public async Task AcknowledgeAsync(Guid id, string userId, string? comment, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE alerts SET
                status = 'acknowledged',
                assigned_to = COALESCE(NULLIF(assigned_to, ''), @userId),
                acknowledged_at = NOW(),
                metadata = CASE WHEN @comment IS NULL THEN metadata
                                ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('ackComment', @comment, 'ackBy', @userId) END,
                updated_at = NOW()
              WHERE id = @id AND status = 'active'",
            new { id, userId, comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim() });
    }

    public async Task ResolveAsync(Guid id, string userId, string resolution, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE alerts SET
                status = 'resolved',
                resolution = @resolution,
                assigned_to = COALESCE(NULLIF(assigned_to, ''), @userId),
                resolved_at = NOW(),
                updated_at = NOW()
              WHERE id = @id",
            new { id, resolution, userId });
    }

    public async Task AssignAsync(Guid id, string assigneeId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE alerts SET assigned_to = @assigneeId, updated_at = NOW() WHERE id = @id",
            new { id, assigneeId });
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM alerts WHERE id = @id", new { id });
    }

    public async Task<AlertCounts> GetCountsAsync(Guid? tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var where = tenantId.HasValue ? "WHERE tenant_id = @tenantId AND status = 'active'" : "WHERE status = 'active'";
        var rows  = await conn.QueryAsync<(string severity, int count)>(
            $"SELECT severity::text, COUNT(*)::int FROM alerts {where} GROUP BY severity",
            tenantId.HasValue ? new { tenantId } : null);

        var dict = rows.ToDictionary(r => r.severity, r => r.count);
        return new AlertCounts(
            dict.GetValueOrDefault("critical"),
            dict.GetValueOrDefault("high"),
            dict.GetValueOrDefault("medium"),
            dict.GetValueOrDefault("low"));
    }

    public async Task<List<Alert>> GetRecentAsync(Guid tenantId, int limit = 10, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var items = await conn.QueryAsync<Alert>(
            "SELECT * FROM alerts WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT @limit",
            new { tenantId, limit });
        return items.ToList();
    }

    /// <summary>Alerts raised per day, split by severity (zero-filled).</summary>
    public async Task<List<object>> GetTrendAsync(Guid? tenantId, int days, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT to_char(d, 'YYYY-MM-DD') AS date,
                     COUNT(a.id) FILTER (WHERE a.severity = 'critical')::int AS critical,
                     COUNT(a.id) FILTER (WHERE a.severity = 'high')::int     AS high,
                     COUNT(a.id) FILTER (WHERE a.severity = 'medium')::int   AS medium,
                     COUNT(a.id) FILTER (WHERE a.severity IN ('low', 'info'))::int AS low,
                     COUNT(a.id) FILTER (WHERE a.status = 'resolved')::int   AS resolved
              FROM generate_series(date_trunc('day', NOW()) - make_interval(days => @days - 1), date_trunc('day', NOW()), INTERVAL '1 day') d
              LEFT JOIN alerts a
                     ON (@tenantId::uuid IS NULL OR a.tenant_id = @tenantId)
                    AND a.created_at >= d AND a.created_at < d + INTERVAL '1 day'
              GROUP BY d ORDER BY d",
            new { tenantId, days = Math.Clamp(days, 1, 180) });
        return rows.Cast<object>().ToList();
    }
}

public record AlertCounts(int Critical, int High, int Medium, int Low);
public record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => (int)Math.Ceiling(Total / (double)PageSize);
    public bool HasNext   => Page < TotalPages;
    public bool HasPrev   => Page > 1;
}
