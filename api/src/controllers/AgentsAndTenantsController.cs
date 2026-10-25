using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Services;
using TenantWarden.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

// ─── Agents ───────────────────────────────────────────────────────────────────

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class AgentsController : ControllerBase
{
    private readonly IAgentService  _agents;
    private readonly ITenantService _tenants;

    public AgentsController(IAgentService agents, ITenantService tenants)
    {
        _agents  = agents;
        _tenants = tenants;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid tenantId, [FromQuery] string? agents, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _agents.ListAsync(tenantId, AgentFilter.Parse(agents), ct));
    }

    // GET /api/v1/agents/groups?tenantId= — machine groups and how many agents each holds
    [HttpGet("groups")]
    public async Task<IActionResult> Groups([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _agents.ListGroupsAsync(tenantId, ct));
    }

    public record GroupChange(Guid TenantId, List<Guid> AgentIds, string? Add, string? Remove);

    // PATCH /api/v1/agents/groups — add the agents to a group and/or take them out of one
    [HttpPatch("groups")]
    [Authorize(Roles = "super_admin,org_admin,security_admin")]
    public async Task<IActionResult> ChangeGroups([FromBody] GroupChange req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        if (req.AgentIds is not { Count: > 0 and <= 1000 }) return BadRequest(new { error = "Select between 1 and 1000 agents" });
        var add = req.Add?.Trim();
        var remove = req.Remove?.Trim();
        if (string.IsNullOrEmpty(add) && string.IsNullOrEmpty(remove)) return BadRequest(new { error = "Give a group to add or remove" });
        if (!string.IsNullOrEmpty(add) && !System.Text.RegularExpressions.Regex.IsMatch(add, @"^[A-Za-z0-9 ._-]{1,40}$"))
            return BadRequest(new { error = "Group names use letters, digits, spaces, . _ - (40 characters at most)" });
        var changed = await _agents.UpdateGroupsAsync(req.TenantId, [.. req.AgentIds], string.IsNullOrEmpty(add) ? null : add,
            string.IsNullOrEmpty(remove) ? null : remove, ct);
        return Ok(new { changed });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        return agent is null || !User.CanAccessTenant(agent.TenantId) ? NotFound() : Ok(agent);
    }

    [HttpPost("register")]
    [Authorize(Roles = "super_admin,org_admin,security_admin")]
    public async Task<IActionResult> Register([FromBody] RegisterAgentRequest req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        var agent = await _agents.RegisterAsync(req, ct);
        return CreatedAtAction(nameof(Get), new { id = agent.Id }, agent);
    }

    [HttpPost("{agentId:guid}/heartbeat")]
    public async Task<IActionResult> Heartbeat(Guid agentId, [FromBody] AgentHeartbeat beat, CancellationToken ct)
    {
        var agent = await _agents.GetByAgentIdAsync(agentId, ct);
        if (agent is null || !User.CanAccessTenant(agent.TenantId)) return NotFound();
        await _agents.HeartbeatAsync(agentId, beat, ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "super_admin,org_admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        if (agent is null || !User.CanAccessTenant(agent.TenantId)) return NotFound();
        await _agents.DeleteAsync(id, ct);
        return NoContent();
    }

    [HttpGet("stats")]
    public async Task<IActionResult> Stats([FromQuery] Guid tenantId, [FromQuery] string? agents, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _agents.GetStatsAsync(tenantId, AgentFilter.Parse(agents), ct));
    }

    // GET /api/v1/agents/{id}/metrics?hours=24 — CPU / memory / disk history from ClickHouse
    [HttpGet("{id:guid}/metrics")]
    public async Task<IActionResult> Metrics(Guid id, [FromQuery] int hours = 24, CancellationToken ct = default)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        if (agent is null || !User.CanAccessTenant(agent.TenantId)) return NotFound();
        try
        {
            return Ok(await _agents.GetMetricsAsync(agent.TenantId, Guid.Parse(agent.AgentId), hours, ct));
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return StatusCode(503, new { error = "Metrics history is unavailable (ClickHouse is not reachable)" });
        }
    }

    // GET /api/v1/agents/{id}/inventory — latest services / updates / disks / BitLocker snapshot
    [HttpGet("{id:guid}/inventory")]
    public async Task<IActionResult> Inventory(Guid id, CancellationToken ct)
    {
        var agent = await _agents.GetByIdAsync(id, ct);
        if (agent is null || !User.CanAccessTenant(agent.TenantId)) return NotFound();
        var json = await _agents.GetInventoryJsonAsync(id, ct);
        return Content(json ?? "{}", "application/json");
    }

    // GET /api/v1/agents/events?tenantId=…&agentId=…&source=… — events reported by agents
    // (source "SQL Server" for one source, "log:" for every custom log)
    [HttpGet("events")]
    public async Task<IActionResult> Events([FromQuery] Guid tenantId, [FromQuery] Guid? agentId, [FromQuery] string? source,
        [FromQuery] string? agents, [FromQuery] int limit = 100, CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _agents.GetEventsAsync(tenantId, agentId, limit, source, AgentFilter.Parse(agents), ct));
    }

    // POST /api/v1/agents/enrollment-tokens — token for `tenantwarden-agent --agent-token`
    [HttpPost("enrollment-tokens")]
    [Authorize(Roles = "super_admin,org_admin,security_admin")]
    public async Task<IActionResult> CreateEnrollmentToken([FromBody] CreateEnrollmentTokenRequest req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        if (await _tenants.GetByIdAsync(req.TenantId, ct) is null) return NotFound(new { error = "Tenant not found" });

        var token = await _agents.IssueEnrollmentTokenAsync(req.TenantId, req.ExpiresInDays ?? 365, User.Actor(), ct);
        return Ok(token);
    }

    // GET /api/v1/agents/enrollment-tokens?tenantId= — unexpired tokens (ids and dates only)
    [HttpGet("enrollment-tokens")]
    [Authorize(Roles = "super_admin,org_admin,security_admin")]
    public async Task<IActionResult> ListEnrollmentTokens([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _agents.ListEnrollmentTokensAsync(tenantId, ct));
    }

    // DELETE /api/v1/agents/enrollment-tokens/{tokenId} — agents using it are refused on next connect
    [HttpDelete("enrollment-tokens/{tokenId}")]
    [Authorize(Roles = "super_admin,org_admin,security_admin")]
    public async Task<IActionResult> RevokeEnrollmentToken(string tokenId, CancellationToken ct)
    {
        var tenantId = await _agents.GetEnrollmentTokenTenantAsync(tokenId, ct);
        if (tenantId is null || !User.CanAccessTenant(tenantId.Value)) return NotFound();
        await _agents.RevokeEnrollmentTokenAsync(tokenId, ct);
        return NoContent();
    }
}

public record CreateEnrollmentTokenRequest(Guid TenantId, int? ExpiresInDays = null);

// ─── Tenants ──────────────────────────────────────────────────────────────────

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class TenantsController : ControllerBase
{
    private readonly ITenantService _tenants;
    private readonly ILogger<TenantsController> _logger;

    public TenantsController(ITenantService tenants, ILogger<TenantsController> logger)
    { _tenants = tenants; _logger = logger; }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var tenants = await _tenants.ListAsync(ct);
        return Ok(tenants.Where(t => User.CanAccessTenant(t.Id)).Select(TenantDto.From));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var tenant = await _tenants.GetByIdAsync(id, ct);
        return tenant is null || !User.CanAccessTenant(id) ? NotFound() : Ok(TenantDto.From(tenant));
    }

    [HttpPost]
    [Authorize(Roles = "super_admin")]
    public async Task<IActionResult> Create([FromBody] CreateTenantRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.AzureTenantId) || string.IsNullOrWhiteSpace(req.ClientId) || string.IsNullOrWhiteSpace(req.ClientSecret))
            return BadRequest(new { error = "Tenant ID, Client ID, and Client Secret are required" });
        try
        {
            var tenant = await _tenants.CreateAsync(req, ct);
            return CreatedAtAction(nameof(Get), new { id = tenant.Id }, new { id = tenant.Id, displayName = tenant.DisplayName });
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505")
        {
            return Conflict(new { error = "A tenant with this Directory (tenant) ID is already connected. Remove it first or use a different tenant." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Tenant creation failed");
            return StatusCode(500, new { error = "Failed to create tenant: " + ex.Message });
        }
    }

    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "super_admin,org_admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTenantRequest req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(id)) return NotFound();
        await _tenants.UpdateAsync(id, req, ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "super_admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await _tenants.DeleteAsync(id, ct);
        return NoContent();
    }
}

/// <summary>Tenant as returned to clients — never includes the encrypted Graph client secret.</summary>
public record TenantDto(
    Guid          Id,
    string        DisplayName,
    string        AzureTenantId,
    string        Domain,
    TenantStatus  Status,
    string?       Description,
    string?       LogoUrl,
    string        ClientId,
    DateTime?     LastSyncAt,
    string?       LastSyncError,
    int           UserCount,
    int           DeviceCount,
    List<string>  EnabledModules,
    DateTime      CreatedAt,
    DateTime      UpdatedAt)
{
    public static TenantDto From(Tenant t) => new(
        t.Id, t.DisplayName, t.AzureTenantId, t.Domain, t.Status, t.Description, t.LogoUrl, t.ClientId,
        t.LastSyncAt, t.LastSyncError, t.UserCount, t.DeviceCount, t.EnabledModules, t.CreatedAt, t.UpdatedAt);
}

// ─── Overview / Dashboard ─────────────────────────────────────────────────────

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class OverviewController : ControllerBase
{
    private readonly IAlertService     _alerts;
    private readonly IAgentService     _agents;
    private readonly IIdentityService  _identity;
    private readonly IDeviceService    _devices;

    public OverviewController(IAlertService alerts, IAgentService agents, IIdentityService identity, IDeviceService devices)
    {
        _alerts   = alerts;
        _agents   = agents;
        _identity = identity;
        _devices  = devices;
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();

        var alertCounts     = await _alerts.GetCountsAsync(tenantId, ct);
        var agentStats      = await _agents.GetStatsAsync(tenantId, ct: ct);
        var identitySummary = await _identity.GetSummaryAsync(tenantId, ct);
        var deviceSummary   = await _devices.GetSummaryAsync(tenantId, ct);

        return Ok(new
        {
            alerts         = alertCounts,
            agents         = agentStats,
            identity       = identitySummary,
            devices        = deviceSummary,
            lastUpdated    = DateTime.UtcNow,
        });
    }
}
