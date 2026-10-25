using System.Net;
using System.Text.Json;
using Dapper;
using StackExchange.Redis;
using TenantWarden.Api.Controllers;
using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Models;

namespace TenantWarden.Api.Services;

/// <summary>
/// Turns agent messages into dashboard data. The agent gateway authenticates each agent,
/// stamps the verified agent_id / tenant_id onto every message and publishes it on
/// tenantwarden:agent_{registration|metrics|events|inventory}. This consumer:
///   registration → upserts the agents row
///   metrics      → updates live CPU/memory/disk and appends to ClickHouse agent_metrics
///   events       → stores warnings/errors in agent_events; critical ones raise an alert
///   inventory    → stores the latest services/updates/BitLocker/workloads snapshot on the agent
///   checks       → latest endpoint-check result per agent and check, plus history
/// It also copies every tenant's monitoring profile to Redis at start, where the gateway reads it.
/// </summary>
public class AgentTelemetryConsumer : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly IDbConnectionFactory _db;
    private readonly IClickHouseService _clickHouse;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<AgentTelemetryConsumer> _log;

    public AgentTelemetryConsumer(IConnectionMultiplexer redis, IDbConnectionFactory db, IClickHouseService clickHouse,
        IServiceScopeFactory scopes, ILogger<AgentTelemetryConsumer> log)
    {
        _redis      = redis;
        _db         = db;
        _clickHouse = clickHouse;
        _scopes     = scopes;
        _log        = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await SyncProfilesAsync();

        // One ordered queue: messages from an agent are applied in the order they arrive
        var queue = await _redis.GetSubscriber().SubscribeAsync(RedisChannel.Pattern("tenantwarden:agent_*"));
        _log.LogInformation("Agent telemetry consumer listening on tenantwarden:agent_*");

        while (!stoppingToken.IsCancellationRequested)
        {
            ChannelMessage message;
            try { message = await queue.ReadAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }

            try { await HandleAsync(message.Channel.ToString(), message.Message.ToString(), stoppingToken); }
            catch (Exception ex) { _log.LogWarning(ex, "Agent message on {Channel} could not be processed", message.Channel); }
        }
    }

    /// <summary>Redis may have been flushed or restarted; the database is the source of truth.</summary>
    private async Task SyncProfilesAsync()
    {
        try
        {
            await using var conn = _db.CreateConnection();
            var redis = _redis.GetDatabase();
            foreach (var (tenantId, profile) in await conn.QueryAsync<(Guid, string)>("SELECT tenant_id, profile::text FROM agent_profiles"))
                await redis.StringSetAsync(AgentProfileController.ProfileKey(tenantId), profile);
        }
        catch (Exception ex) { _log.LogWarning("Monitoring profiles not synced to Redis: {Error}", ex.Message); }
    }

    private async Task HandleAsync(string channel, string json, CancellationToken ct)
    {
        if (channel == "tenantwarden:agent_profile") return; // published by the API for the gateway
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!Guid.TryParse(Str(root, "agent_id"), out var agentId) || !Guid.TryParse(Str(root, "tenant_id"), out var tenantId))
            return;
        var payload = root.TryGetProperty("payload", out var p) ? p : default;

        switch (channel)
        {
            case "tenantwarden:agent_registration": await RegisterAsync(tenantId, agentId, payload); break;
            case "tenantwarden:agent_metrics":      await MetricsAsync(tenantId, agentId, payload, ct); break;
            case "tenantwarden:agent_events":       await EventsAsync(tenantId, agentId, payload, ct); break;
            case "tenantwarden:agent_inventory":    await InventoryAsync(tenantId, agentId, payload); break;
            case "tenantwarden:agent_checks":       await ChecksAsync(tenantId, agentId, payload); break;
        }
    }

    private async Task RegisterAsync(Guid tenantId, Guid agentId, JsonElement p)
    {
        await UpsertAgentAsync(tenantId, agentId,
            hostname: Str(p, "hostname") ?? "unknown",
            platform: Str(p, "platform"),
            version:  Str(p, "version") ?? "dev",
            osName:   Str(p, "os_name"),
            osVersion: Str(p, "os_version"),
            arch:     Str(p, "architecture"),
            ip:       Str(p, "ip_address"));

        // Tags from the agent's config (agent.tags) let monitoring-profile items target groups of hosts
        if (p.TryGetProperty("tags", out var tags) && tags.ValueKind == JsonValueKind.Array)
        {
            var list = tags.EnumerateArray().Where(t => t.ValueKind == JsonValueKind.String).Select(t => t.GetString()!.Trim())
                           .Where(t => t.Length is > 0 and <= 50).Take(20).ToArray();
            await using var conn = _db.CreateConnection();
            await conn.ExecuteAsync("UPDATE agents SET tags = @list WHERE agent_id = @agentId AND tenant_id = @tenantId", new { list, agentId, tenantId });
        }
        _log.LogInformation("Agent {AgentId} registered for tenant {TenantId}", agentId, tenantId);
    }

    private async Task MetricsAsync(Guid tenantId, Guid agentId, JsonElement p, CancellationToken ct)
    {
        var hostname = Str(p, "hostname") ?? "unknown";
        var cpu      = Num(p, "cpu", "usage_percent");
        var mem      = Num(p, "memory", "usage_percent");
        var disk     = p.TryGetProperty("disks", out var disks) && disks.ValueKind == JsonValueKind.Array && disks.GetArrayLength() > 0
            ? disks.EnumerateArray().Max(d => Num(d, "usage_percent"))
            : 0;
        // Throughput (bytes/s since the previous sample) as computed by the agent; null on its first sample
        var hasRates = p.TryGetProperty("network_rates", out var rates) && rates.ValueKind == JsonValueKind.Object;
        long? rx = hasRates ? (long)Num(rates, "rx_bps") : null;
        long? tx = hasRates ? (long)Num(rates, "tx_bps") : null;
        var connections = p.TryGetProperty("connections", out var conns) && conns.ValueKind == JsonValueKind.Object ? conns.GetRawText() : null;
        var uptime   = (long)Num(p, "uptime_seconds");
        var platform = Str(p, "platform");

        // Make sure the agent exists even if its registration message was missed
        await UpsertAgentAsync(tenantId, agentId, hostname, platform, version: null,
            osName: Str(p, "os"), osVersion: Str(p, "os_version"), arch: Str(p, "kernel_arch"), ip: null, fromRegistration: false);

        await using (var conn = _db.CreateConnection())
        {
            await conn.ExecuteAsync(
                @"UPDATE agents SET cpu_percent = @cpu, memory_percent = @mem, disk_percent = @disk, uptime_seconds = @uptime,
                         net_rx_bps = COALESCE(@rx, net_rx_bps), net_tx_bps = COALESCE(@tx, net_tx_bps),
                         connections = COALESCE(@connections::jsonb, connections),
                         last_heartbeat_at = NOW(), last_seen_at = NOW(), status = 'online', updated_at = NOW()
                  WHERE agent_id = @agentId AND tenant_id = @tenantId",
                new { cpu, mem, disk, uptime, rx, tx, connections, agentId, tenantId });
        }

        try
        {
            await _clickHouse.InsertAsync("agent_metrics", [new
            {
                tenant_id = tenantId, agent_id = agentId, hostname, platform = NormalisePlatform(platform),
                collected_at = DateTime.UtcNow, cpu_percent = cpu, mem_percent = mem, disk_percent = disk,
                bytes_sent = 0, bytes_recv = 0, rx_bps = rx ?? 0, tx_bps = tx ?? 0, extra = connections ?? "",
            }], ct);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning("Agent metrics history not stored (ClickHouse): {Error}", ex.Message);
        }
    }

    private async Task EventsAsync(Guid tenantId, Guid agentId, JsonElement p, CancellationToken ct)
    {
        var events = p.TryGetProperty("events", out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().ToList()
            : [p];

        await using var conn = _db.CreateConnection();
        var hostname = await conn.ExecuteScalarAsync<string?>(
            "SELECT hostname FROM agents WHERE agent_id = @agentId AND tenant_id = @tenantId", new { agentId, tenantId }) ?? "unknown";

        foreach (var e in events.Take(200))
        {
            var level   = (Str(e, "level") ?? "warning").ToLowerInvariant();
            var source  = Str(e, "source") ?? "agent";
            var message = Str(e, "message") ?? "";
            if (message.Length == 0) continue;
            var occurred = DateTime.TryParse(Str(e, "occurred_at"), out var t) ? t.ToUniversalTime() : DateTime.UtcNow;

            await conn.ExecuteAsync(
                @"INSERT INTO agent_events (tenant_id, agent_id, hostname, level, source, message, occurred_at)
                  VALUES (@tenantId, @agentId, @hostname, @level, @source, @message, @occurred)",
                new { tenantId, agentId, hostname, level, source, message = Truncate(message, 2000), occurred });

            if (level == "critical")
                await RaiseAlertAsync(tenantId, agentId, hostname, source, message, ct);
        }
    }

    /// <summary>Endpoint check results: keep the latest per agent and check, and a history row.</summary>
    private async Task ChecksAsync(Guid tenantId, Guid agentId, JsonElement p)
    {
        if (!p.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array) return;
        await using var conn = _db.CreateConnection();
        var hostname = await conn.ExecuteScalarAsync<string?>(
            "SELECT hostname FROM agents WHERE agent_id = @agentId AND tenant_id = @tenantId", new { agentId, tenantId }) ?? "unknown";

        foreach (var r in results.EnumerateArray().Take(100))
        {
            var name = Str(r, "name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            var ok = r.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
            var at = DateTime.TryParse(Str(r, "checked_at"), out var t) ? t.ToUniversalTime() : DateTime.UtcNow;
            int? Int(string key) => r.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? (int)v.GetDouble() : null;
            var row = new
            {
                tenantId, agentId, hostname, name = Truncate(name, 60), type = Truncate(Str(r, "type") ?? "tcp", 10),
                target = Truncate(Str(r, "target") ?? "", 400), ok, latency = Int("latency_ms"), status = Int("status_code"),
                error = Str(r, "error") is { } e ? Truncate(e, 500) : null, certDays = Int("cert_days_left"), at,
            };
            await conn.ExecuteAsync(
                @"INSERT INTO endpoint_checks (tenant_id, agent_id, hostname, name, type, target, ok, latency_ms, status_code, error,
                                               cert_days_left, checked_at, failing_since)
                  VALUES (@tenantId, @agentId, @hostname, @name, @type, @target, @ok, @latency, @status, @error, @certDays, @at,
                          CASE WHEN @ok THEN NULL ELSE @at END)
                  ON CONFLICT (tenant_id, agent_id, name) DO UPDATE SET
                    hostname = EXCLUDED.hostname, type = EXCLUDED.type, target = EXCLUDED.target, ok = EXCLUDED.ok,
                    latency_ms = EXCLUDED.latency_ms, status_code = EXCLUDED.status_code, error = EXCLUDED.error,
                    cert_days_left = EXCLUDED.cert_days_left, checked_at = EXCLUDED.checked_at,
                    failing_since = CASE WHEN EXCLUDED.ok THEN NULL ELSE COALESCE(endpoint_checks.failing_since, EXCLUDED.checked_at) END;
                  INSERT INTO endpoint_check_results (tenant_id, agent_id, name, ok, latency_ms, checked_at)
                  VALUES (@tenantId, @agentId, @name, @ok, @latency, @at);",
                row);
        }
    }

    private async Task InventoryAsync(Guid tenantId, Guid agentId, JsonElement p)
    {
        if (p.ValueKind != JsonValueKind.Object) return;
        await using var conn = _db.CreateConnection();
        // Discovery (workloads, certificates) arrives every few minutes as a partial update that is
        // merged in; the full inventory every few hours replaces everything.
        if (p.TryGetProperty("_partial", out var partial) && partial.ValueKind == JsonValueKind.True)
            await conn.ExecuteAsync(
                @"UPDATE agents SET inventory = COALESCE(inventory, '{}'::jsonb) || (@json::jsonb - '_partial')
                  WHERE agent_id = @agentId AND tenant_id = @tenantId",
                new { json = p.GetRawText(), agentId, tenantId });
        else
            await conn.ExecuteAsync(
                "UPDATE agents SET inventory = @json::jsonb, inventory_at = NOW() WHERE agent_id = @agentId AND tenant_id = @tenantId",
                new { json = p.GetRawText(), agentId, tenantId });
    }

    /// <summary>One open alert per agent + event source; it re-arms once the alert is resolved.</summary>
    private async Task RaiseAlertAsync(Guid tenantId, Guid agentId, string hostname, string source, string message, CancellationToken ct)
    {
        var externalId = $"agent-event:{agentId}:{source}";
        await using (var conn = _db.CreateConnection())
        {
            var open = await conn.ExecuteScalarAsync<bool>(
                @"SELECT EXISTS (SELECT 1 FROM alerts WHERE tenant_id = @tenantId AND external_id = @externalId
                                 AND status IN ('active', 'acknowledged', 'investigating'))",
                new { tenantId, externalId });
            if (open) return;
        }

        using var scope = _scopes.CreateScope();
        var alerts = scope.ServiceProvider.GetRequiredService<IAlertService>();
        await alerts.CreateAsync(new CreateAlertRequest(
            tenantId, $"Critical event on {hostname}", Truncate(message, 1000), AlertSeverity.High, AlertSource.Agent,
            "endpoint", AffectedDevices: [hostname], ExternalId: externalId), ct);
    }

    private async Task UpsertAgentAsync(Guid tenantId, Guid agentId, string hostname, string? platform, string? version,
        string? osName, string? osVersion, string? arch, string? ip, bool fromRegistration = true)
    {
        // Registration carries the descriptive OS details; metrics only fill gaps
        // (otherwise "Microsoft Windows 11 Pro" would flip to "windows" every minute)
        await using var conn = _db.CreateConnection();
        // The WHERE keeps an agent id bound to the tenant it first registered with
        await conn.ExecuteAsync(
            @"INSERT INTO agents (tenant_id, agent_id, hostname, platform, version, os_name, os_version, architecture,
                                  ip_address, status, last_seen_at, last_heartbeat_at)
              VALUES (@tenantId, @agentId, @hostname, @platform::agent_platform, COALESCE(@version, 'unknown'), @osName,
                      @osVersion, @arch, @ip::inet, 'online', NOW(), NOW())
              ON CONFLICT (agent_id) DO UPDATE SET
                hostname     = EXCLUDED.hostname,
                platform     = EXCLUDED.platform,
                version      = COALESCE(@version, agents.version),
                os_name      = CASE WHEN @fromRegistration THEN COALESCE(EXCLUDED.os_name, agents.os_name) ELSE COALESCE(agents.os_name, EXCLUDED.os_name) END,
                os_version   = CASE WHEN @fromRegistration THEN COALESCE(EXCLUDED.os_version, agents.os_version) ELSE COALESCE(agents.os_version, EXCLUDED.os_version) END,
                architecture = CASE WHEN @fromRegistration THEN COALESCE(EXCLUDED.architecture, agents.architecture) ELSE COALESCE(agents.architecture, EXCLUDED.architecture) END,
                ip_address   = COALESCE(EXCLUDED.ip_address, agents.ip_address),
                last_seen_at = NOW(),
                updated_at   = NOW()
              WHERE agents.tenant_id = EXCLUDED.tenant_id",
            new
            {
                tenantId, agentId, hostname, platform = NormalisePlatform(platform), version, osName, osVersion, arch, fromRegistration,
                ip = IPAddress.TryParse(ip, out _) ? ip : null,
            });
    }

    // Go reports runtime.GOOS; the agent_platform enum uses product names
    private static string NormalisePlatform(string? goos) => goos?.ToLowerInvariant() switch
    {
        "windows" => "windows",
        "darwin" or "macos" => "macos",
        "docker" => "docker",
        _ => "linux",
    };

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double Num(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    private static double Num(JsonElement e, string obj, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(obj, out var o) ? Num(o, name) : 0;

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
