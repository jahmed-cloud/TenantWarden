using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Models;
using TenantWarden.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class AlertsController : ControllerBase
{
    private readonly IAlertService _alerts;
    private readonly ILogger<AlertsController> _log;

    public AlertsController(IAlertService alerts, ILogger<AlertsController> log)
    {
        _alerts = alerts;
        _log    = log;
    }

    // GET /api/v1/alerts
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] Guid?          tenantId,
        [FromQuery] AlertSeverity? severity,
        [FromQuery] AlertStatus?   status,
        [FromQuery] AlertSource?   source,
        [FromQuery] string?        search,
        [FromQuery] int            page     = 1,
        [FromQuery] int            pageSize = 50,
        CancellationToken          ct       = default)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();

        var result = await _alerts.ListAsync(new AlertQuery
        {
            TenantId = scoped,
            Severity = severity,
            Status   = status,
            Source   = source,
            Search   = search,
            Page     = page,
            PageSize = Math.Min(pageSize, 200),
        }, ct);

        return Ok(result);
    }

    // GET /api/v1/alerts/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var alert = await _alerts.GetByIdAsync(id, ct);
        return alert is null || !User.CanAccessTenant(alert.TenantId) ? NotFound() : Ok(alert);
    }

    // POST /api/v1/alerts/{id}/acknowledge
    [HttpPost("{id:guid}/acknowledge")]
    [Authorize(Roles = "soc_analyst,security_admin,org_admin,super_admin")]
    public async Task<IActionResult> Acknowledge(Guid id, [FromBody] AcknowledgeRequest req, CancellationToken ct)
    {
        if (!await CanAccessAlertAsync(id, ct)) return NotFound();
        var userId = User.UserId();
        await _alerts.AcknowledgeAsync(id, userId, req.Comment, ct);
        _log.LogInformation("Alert {AlertId} acknowledged by {UserId}", id, userId);
        return NoContent();
    }

    // POST /api/v1/alerts/{id}/resolve
    [HttpPost("{id:guid}/resolve")]
    [Authorize(Roles = "soc_analyst,security_admin,org_admin,super_admin")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveRequest req, CancellationToken ct)
    {
        if (!await CanAccessAlertAsync(id, ct)) return NotFound();
        var userId = User.UserId();
        await _alerts.ResolveAsync(id, userId, req.Resolution, ct);
        _log.LogInformation("Alert {AlertId} resolved by {UserId}", id, userId);
        return NoContent();
    }

    // POST /api/v1/alerts/{id}/assign
    [HttpPost("{id:guid}/assign")]
    [Authorize(Roles = "security_admin,org_admin,super_admin")]
    public async Task<IActionResult> Assign(Guid id, [FromBody] AssignRequest req, CancellationToken ct)
    {
        if (!await CanAccessAlertAsync(id, ct)) return NotFound();
        await _alerts.AssignAsync(id, req.AssigneeId, ct);
        return NoContent();
    }

    // GET /api/v1/alerts/counts
    [HttpGet("counts")]
    public async Task<IActionResult> Counts([FromQuery] Guid? tenantId, CancellationToken ct)
    {
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();
        var counts = await _alerts.GetCountsAsync(scoped, ct);
        return Ok(counts);
    }

    // POST /api/v1/alerts  (create custom alert — e.g. from custom data ingestion)
    [HttpPost]
    [Authorize(Roles = "security_admin,org_admin,super_admin,api_user")]
    public async Task<IActionResult> Create([FromBody] CreateAlertRequest req, CancellationToken ct)
    {
        if (!User.CanAccessTenant(req.TenantId)) return Forbid();
        var alert = await _alerts.CreateAsync(req, ct);
        return CreatedAtAction(nameof(Get), new { id = alert.Id }, alert);
    }

    // DELETE /api/v1/alerts/{id}
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "org_admin,super_admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        if (!await CanAccessAlertAsync(id, ct)) return NotFound();
        await _alerts.DeleteAsync(id, ct);
        return NoContent();
    }

    private async Task<bool> CanAccessAlertAsync(Guid id, CancellationToken ct)
    {
        var alert = await _alerts.GetByIdAsync(id, ct);
        return alert is not null && User.CanAccessTenant(alert.TenantId);
    }
}

// ─── Request / Response DTOs ──────────────────────────────────────────────────

public record AlertQuery
{
    public Guid?          TenantId { get; init; }
    public AlertSeverity? Severity { get; init; }
    public AlertStatus?   Status   { get; init; }
    public AlertSource?   Source   { get; init; }
    public string?        Search   { get; init; }
    public int            Page     { get; init; } = 1;
    public int            PageSize { get; init; } = 50;
}

public record AcknowledgeRequest(string? Comment);
public record ResolveRequest(string Resolution);
public record AssignRequest(string AssigneeId);

public record CreateAlertRequest(
    Guid          TenantId,
    string        Title,
    string        Description,
    AlertSeverity Severity,
    AlertSource   Source,
    string        Category,
    List<string>? AffectedUsers   = null,
    List<string>? AffectedDevices = null,
    string?       Metadata        = null
);
