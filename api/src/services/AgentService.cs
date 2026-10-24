using TenantWarden.Api.Hubs;
using Dapper;
using TenantWarden.Api.Models;
using TenantWarden.Api.Infrastructure;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
using System.Text;

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
    Task<AgentEnrollmentToken> IssueEnrollmentTokenAsync(Guid tenantId, int expiresInDays, string issuedBy, CancellationToken ct = default);
    Task<Guid?> GetEnrollmentTokenTenantAsync(string tokenId, CancellationToken ct = default);
    Task RevokeEnrollmentTokenAsync(string tokenId, CancellationToken ct = default);
}

public class AgentService : IAgentService
{
    private readonly IDbConnectionFactory _db;
    private readonly IDatabase _redis;
    private readonly ITenantWardenHubPublisher _hub;
    private readonly IConfiguration _cfg;
    private readonly ILogger<AgentService> _log;

    private static readonly TimeSpan OfflineThreshold = TimeSpan.FromSeconds(90);

    // Must match AgentTokenAudience in agent-gateway/src/Program.cs
    public const string EnrollmentTokenAudience = "tenantwarden-agent";

    public AgentService(IDbConnectionFactory db, IConnectionMultiplexer redis, ITenantWardenHubPublisher hub, IConfiguration cfg, ILogger<AgentService> log)
    {
        _db    = db;
        _redis = redis.GetDatabase();
        _hub   = hub;
        _cfg   = cfg;
        _log   = log;
    }

    public async Task<List<Agent>> ListAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var agents = await conn.QueryAsync<Agent>(
            "SELECT * FROM agents WHERE tenant_id = @tenantId ORDER BY hostname",
            new { tenantId });

        // Reconcile live status from Redis heartbeats
        var list = agents.ToList();
        foreach (var agent in list)
        {
            var lastBeat = await _redis.StringGetAsync($"agent_heartbeat:{agent.AgentId}");
            if (lastBeat.HasValue)
            {
                var ts = DateTimeOffset.FromUnixTimeSeconds((long)lastBeat);
                agent.Status = (DateTimeOffset.UtcNow - ts) < OfflineThreshold
                    ? AgentStatus.Online : AgentStatus.Offline;
            }
        }
        return list;
    }

    public async Task<Agent?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Agent>("SELECT * FROM agents WHERE id = @id", new { id });
    }

    public async Task<Agent?> GetByAgentIdAsync(Guid agentId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<Agent>(
            "SELECT * FROM agents WHERE agent_id = @agentId", new { agentId });
    }

    public async Task<Agent> RegisterAsync(RegisterAgentRequest req, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();

        var agent = await conn.QueryFirstAsync<Agent>(
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
              RETURNING *",
            new
            {
                req.TenantId, req.Hostname,
                AgentId     = req.AgentId == Guid.Empty ? Guid.NewGuid() : req.AgentId,
                Platform    = req.Platform.ToPg(),
                req.Version, req.OsName, req.OsVersion,
                req.Architecture, req.IpAddress, req.DomainName,
                req.JwtPublicKey, req.Fingerprint,
            });

        _log.LogInformation("Agent registered {AgentId} host:{Hostname}", agent.AgentId, agent.Hostname);
        await _hub.PublishAgentStatus(req.TenantId.ToString(), new { agent.AgentId, agent.Hostname, Status = "online" });
        return agent;
    }

    public async Task HeartbeatAsync(Guid agentId, AgentHeartbeat beat, CancellationToken ct = default)
    {
        // Store timestamp in Redis (90s TTL = auto-offline detection)
        await _redis.StringSetAsync(
            $"agent_heartbeat:{agentId}",
            DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            TimeSpan.FromSeconds(120));

        // Update metrics in DB (non-blocking — fire and forget)
        _ = Task.Run(async () =>
        {
            try
            {
                await using var conn = _db.CreateConnection();
                await conn.ExecuteAsync(
                    @"UPDATE agents SET
                        cpu_percent       = @Cpu,
                        memory_percent    = @Memory,
                        disk_percent      = @Disk,
                        last_heartbeat_at = NOW(),
                        last_seen_at      = NOW(),
                        status            = 'online',
                        updated_at        = NOW()
                      WHERE agent_id = @agentId",
                    new { agentId, Cpu = beat.CpuPercent, Memory = beat.MemoryPercent, Disk = beat.DiskPercent });
            }
            catch (Exception ex) { _log.LogWarning(ex, "Heartbeat DB update failed for {AgentId}", agentId); }
        }, ct);
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
        await conn.ExecuteAsync("DELETE FROM agents WHERE id = @id", new { id });
    }

    public async Task<AgentStats> GetStatsAsync(Guid tenantId, CancellationToken ct = default)
    {
        await using var conn = _db.CreateConnection();
        var row = await conn.QueryFirstAsync<AgentStats>(
            // ::int — COUNT is bigint, and Dapper needs the types to match AgentStats' int constructor
            @"SELECT
                COUNT(*)::int                                                                    AS total,
                (COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '90 seconds'))::int AS online,
                (COUNT(*) FILTER (WHERE platform = 'windows'))::int                              AS windows,
                (COUNT(*) FILTER (WHERE platform = 'linux'))::int                                AS linux,
                (COUNT(*) FILTER (WHERE platform = 'macos'))::int                                AS macos,
                (COUNT(*) FILTER (WHERE platform = 'docker'))::int                               AS docker
              FROM agents WHERE tenant_id = @tenantId",
            new { tenantId });
        return row;
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
        _log.LogInformation("Agent enrollment token {TokenId} revoked", tokenId);
    }
}

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
public record AgentStats(int Total, int Online, int Windows, int Linux, int MacOs, int Docker);
