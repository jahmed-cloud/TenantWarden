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
            if (resp.StatusCode == System.Net.HttpStatusCode.Conflict)
                return Conflict(new { error = "A collection is already running; new data appears when it finishes" });
            var body = await resp.Content.ReadAsStringAsync(ct);
            return StatusCode((int)resp.StatusCode, body);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to reach collector");
            return StatusCode(502, new { error = "collector unreachable" });
        }
    }
}
