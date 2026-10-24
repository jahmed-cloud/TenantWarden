using TenantWarden.Api.Controllers;
using TenantWarden.Api.Hubs;
using Dapper;
using TenantWarden.Api.Models;
using TenantWarden.Api.Infrastructure;

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
}

public class AlertService : IAlertService
{
    private readonly IDbConnectionFactory _db;
    private readonly ITenantWardenHubPublisher _hub;
    private readonly ILogger<AlertService> _log;

    public AlertService(IDbConnectionFactory db, ITenantWardenHubPublisher hub, ILogger<AlertService> log)
    {
        _db  = db;
        _hub = hub;
        _log = log;
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
                 affected_users, affected_devices, metadata)
              VALUES
                (@TenantId, @Title, @Description, @Severity::alert_severity, 'active',
                 @Source::alert_source, @Category, @AffectedUsers, @AffectedDevices, @Metadata::jsonb)
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
            });

        // Push live via SignalR
        await _hub.PublishAlert(req.TenantId.ToString(), alert);

        _log.LogInformation("Alert created {AlertId} severity:{Severity}", alert.Id, alert.Severity);
        return alert;
    }

    public async Task AcknowledgeAsync(Guid id, string userId, string? comment, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE alerts SET
                status = 'acknowledged',
                assigned_to = @userId,
                acknowledged_at = NOW(),
                updated_at = NOW()
              WHERE id = @id AND status = 'active'",
            new { id, userId });
    }

    public async Task ResolveAsync(Guid id, string userId, string resolution, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE alerts SET
                status = 'resolved',
                resolution = @resolution,
                resolved_at = NOW(),
                updated_at = NOW()
              WHERE id = @id",
            new { id, resolution });
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
}

public record AlertCounts(int Critical, int High, int Medium, int Low);
public record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => (int)Math.Ceiling(Total / (double)PageSize);
    public bool HasNext   => Page < TotalPages;
    public bool HasPrev   => Page > 1;
}
