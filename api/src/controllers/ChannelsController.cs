using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StackExchange.Redis;

namespace TenantWarden.Api.Controllers;

[ApiController]
[Route("api/v1/channels")]
[Authorize(Policy = "AdminOnly")]
public class ChannelsController : ControllerBase
{
    private readonly IDbConnectionFactory _db;
    private readonly IConnectionMultiplexer _redis;
    public ChannelsController(IDbConnectionFactory db, IConnectionMultiplexer redis)
    { _db = db; _redis = redis; }

    // Config keys safe to echo back; everything else (webhook URLs, bot tokens,
    // routing keys, signing secrets) is masked in responses.
    private static readonly HashSet<string> VisibleConfigKeys = new(StringComparer.OrdinalIgnoreCase)
        { "channelId", "method", "recipients" };

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? tenantId)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();

        await using var conn = _db.CreateConnection();
        var rows = (await conn.QueryAsync(
            @"SELECT id, tenant_id AS ""tenantId"", name, type, config::text AS config, is_enabled AS ""isEnabled"",
                     min_severity AS ""minSeverity"", created_at AS ""createdAt""
              FROM notification_channels
              WHERE (@TenantId::uuid IS NULL OR tenant_id = @TenantId)
              ORDER BY created_at DESC", new { TenantId = scoped }))
            .Cast<IDictionary<string, object>>()
            .ToList();

        foreach (var row in rows)
            row["config"] = MaskConfig(row["config"] as string);
        return Ok(rows);
    }

    public record CreateChannelRequest(Guid TenantId, string Name, string Type,
        JsonElement Config, string MinSeverity = "medium");

    [HttpPost]
    [Authorize(Roles = "super_admin,org_admin")]
    public async Task<IActionResult> Create([FromBody] CreateChannelRequest req)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();

        var allowed = new[] { "email", "teams", "slack", "webhook", "pagerduty", "servicenow", "jira" };
        if (!allowed.Contains(req.Type)) return BadRequest(new { error = $"type must be one of: {string.Join(", ", allowed)}" });

        await using var conn = _db.CreateConnection();
        var id = await conn.ExecuteScalarAsync<Guid>(
            @"INSERT INTO notification_channels (tenant_id, name, type, config, min_severity)
              VALUES (@TenantId, @Name, @Type, @Config::jsonb, @MinSeverity::alert_severity)
              RETURNING id",
            new { req.TenantId, req.Name, req.Type, Config = req.Config.GetRawText(), req.MinSeverity });
        return CreatedAtAction(nameof(List), new { id }, new { id });
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "super_admin,org_admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await using var conn = _db.CreateConnection();
        var tenantId = await conn.ExecuteScalarAsync<Guid?>(
            "SELECT tenant_id FROM notification_channels WHERE id = @id", new { id });
        if (tenantId is null || !User.CanAccessTenant(tenantId.Value)) return NotFound();

        await conn.ExecuteAsync("DELETE FROM notification_channels WHERE id = @id", new { id });
        return NoContent();
    }

    /// <summary>Fires a synthetic alert through the real notification pipeline.</summary>
    [HttpPost("{id:guid}/test")]
    public async Task<IActionResult> Test(Guid id)
    {
        await using var conn = _db.CreateConnection();
        var ch = await conn.QueryFirstOrDefaultAsync(
            @"SELECT tenant_id AS ""TenantId"", min_severity AS ""MinSeverity"" FROM notification_channels WHERE id = @id", new { id });
        if (ch is null || !User.CanAccessTenant((Guid)ch.TenantId)) return NotFound();

        var payload = JsonSerializer.Serialize(new
        {
            alert = new
            {
                id = Guid.NewGuid(),
                title = "TenantWarden test notification",
                description = "This is a test alert fired from the Admin page. Your channel is working.",
                severity = (string)ch.MinSeverity,
                category = "test",
            },
            tenantId = (Guid)ch.TenantId,
        });
        await _redis.GetSubscriber().PublishAsync(RedisChannel.Literal("tenantwarden:alerts"), payload);
        return Accepted(new { status = "test alert published" });
    }

    private static string MaskConfig(string? json)
    {
        try
        {
            if (json is null || JsonNode.Parse(json) is not JsonObject config) return "{}";
            foreach (var key in config.Select(p => p.Key).ToList())
                if (!VisibleConfigKeys.Contains(key)) config[key] = "********";
            return config.ToJsonString();
        }
        catch (JsonException) { return "{}"; }
    }
}
