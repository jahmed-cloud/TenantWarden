using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StackExchange.Redis;
using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Services;

namespace TenantWarden.Api.Controllers;

// ─── Query (KQL-style, run by alert-engine) ──────────────────────────────────

[ApiController]
[Route("api/v1/query")]
[Authorize]
public class QueryController : ControllerBase
{
    private static readonly Regex AuditDataset = new(@"^\s*auditlog\b", RegexOptions.IgnoreCase);
    private static readonly string[] AuditRoles = ["super_admin", "org_admin", "auditor"];
    private readonly IAlertEngineClient _engine;

    public QueryController(IAlertEngineClient engine) => _engine = engine;

    /// <param name="Agents">Machine scope: comma-separated agent ids; narrows the agent datasets only</param>
    public record QueryRequest(Guid TenantId, string Query, int? WindowMinutes, int? Limit, string? Agents);

    /// <summary>Runs a read-only query against one tenant's data. Same visibility as the pages: the audit log needs an auditor role.</summary>
    [HttpPost]
    public async Task<IActionResult> Run([FromBody] QueryRequest req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        if (AuditDataset.IsMatch(req.Query ?? "") && !AuditRoles.Any(User.IsInRole))
            return StatusCode(403, new { error = "The AuditLog dataset needs the auditor, org admin or super admin role" });
        try
        {
            var (status, json) = await _engine.RunQueryAsync(req.TenantId, req.Query ?? "", req.WindowMinutes, Math.Clamp(req.Limit ?? 500, 1, 5000),
                AgentFilter.Parse(req.Agents), ct);
            // alert-engine answers 400 with { error, position } for query mistakes; pass it through unchanged
            return new ContentResult { StatusCode = status, Content = json, ContentType = "application/json" };
        }
        catch (AlertEngineUnavailableException ex) { return StatusCode(503, new { error = ex.Message }); }
    }
}

// ─── Monitoring profile (what agents watch beyond the built-ins) ─────────────

public record LogSource(string Name, string Path, string? Include, string? Exclude, string? Level,
    List<string>? Hosts, List<string>? Tags, string? Platform, bool? FromStart);
public record EventChannel(string Channel, List<int>? Ids, string? Level, List<string>? Hosts, List<string>? Tags);
public record JournalUnit(string Unit, string? Level, List<string>? Hosts, List<string>? Tags);
public record CheckDefinition(string Name, string Type, string Target, int? IntervalSeconds, int? TimeoutSeconds,
    int? ExpectStatus, string? Contains, List<string>? Hosts, List<string>? Tags);
public record MonitoringProfile(List<LogSource>? Logs, List<EventChannel>? EventChannels, List<JournalUnit>? JournalUnits,
    List<CheckDefinition>? Checks);

[ApiController]
[Route("api/v1/agents/profile")]
[Authorize]
public class AgentProfileController : ControllerBase
{
    public static readonly RedisChannel ProfileChannel = RedisChannel.Literal("tenantwarden:agent_profile");
    public static string ProfileKey(Guid tenantId) => $"agent_profile:{tenantId}";
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    private static readonly Regex Name     = new(@"^[A-Za-z0-9 ._-]{1,60}$");
    private static readonly Regex Selector = new(@"^[A-Za-z0-9*?._-]{1,100}$");
    private static readonly HashSet<string> Levels     = ["auto", "critical", "error", "warning", "info"];
    private static readonly HashSet<string> CheckTypes = ["tcp", "http", "dns"];
    // Go's RE2 (the agent) has no look-around or back-references
    private static readonly Regex UnsupportedRegex = new(@"\(\?<?[=!]|\\[1-9]");

    private readonly IDbConnectionFactory _db;
    private readonly IDatabase _redis;
    private readonly IConnectionMultiplexer _mux;

    public AgentProfileController(IDbConnectionFactory db, IConnectionMultiplexer redis)
    {
        _db    = db;
        _mux   = redis;
        _redis = redis.GetDatabase();
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] Guid tenantId)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();
        var row = await conn.QueryFirstOrDefaultAsync<(string Profile, DateTime UpdatedAt, string? UpdatedBy)>(
            "SELECT profile::text, updated_at, updated_by FROM agent_profiles WHERE tenant_id = @tenantId", new { tenantId });
        var profile = row.Profile is null ? new MonitoringProfile([], [], [], []) : JsonSerializer.Deserialize<MonitoringProfile>(row.Profile, Json);
        return Ok(new { profile, updatedAt = row.Profile is null ? (DateTime?)null : row.UpdatedAt, updatedBy = row.UpdatedBy });
    }

    /// <summary>Saves the profile and pushes it to every connected agent of the tenant.</summary>
    [HttpPut]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> Put([FromQuery] Guid tenantId, [FromBody] MonitoringProfile profile)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        if (Validate(profile) is { } error) return BadRequest(new { error });

        var json = JsonSerializer.Serialize(profile, Json);
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"INSERT INTO agent_profiles (tenant_id, profile, updated_at, updated_by) VALUES (@tenantId, @json::jsonb, NOW(), @by)
              ON CONFLICT (tenant_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
            new { tenantId, json, by = User.Actor() });
        await _redis.StringSetAsync(ProfileKey(tenantId), json);
        await _mux.GetSubscriber().PublishAsync(ProfileChannel, tenantId.ToString());
        return NoContent();
    }

    private static string? Validate(MonitoringProfile p)
    {
        if ((p.Logs?.Count ?? 0) > 50 || (p.EventChannels?.Count ?? 0) > 50 || (p.JournalUnits?.Count ?? 0) > 50 || (p.Checks?.Count ?? 0) > 100)
            return "At most 50 log sources, 50 event channels, 50 journal units and 100 checks";

        string? Selectors(List<string>? hosts, List<string>? tags, string what) =>
            (hosts ?? []).Concat(tags ?? []).FirstOrDefault(s => !Selector.IsMatch(s)) is { } bad
                ? $"{what}: \"{bad}\" isn't a valid host or tag pattern (letters, digits, . _ - and * ? wildcards)" : null;
        string? Pattern(string? regex, string what)
        {
            if (string.IsNullOrEmpty(regex)) return null;
            if (regex.Length > 300) return $"{what}: pattern is too long";
            if (UnsupportedRegex.IsMatch(regex)) return $"{what}: look-around and back-references aren't supported";
            try { _ = new Regex(regex); return null; } catch (ArgumentException) { return $"{what}: not a valid regular expression"; }
        }

        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in p.Logs ?? [])
        {
            if (!Name.IsMatch(l.Name ?? "")) return "Log source names use letters, digits, spaces, . _ - (60 characters at most)";
            if (!names.Add("log:" + l.Name)) return $"Log source \"{l.Name}\" appears twice";
            if (string.IsNullOrWhiteSpace(l.Path) || l.Path.Length > 400) return $"Log source \"{l.Name}\": a file path or pattern is required";
            if (l.Level is not null && !Levels.Contains(l.Level)) return $"Log source \"{l.Name}\": level must be one of {string.Join(", ", Levels)}";
            if (l.Platform is not null && l.Platform is not ("windows" or "linux" or "macos")) return $"Log source \"{l.Name}\": platform must be windows, linux or macos";
            if ((Pattern(l.Include, $"Log source \"{l.Name}\" include") ?? Pattern(l.Exclude, $"Log source \"{l.Name}\" exclude")) is { } e) return e;
            if (Selectors(l.Hosts, l.Tags, $"Log source \"{l.Name}\"") is { } s) return s;
        }
        foreach (var c in p.EventChannels ?? [])
        {
            if (string.IsNullOrWhiteSpace(c.Channel) || c.Channel.Length > 200 || c.Channel.Contains('\'')) return "Event channel names are required and can't contain quotes";
            if ((c.Ids?.Count ?? 0) > 50 || (c.Ids ?? []).Any(id => id is < 0 or > 65535)) return $"Event channel \"{c.Channel}\": up to 50 event IDs between 0 and 65535";
            if (c.Level is not null && !Levels.Contains(c.Level)) return $"Event channel \"{c.Channel}\": invalid level";
            if (Selectors(c.Hosts, c.Tags, $"Event channel \"{c.Channel}\"") is { } s) return s;
        }
        foreach (var u in p.JournalUnits ?? [])
        {
            if (!Regex.IsMatch(u.Unit ?? "", @"^[A-Za-z0-9@:._-]{1,100}$")) return "Journal units look like nginx.service or myapp@1.service";
            if (u.Level is not null && !Levels.Contains(u.Level)) return $"Journal unit \"{u.Unit}\": invalid level";
            if (Selectors(u.Hosts, u.Tags, $"Journal unit \"{u.Unit}\"") is { } s) return s;
        }
        names.Clear();
        foreach (var c in p.Checks ?? [])
        {
            if (!Name.IsMatch(c.Name ?? "")) return "Check names use letters, digits, spaces, . _ - (60 characters at most)";
            if (!names.Add(c.Name!)) return $"Check \"{c.Name}\" appears twice";
            if (!CheckTypes.Contains(c.Type ?? "")) return $"Check \"{c.Name}\": type must be tcp, http or dns";
            if (string.IsNullOrWhiteSpace(c.Target) || c.Target.Length > 400) return $"Check \"{c.Name}\": a target is required";
            if (c.Type == "http" && !(Uri.TryCreate(c.Target, UriKind.Absolute, out var u) && u.Scheme is "http" or "https"))
                return $"Check \"{c.Name}\": use a full http:// or https:// URL";
            if (c.Type == "tcp" && !Regex.IsMatch(c.Target, @"^[A-Za-z0-9.\-\[\]:]+:[0-9]{1,5}$")) return $"Check \"{c.Name}\": use host:port";
            if (c.IntervalSeconds is < 30 or > 3600) return $"Check \"{c.Name}\": interval between 30 and 3600 seconds";
            if (c.TimeoutSeconds is < 1 or > 60) return $"Check \"{c.Name}\": timeout between 1 and 60 seconds";
            if (Selectors(c.Hosts, c.Tags, $"Check \"{c.Name}\"") is { } s) return s;
        }
        return null;
    }
}

// ─── Network & workloads dashboards ──────────────────────────────────────────

public record NetworkPoint(DateTime T, double RxMbps, double TxMbps);

[ApiController]
[Route("api/v1")]
[Authorize]
public class NetworkAndWorkloadsController : ControllerBase
{
    private const string RiskyPorts = "3389|445|23|21|1433|3306|5432|6379|27017|9200";
    private readonly IDbConnectionFactory _db;
    private readonly IClickHouseService _clickHouse;
    private readonly ILogger<NetworkAndWorkloadsController> _log;

    public NetworkAndWorkloadsController(IDbConnectionFactory db, IClickHouseService clickHouse, ILogger<NetworkAndWorkloadsController> log)
    {
        _db         = db;
        _clickHouse = clickHouse;
        _log        = log;
    }

    /// <summary>Fleet throughput over time, per-host traffic and connections, and exposed ports.</summary>
    [HttpGet("network/summary")]
    public async Task<IActionResult> NetworkSummary([FromQuery] Guid tenantId, [FromQuery] string? agents, [FromQuery] int hours = 24, CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var filter = AgentFilter.Parse(agents);
        hours = Math.Clamp(hours, 1, 24 * 30);
        var bucket = hours <= 6 ? 60 : hours <= 48 ? 300 : 3600;

        List<NetworkPoint> traffic = [];
        try
        {
            // Average per host inside a bucket, then add the hosts up
            traffic = await _clickHouse.QueryAsync<NetworkPoint>(
                @"SELECT t, round(sum(rx) * 8 / 1e6, 2) AS rxMbps, round(sum(tx) * 8 / 1e6, 2) AS txMbps
                  FROM (SELECT toStartOfInterval(collected_at, toIntervalSecond({bucket:UInt32})) AS t, agent_id,
                               avg(rx_bps) AS rx, avg(tx_bps) AS tx
                        FROM agent_metrics
                        WHERE tenant_id = {tenant:UUID} AND collected_at >= now64(3) - toIntervalHour({hours:UInt32})
                          AND (empty({agents:Array(UUID)}) OR has({agents:Array(UUID)}, agent_id))
                        GROUP BY t, agent_id)
                  GROUP BY t ORDER BY t",
                new Dictionary<string, object> { ["bucket"] = bucket, ["tenant"] = tenantId, ["hours"] = hours, ["agents"] = AgentFilter.ToClickHouse(filter) }, ct);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning("Network history unavailable (ClickHouse): {Error}", ex.Message);
        }

        await using var conn = _db.CreateConnection();
        var hosts = await conn.QueryAsync(
            $@"SELECT a.id, a.hostname, a.platform::text AS platform,
                      (a.last_heartbeat_at > NOW() - INTERVAL '2 minutes') AS online,
                      ROUND(COALESCE(a.net_rx_bps, 0) * 8 / 1e6, 2)::float8 AS ""rxMbps"",
                      ROUND(COALESCE(a.net_tx_bps, 0) * 8 / 1e6, 2)::float8 AS ""txMbps"",
                      a.connections::text AS connections,
                      jsonb_array_length(CASE WHEN jsonb_typeof(a.inventory->'listening_ports') = 'array' THEN a.inventory->'listening_ports' ELSE '[]' END)::int AS ""listeningPorts"",
                      COALESCE((SELECT array_agg(DISTINCT substring(p from ':([0-9]+)$'))
                                FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.inventory->'listening_ports') = 'array' THEN a.inventory->'listening_ports' ELSE '[]' END) p
                                WHERE p ~ '^\S+ (0\.0\.0\.0|\*|\[::\]|::):({RiskyPorts})$'), '{{}}') AS ""exposedPorts""
               FROM agents a WHERE a.tenant_id = @tenantId AND (@agents::uuid[] IS NULL OR a.agent_id = ANY(@agents))
               ORDER BY COALESCE(a.net_rx_bps, 0) + COALESCE(a.net_tx_bps, 0) DESC, a.hostname",
            new { tenantId, agents = filter });
        return Ok(new { hours, traffic, hosts });
    }

    [HttpGet("network/checks")]
    public async Task<IActionResult> Checks([FromQuery] Guid tenantId, [FromQuery] string? agents)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT c.agent_id AS ""agentId"", c.hostname, c.name, c.type, c.target, c.ok, c.latency_ms AS ""latencyMs"",
                     c.status_code AS ""statusCode"", c.error, c.cert_days_left AS ""certDaysLeft"", c.checked_at AS ""checkedAt"",
                     c.failing_since AS ""failingSince"", (c.checked_at < NOW() - INTERVAL '15 minutes') AS stale
              FROM endpoint_checks c WHERE c.tenant_id = @tenantId AND (@agents::uuid[] IS NULL OR c.agent_id = ANY(@agents))
              ORDER BY c.ok, c.name, c.hostname",
            new { tenantId, agents = AgentFilter.Parse(agents) });
        return Ok(rows);
    }

    /// <summary>Latency and availability per check over time (5-minute buckets beyond 6 hours).</summary>
    [HttpGet("network/checks/history")]
    public async Task<IActionResult> CheckHistory([FromQuery] Guid tenantId, [FromQuery] string? name, [FromQuery] string? agents, [FromQuery] int hours = 24)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        hours = Math.Clamp(hours, 1, 24 * 14);
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT date_bin(make_interval(mins => @bucket), checked_at, TIMESTAMPTZ '2000-01-01') AS t, name,
                     ROUND(AVG(latency_ms) FILTER (WHERE ok))::int AS ""latencyMs"",
                     ROUND(100.0 * COUNT(*) FILTER (WHERE ok) / COUNT(*))::int AS ""availability""
              FROM endpoint_check_results
              WHERE tenant_id = @tenantId AND checked_at >= NOW() - make_interval(hours => @hours)
                AND (@name::text IS NULL OR name = @name)
                AND (@agents::uuid[] IS NULL OR agent_id = ANY(@agents))
              GROUP BY 1, 2 ORDER BY 1",
            new { tenantId, hours, name, agents = AgentFilter.Parse(agents), bucket = hours <= 6 ? 1 : 5 });
        return Ok(rows);
    }

    /// <summary>Server roles the agents discovered, one row per role per host.</summary>
    [HttpGet("workloads")]
    public async Task<IActionResult> Workloads([FromQuery] Guid tenantId, [FromQuery] string? agents)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        await using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            @"SELECT a.id AS ""agentDbId"", a.agent_id AS ""agentId"", a.hostname, a.platform::text AS platform,
                     (a.last_heartbeat_at > NOW() - INTERVAL '2 minutes') AS online,
                     w->>'type' AS type, w->>'name' AS name, w->>'status' AS status, w->>'startup' AS startup,
                     w->>'version' AS version, (w->'details')::text AS details, a.inventory_at AS ""seenAt""
              FROM agents a, jsonb_array_elements(CASE WHEN jsonb_typeof(a.inventory->'workloads') = 'array' THEN a.inventory->'workloads' ELSE '[]' END) w
              WHERE a.tenant_id = @tenantId AND (@agents::uuid[] IS NULL OR a.agent_id = ANY(@agents))
              ORDER BY w->>'type', a.hostname, w->>'name'",
            new { tenantId, agents = AgentFilter.Parse(agents) });
        return Ok(rows);
    }
}
