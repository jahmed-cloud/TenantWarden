using TenantWarden.Api.Hubs;
using Dapper;
using TenantWarden.Api.Models;
using TenantWarden.Api.Infrastructure;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
using System.Text;
using System.Text.Json;

namespace TenantWarden.Api.Services;

public interface IAgentService
{
    Task<List<Agent>> ListAsync(Guid tenantId, CancellationToken ct = default);
    Task<Agent?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Agent?> GetByAgentIdAsync(Guid agentId, CancellationToken ct = default);
    Task<Agent> RegisterAsync(RegisterAgentRequest req, CancellationToken ct = default);
    Task HeartbeatAsync(Guid agentId, AgentHeartbeat beat, CancellationToken ct = default);
    Task SetStatusAsync(Guid agentId, AgentStatus status, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<AgentStats> GetStatsAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<AgentMetricPoint>> GetMetricsAsync(Guid tenantId, Guid agentId, int hours, CancellationToken ct = default);
    Task<List<object>> GetEventsAsync(Guid tenantId, Guid? agentId, int limit, string? source = null, CancellationToken ct = default);
    Task<string?> GetInventoryJsonAsync(Guid id, CancellationToken ct = default);
    Task<AgentEnrollmentToken> IssueEnrollmentTokenAsync(Guid tenantId, int expiresInDays, string issuedBy, CancellationToken ct = default);
    Task<Guid?> GetEnrollmentTokenTenantAsync(string tokenId, CancellationToken ct = default);
    Task<List<EnrollmentTokenInfo>> ListEnrollmentTokensAsync(Guid tenantId, CancellationToken ct = default);
    Task RevokeEnrollmentTokenAsync(string tokenId, CancellationToken ct = default);
}

public class AgentService : IAgentService
{
    // inet / macaddr / text[] / uuid don't map onto the Agent's string properties — cast them
    private const string Columns =
        @"id, tenant_id, hostname, agent_id::text AS agent_id, platform::text AS platform, version, status::text AS status,
          os_name, os_version, architecture, host(ip_address) AS ip_address, mac_address::text AS mac_address, domain_name,
          jwt_public_key, fingerprint, last_seen_at, last_heartbeat_at, cpu_percent, memory_percent, disk_percent,
          array_to_string(tags, ',') AS tags, uptime_seconds, inventory_at, net_rx_bps, net_tx_bps,
          connections::text AS connections, created_at, updated_at";

    private readonly IDbConnectionFactory _db;
    private readonly IDatabase _redis;
    private readonly IClickHouseService _clickHouse;
    private readonly ITenantWardenHubPublisher _hub;
    private readonly IConfiguration _cfg;
    private readonly ILogger<AgentService> _log;

    // Must match AgentTokenAudience in agent-gateway/src/Program.cs
    public const string EnrollmentTokenAudience = "tenantwarden-agent";

    public AgentService(IDbConnectionFactory db, IConnectionMultiplexer redis, IClickHouseService clickHouse,
        ITenantWardenHubPublisher hub, IConfiguration cfg, ILogger<AgentService> log)
    {
        _db         = db;
        _redis      = redis.GetDatabase();
        _clickHouse = clickHouse;
        _hub        = hub;
        _cfg        = cfg;
        _log        = log;
    }

    public async Task<List<Agent>> ListAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var agents = (await conn.QueryAsync<Agent>(
            $"SELECT {Columns} FROM agents WHERE tenant_id = @tenantId ORDER BY hostname", new { tenantId })).ToList();

        // Online = the gateway holds a live heartbeat key for the agent (one round trip for the fleet)
        if (agents.Count > 0)
        {
            var beats = await _redis.StringGetAsync(agents.Select(a => (RedisKey)$"agent_heartbeat:{a.AgentId}").ToArray());
            for (var i = 0; i < agents.Count; i++)
                agents[i].Status = beats[i].HasValue ? AgentStatus.Online : AgentStatus.Offline;
        }
        return agents;
    }

    public async Task<Agent?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var agent = await conn.QueryFirstOrDefaultAsync<Agent>($"SELECT {Columns} FROM agents WHERE id = @id", new { id });
        if (agent is not null)
            agent.Status = await _redis.KeyExistsAsync($"agent_heartbeat:{agent.AgentId}") ? AgentStatus.Online : AgentStatus.Offline;
        return agent;
    }

    public async Task<Agent?> GetByAgentIdAsync(Guid agentId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Agent>($"SELECT {Columns} FROM agents WHERE agent_id = @agentId", new { agentId });
    }

    public async Task<Agent> RegisterAsync(RegisterAgentRequest req, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var id = await conn.ExecuteScalarAsync<Guid>(
            @"INSERT INTO agents
                (tenant_id, hostname, agent_id, platform, version, os_name, os_version,
                 architecture, ip_address, domain_name, jwt_public_key, fingerprint, status)
              VALUES
                (@TenantId, @Hostname, @AgentId, @Platform::agent_platform, @Version,
                 @OsName, @OsVersion, @Architecture, @IpAddress::inet, @DomainName,
                 @JwtPublicKey, @Fingerprint, 'online')
              ON CONFLICT (agent_id) DO UPDATE SET
                hostname       = EXCLUDED.hostname,
                version        = EXCLUDED.version,
                os_version     = EXCLUDED.os_version,
                ip_address     = EXCLUDED.ip_address,
                status         = 'online',
                updated_at     = NOW()
              RETURNING id",
            new
            {
                req.TenantId, req.Hostname,
                AgentId     = req.AgentId == Guid.Empty ? Guid.NewGuid() : req.AgentId,
                Platform    = req.Platform.ToPg(),
                req.Version, req.OsName, req.OsVersion,
                req.Architecture, req.IpAddress, req.DomainName,
                req.JwtPublicKey, req.Fingerprint,
            });

        var agent = (await GetByIdAsync(id, ct))!;
        _log.LogInformation("Agent registered {AgentId} host:{Hostname}", agent.AgentId, agent.Hostname);
        await _hub.PublishAgentStatus(req.TenantId.ToString(), new { agent.AgentId, agent.Hostname, Status = "online" });
        return agent;
    }

    public async Task HeartbeatAsync(Guid agentId, AgentHeartbeat beat, CancellationToken ct = default)
    {
        await _redis.StringSetAsync($"agent_heartbeat:{agentId}", DateTimeOffset.UtcNow.ToUnixTimeSeconds(), TimeSpan.FromSeconds(120));

        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            @"UPDATE agents SET
                cpu_percent = @Cpu, memory_percent = @Memory, disk_percent = @Disk,
                last_heartbeat_at = NOW(), last_seen_at = NOW(), status = 'online', updated_at = NOW()
              WHERE agent_id = @agentId",
            new { agentId, Cpu = beat.CpuPercent, Memory = beat.MemoryPercent, Disk = beat.DiskPercent });
    }

    public async Task SetStatusAsync(Guid agentId, AgentStatus status, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE agents SET status = @status::agent_status, updated_at = NOW() WHERE agent_id = @agentId",
            new { agentId, status = status.ToPg() });
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        // Events and check results have no foreign key to agents (they can arrive before registration)
        await conn.ExecuteAsync(
            @"WITH gone AS (DELETE FROM agents WHERE id = @id RETURNING agent_id, tenant_id),
                   events AS (DELETE FROM agent_events e USING gone WHERE e.agent_id = gone.agent_id AND e.tenant_id = gone.tenant_id),
                   checks AS (DELETE FROM endpoint_checks c USING gone WHERE c.agent_id = gone.agent_id AND c.tenant_id = gone.tenant_id)
              DELETE FROM endpoint_check_results r USING gone WHERE r.agent_id = gone.agent_id AND r.tenant_id = gone.tenant_id",
            new { id });
    }

    public async Task<AgentStats> GetStatsAsync(Guid tenantId, CancellationToken ct = default)
    {
        // Same online rule as the list, so the numbers always agree
        var agents = await ListAsync(tenantId, ct);
        int Count(AgentPlatform p) => agents.Count(a => a.Platform == p);
        var online = agents.Count(a => a.Status == AgentStatus.Online);
        return new AgentStats(agents.Count, online, agents.Count - online,
            Count(AgentPlatform.Windows), Count(AgentPlatform.Linux), Count(AgentPlatform.MacOS), Count(AgentPlatform.Docker));
    }

    /// <summary>CPU / memory / disk history from ClickHouse, bucketed to keep charts readable.</summary>
    public async Task<List<AgentMetricPoint>> GetMetricsAsync(Guid tenantId, Guid agentId, int hours, CancellationToken ct = default)
    {
        hours = Math.Clamp(hours, 1, 24 * 30);
        var bucketSeconds = hours <= 6 ? 60 : hours <= 48 ? 300 : 3600;
        return await _clickHouse.QueryAsync<AgentMetricPoint>(
            @"SELECT toStartOfInterval(collected_at, toIntervalSecond({bucket:UInt32})) AS t,
                     round(avg(cpu_percent), 1)  AS cpu,
                     round(max(cpu_percent), 1)  AS cpuMax,
                     round(avg(mem_percent), 1)  AS mem,
                     round(avg(disk_percent), 1) AS disk,
                     round(avg(rx_bps) * 8 / 1e6, 2) AS rxMbps,
                     round(avg(tx_bps) * 8 / 1e6, 2) AS txMbps
              FROM agent_metrics
              WHERE tenant_id = {tenant:UUID} AND agent_id = {agent:UUID}
                AND collected_at >= now64(3) - toIntervalHour({hours:UInt32})
              GROUP BY t ORDER BY t",
            new Dictionary<string, object> { ["bucket"] = bucketSeconds, ["tenant"] = tenantId, ["agent"] = agentId, ["hours"] = hours },
            ct);
    }

    public async Task<List<object>> GetEventsAsync(Guid tenantId, Guid? agentId, int limit, string? source = null, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        // source: an exact event source ("SQL Server"), or a prefix ending in ':' ("log:" = every custom log)
        var rows = await conn.QueryAsync(
            @"SELECT id, agent_id AS ""agentId"", hostname, level, source, message, occurred_at AS ""occurredAt""
              FROM agent_events
              WHERE tenant_id = @tenantId AND (@agentId::uuid IS NULL OR agent_id = @agentId)
                AND (@source::text IS NULL OR source = @source OR (right(@source, 1) = ':' AND starts_with(source, @source)))
              ORDER BY occurred_at DESC LIMIT @limit",
            new { tenantId, agentId, source = string.IsNullOrWhiteSpace(source) ? null : source, limit = Math.Clamp(limit, 1, 500) });
        return rows.Cast<object>().ToList();
    }

    public async Task<string?> GetInventoryJsonAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.ExecuteScalarAsync<string?>("SELECT inventory::text FROM agents WHERE id = @id", new { id });
    }

    // ── Enrollment tokens (presented by agents to the agent gateway) ──────────

    public async Task<AgentEnrollmentToken> IssueEnrollmentTokenAsync(Guid tenantId, int expiresInDays, string issuedBy, CancellationToken ct = default)
    {
        var key       = _cfg["Auth:Jwt:SigningKey"] ?? throw new InvalidOperationException("JWT signing key required");
        var tokenId   = Guid.NewGuid().ToString("N");
        var expiresAt = DateTime.UtcNow.AddDays(Math.Clamp(expiresInDays, 1, 730));

        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer   = _cfg["Auth:Jwt:Issuer"] ?? "tenantwarden",
            Audience = EnrollmentTokenAudience,
            Expires  = expiresAt,
            Claims   = new Dictionary<string, object>
            {
                ["jti"]       = tokenId,
                ["sub"]       = $"agent-enrollment:{tokenId}",
                ["tenant_id"] = tenantId.ToString(),
                ["issued_by"] = issuedBy,
            },
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256),
        });

        // Remember the owning tenant until expiry so the token can be revoked
        await _redis.StringSetAsync($"agent_token:{tokenId}", tenantId.ToString(), expiresAt - DateTime.UtcNow);
        // …and list it in the portal (the token itself is never stored)
        await _redis.HashSetAsync($"agent_tokens:{tenantId}", tokenId,
            JsonSerializer.Serialize(new EnrollmentTokenInfo(tokenId, DateTime.UtcNow, expiresAt, issuedBy, false)));

        _log.LogInformation("Agent enrollment token {TokenId} issued for tenant {TenantId} by {IssuedBy}", tokenId, tenantId, issuedBy);
        return new AgentEnrollmentToken(token, tokenId, tenantId, expiresAt);
    }

    public async Task<Guid?> GetEnrollmentTokenTenantAsync(string tokenId, CancellationToken ct = default)
    {
        var tenant = await _redis.StringGetAsync($"agent_token:{tokenId}");
        return Guid.TryParse(tenant.ToString(), out var id) ? id : null;
    }

    public async Task RevokeEnrollmentTokenAsync(string tokenId, CancellationToken ct = default)
    {
        // The gateway rejects revoked ids; keep the marker until the token would have expired anyway
        var ttl = await _redis.KeyTimeToLiveAsync($"agent_token:{tokenId}") ?? TimeSpan.FromDays(730);
        await _redis.StringSetAsync($"agent_token_revoked:{tokenId}", "1", ttl);

        if (await GetEnrollmentTokenTenantAsync(tokenId, ct) is { } tenantId &&
            await _redis.HashGetAsync($"agent_tokens:{tenantId}", tokenId) is { HasValue: true } raw &&
            JsonSerializer.Deserialize<EnrollmentTokenInfo>(raw.ToString()) is { } info)
            await _redis.HashSetAsync($"agent_tokens:{tenantId}", tokenId, JsonSerializer.Serialize(info with { Revoked = true }));

        _log.LogInformation("Agent enrollment token {TokenId} revoked", tokenId);
    }

    public async Task<List<EnrollmentTokenInfo>> ListEnrollmentTokensAsync(Guid tenantId, CancellationToken ct = default)
    {
        var key = $"agent_tokens:{tenantId}";
        var list = new List<EnrollmentTokenInfo>();
        foreach (var entry in await _redis.HashGetAllAsync(key))
        {
            var info = JsonSerializer.Deserialize<EnrollmentTokenInfo>(entry.Value.ToString());
            if (info is null || info.ExpiresAt < DateTime.UtcNow)
                await _redis.HashDeleteAsync(key, entry.Name); // expired tokens drop off the list
            else
                list.Add(info);
        }
        return list.OrderByDescending(t => t.IssuedAt).ToList();
    }
}

public record EnrollmentTokenInfo(string TokenId, DateTime IssuedAt, DateTime ExpiresAt, string IssuedBy, bool Revoked);

public record AgentEnrollmentToken(string Token, string TokenId, Guid TenantId, DateTime ExpiresAt);

public record RegisterAgentRequest(
    Guid          TenantId,
    string        Hostname,
    Guid          AgentId,
    AgentPlatform Platform,
    string        Version,
    string        OsName,
    string        OsVersion,
    string        Architecture,
    string        IpAddress,
    string?       DomainName,
    string        JwtPublicKey,
    string        Fingerprint);

public record AgentHeartbeat(double CpuPercent, double MemoryPercent, double DiskPercent);
public record AgentStats(int Total, int Online, int Offline, int Windows, int Linux, int MacOs, int Docker);
/// <summary>One bucket of a host's history; network figures are average bytes/s converted to Mbit/s.</summary>
public record AgentMetricPoint(DateTime T, double Cpu, double CpuMax, double Mem, double Disk, double RxMbps, double TxMbps);
