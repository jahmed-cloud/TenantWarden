using System.Text.Json;
using Dapper;
using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

/// <summary>
/// Alert rules evaluated by alert-engine every minute. A rule compares one metric with a
/// threshold; threshold_value / window_minutes are the source of truth and the condition
/// column holds { metric, operator, param?, query? }. The metric catalogue lives in alert-engine.
/// </summary>
[ApiController]
[Route("api/v1/alert-rules")]
[Authorize]
public class AlertRulesController : ControllerBase
{
    private static readonly HashSet<string> Operators  = ["gt", "gte", "lt", "lte", "eq", "neq"];
    private static readonly HashSet<string> Severities = ["critical", "high", "medium", "low", "info"];
    private const string Editors = "security_admin,org_admin,super_admin";

    private readonly IDbConnectionFactory _db;
    private readonly IAlertEngineClient _engine;

    public AlertRulesController(IDbConnectionFactory db, IAlertEngineClient engine)
    {
        _db     = db;
        _engine = engine;
    }

    /// <summary>Metrics with their categories, parameters and rule defaults.</summary>
    [HttpGet("metrics")]
    public async Task<IActionResult> MetricCatalogue(CancellationToken ct) =>
        await Engine(async () => Ok((await _engine.GetCatalogueAsync(ct)).GetProperty("metrics")));

    /// <summary>Metrics, ready-made query rules and the query datasets (for the rule library and Query page).</summary>
    [HttpGet("catalogue")]
    public async Task<IActionResult> Catalogue(CancellationToken ct) =>
        await Engine(async () => Ok(await _engine.GetCatalogueAsync(ct)));

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? tenantId)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT id, tenant_id AS ""tenantId"", name, description, severity::text AS severity, source::text AS source,
                     condition->>'metric' AS metric, condition->>'operator' AS operator, threshold_value AS threshold,
                     CASE WHEN condition->>'param' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (condition->>'param')::float8 END AS param,
                     condition->>'query' AS query,
                     window_minutes AS ""windowMinutes"", cooldown_minutes AS ""cooldownMinutes"", is_enabled AS ""isEnabled"",
                     last_triggered_at AS ""lastTriggeredAt"", created_at AS ""createdAt""
              FROM alert_rules WHERE (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              ORDER BY is_enabled DESC, name",
            new { TenantId = scoped });
        return Ok(rows);
    }

    public record RuleRequest(Guid TenantId, string Name, string? Description, string Severity, string Metric,
        string Operator, int Threshold, int WindowMinutes = 60, int CooldownMinutes = 60, bool IsEnabled = true,
        double? Param = null, string? Query = null);

    [HttpPost]
    [Authorize(Roles = Editors)]
    public async Task<IActionResult> Create([FromBody] RuleRequest req, CancellationToken ct) => await Engine(async () =>
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        var (metric, error) = await ValidateAsync(req.Name, req.Severity, req.Metric, req.Operator, req.WindowMinutes,
            req.CooldownMinutes, req.Param, req.Query, ct);
        if (error is not null) return BadRequest(new { error });

        await using var conn = _db.CreateConnection();
        var id = await conn.ExecuteScalarAsync<Guid>(
            @"INSERT INTO alert_rules (tenant_id, name, description, severity, source, condition, threshold_value,
                                       window_minutes, cooldown_minutes, is_enabled)
              VALUES (@TenantId, @Name, @Description, @Severity::alert_severity, @Source::alert_source, @Condition::jsonb,
                      @Threshold, @WindowMinutes, @CooldownMinutes, @IsEnabled)
              RETURNING id",
            new
            {
                req.TenantId, Name = req.Name.Trim(), Description = req.Description ?? "", req.Severity,
                Source = metric!.Source, Condition = ConditionJson(req.Metric, req.Operator, metric.HasParam ? req.Param : null, req.Query),
                req.Threshold, req.WindowMinutes, req.CooldownMinutes, req.IsEnabled,
            });
        return CreatedAtAction(nameof(List), new { tenantId = req.TenantId }, new { id });
    });

    public record RulePatch(string? Name, string? Description, string? Severity, string? Metric, string? Operator,
        int? Threshold, int? WindowMinutes, int? CooldownMinutes, bool? IsEnabled, double? Param, string? Query);

    [HttpPatch("{id:guid}")]
    [Authorize(Roles = Editors)]
    public async Task<IActionResult> Update(Guid id, [FromBody] RulePatch req, CancellationToken ct) => await Engine(async () =>
    {
        await using var conn = _db.CreateConnection();
        var current = await conn.QueryFirstOrDefaultAsync<CurrentRule>(
            @"SELECT tenant_id AS TenantId, name AS Name, severity::text AS Severity, condition->>'metric' AS Metric,
                     condition->>'operator' AS Operator, window_minutes AS WindowMinutes, cooldown_minutes AS CooldownMinutes,
                     CASE WHEN condition->>'param' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (condition->>'param')::float8 END AS Param,
                     condition->>'query' AS Query
              FROM alert_rules WHERE id = @id", new { id });
        if (current is null || !User.CanAccessTenant(current.TenantId)) return NotFound();

        var metricName = req.Metric ?? current.Metric;
        var op         = req.Operator ?? current.Operator;
        var param      = req.Param ?? current.Param;
        var query      = req.Query ?? current.Query;
        var (metric, error) = await ValidateAsync(req.Name ?? current.Name, req.Severity ?? current.Severity, metricName, op,
            req.WindowMinutes ?? current.WindowMinutes, req.CooldownMinutes ?? current.CooldownMinutes, param, query, ct);
        if (error is not null) return BadRequest(new { error });

        await conn.ExecuteAsync(
            @"UPDATE alert_rules SET
                name             = COALESCE(@Name, name),
                description      = COALESCE(@Description, description),
                severity         = COALESCE(@Severity::alert_severity, severity),
                source           = @Source::alert_source,
                condition        = @Condition::jsonb,
                threshold_value  = COALESCE(@Threshold, threshold_value),
                window_minutes   = COALESCE(@WindowMinutes, window_minutes),
                cooldown_minutes = COALESCE(@CooldownMinutes, cooldown_minutes),
                is_enabled       = COALESCE(@IsEnabled, is_enabled),
                updated_at       = NOW()
              WHERE id = @id",
            new
            {
                id, Name = req.Name?.Trim(), req.Description, req.Severity, Source = metric!.Source,
                Condition = ConditionJson(metricName, op, metric.HasParam ? param : null, metricName == "custom_query" ? query : null),
                req.Threshold, req.WindowMinutes, req.CooldownMinutes, req.IsEnabled,
            });
        return NoContent();
    });

    private record CurrentRule(Guid TenantId, string Name, string Severity, string Metric, string Operator,
        int WindowMinutes, int CooldownMinutes, double? Param, string? Query);

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = Editors)]
    public async Task<IActionResult> Delete(Guid id)
    {
        await using var conn = _db.CreateConnection();
        var tenantId = await conn.ExecuteScalarAsync<Guid?>("SELECT tenant_id FROM alert_rules WHERE id = @id", new { id });
        if (tenantId is null || !User.CanAccessTenant(tenantId.Value)) return NotFound();
        await conn.ExecuteAsync("DELETE FROM alert_rules WHERE id = @id", new { id });
        return NoContent();
    }

    private async Task<(MetricInfo? Metric, string? Error)> ValidateAsync(string name, string severity, string metricName, string op,
        int window, int cooldown, double? param, string? query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))  return (null, "Name is required");
        if (!Severities.Contains(severity))   return (null, $"severity must be one of: {string.Join(", ", Severities)}");
        if (!Operators.Contains(op))          return (null, $"operator must be one of: {string.Join(", ", Operators)}");
        if (window is < 1 or > 10080)         return (null, "windowMinutes must be between 1 and 10080");
        if (cooldown is < 1 or > 10080)       return (null, "cooldownMinutes must be between 1 and 10080");
        if (param is < 0 or > 1_000_000_000)  return (null, "param must be between 0 and 1,000,000,000");

        var metric = await _engine.GetMetricAsync(metricName, ct);
        if (metric is null) return (null, $"Unknown metric \"{metricName}\"");
        if (metricName == "custom_query")
        {
            if (string.IsNullOrWhiteSpace(query)) return (metric, "A custom query rule needs a query");
            if (await _engine.ValidateQueryAsync(query, ct) is { } queryError) return (metric, $"Query: {queryError}");
        }
        return (metric, null);
    }

    private static string ConditionJson(string metric, string op, double? param, string? query) =>
        JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["metric"] = metric, ["operator"] = op,
            ["param"] = param, ["query"] = metric == "custom_query" ? query : null,
        }.Where(kv => kv.Value is not null).ToDictionary());

    private async Task<IActionResult> Engine(Func<Task<IActionResult>> action)
    {
        try { return await action(); }
        catch (AlertEngineUnavailableException ex) { return StatusCode(503, new { error = ex.Message }); }
    }
}
