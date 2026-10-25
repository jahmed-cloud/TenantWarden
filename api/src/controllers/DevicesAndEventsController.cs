using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

// GET api/v1/devices/summary is served by DeviceSummaryController (chart shape the UI uses);
// a second "summary" action here made that route ambiguous.
[ApiController]
[Route("api/v1/[controller]")]
[Authorize]
public class DevicesController : ControllerBase
{
    private readonly IDeviceService _devices;
    public DevicesController(IDeviceService devices) => _devices = devices;

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] Guid    tenantId,
        [FromQuery] string? search,
        [FromQuery] string? compliance,          // compliant | noncompliant
        [FromQuery] int     page     = 1,
        [FromQuery] int     pageSize = 50,
        CancellationToken ct = default)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        return Ok(await _devices.ListAsync(tenantId, page, pageSize, search, compliance, ct));
    }

    [HttpGet("{deviceId}")]
    public async Task<IActionResult> Get(string deviceId, [FromQuery] Guid tenantId, CancellationToken ct)
    {
        if (!User.CanAccessTenant(tenantId)) return Forbid();
        var device = await _devices.GetByIdAsync(tenantId, deviceId, ct);
        return device is null ? NotFound() : Ok(device);
    }
}

// ── Custom event ingestion ─────────────────────────────────────────────────────

[ApiController]
[Route("api/v1/events")]
[Authorize]
public class EventsController : ControllerBase
{
    private readonly IClickHouseService _ch;
    private readonly ILogger<EventsController> _log;

    public EventsController(IClickHouseService ch, ILogger<EventsController> log)
    {
        _ch  = ch;
        _log = log;
    }

    // POST /api/v1/events  — custom data ingestion endpoint (SIEM, Splunk, etc.)
    // Events land in the caller's tenant; super_admin must name one with ?tenantId=.
    [HttpPost]
    public async Task<IActionResult> Ingest([FromBody] List<CustomEvent> events, [FromQuery] Guid? tenantId, CancellationToken ct)
    {
        if (!events.Any()) return BadRequest(new { error = "No events provided" });
        if (events.Count > 1000) return BadRequest(new { error = "Max 1000 events per request" });
        if (!User.TryScopeTenant(tenantId, out var scoped)) return Forbid();
        if (scoped is null) return BadRequest(new { error = "tenantId is required" });

        var rows = events.Select(e => new
        {
            tenant_id   = scoped.Value.ToString(),
            source      = e.Source,
            event_type  = e.EventType,
            occurred_at = e.OccurredAt ?? DateTime.UtcNow,
            severity    = e.Severity ?? "info",
            message     = e.Message,
            data        = System.Text.Json.JsonSerializer.Serialize(e.Data),
        });

        await _ch.InsertAsync("custom_events", rows, ct);

        _log.LogInformation("Ingested {Count} custom events from {Source}", events.Count, events.FirstOrDefault()?.Source);
        return Accepted(new { ingested = events.Count });
    }
}

public record CustomEvent(
    string                          Source,
    string                          EventType,
    string                          Message,
    DateTime?                       OccurredAt = null,
    string?                         Severity   = null,
    Dictionary<string, object>?     Data       = null);
