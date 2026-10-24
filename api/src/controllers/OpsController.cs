using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TenantWarden.Api.Controllers;

[ApiController]
[Route("api/v1")]
[Authorize]
public class OpsController : ControllerBase
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly ILogger<OpsController> _log;
    public OpsController(ILogger<OpsController> log) => _log = log;

    /// <summary>Trigger an immediate collection cycle on the collector service.</summary>
    [HttpPost("collect")]
    [Authorize(Policy = "SecurityTeam")]
    public async Task<IActionResult> TriggerCollection(CancellationToken ct)
    {
        try
        {
            var resp = await Http.PostAsync("http://collector-service:3001/collect", null, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            return StatusCode((int)resp.StatusCode, body);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to reach collector");
            return StatusCode(502, new { error = "collector unreachable" });
        }
    }

    /// <summary>Alert evaluation runs continuously in alert-engine; this ack keeps external triggers happy.</summary>
    [HttpPost("alerts/evaluate")]
    [AllowAnonymous]
    public IActionResult EvaluateAlerts() => Accepted(new { status = "alert engine evaluates continuously (60s loop)" });

    [HttpPost("analytics/analyze")]
    [AllowAnonymous]
    public IActionResult Analyze() => Accepted(new { status = "analytics engine runs continuously (5m loop)" });
}
