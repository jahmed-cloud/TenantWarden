using System.Net.Http.Json;

namespace TenantWarden.Api.Services;

/// <summary>
/// Identity remediation runs in collector-service, which already holds each tenant's
/// Graph credentials. Needs the tenant's app registration to have
/// IdentityRiskyUser.ReadWrite.All (dismiss / confirm compromised) and
/// User.RevokeSessions.All (revoke sessions).
/// </summary>
public interface IRemediationClient
{
    Task<RemediationResult> RunAsync(Guid tenantId, string action, string azureObjectId, CancellationToken ct = default);
}

public record RemediationResult(bool Ok, string? Error);

public class RemediationClient : IRemediationClient
{
    public static readonly HashSet<string> Actions = ["dismiss", "confirm-compromised", "revoke-sessions"];
    private readonly HttpClient _http;

    public RemediationClient(HttpClient http) => _http = http;

    public async Task<RemediationResult> RunAsync(Guid tenantId, string action, string azureObjectId, CancellationToken ct = default)
    {
        try
        {
            using var response = await _http.PostAsJsonAsync("remediate", new { tenantId, action, userId = azureObjectId }, ct);
            var body = await response.Content.ReadFromJsonAsync<Dictionary<string, object?>>(cancellationToken: ct);
            return response.IsSuccessStatusCode
                ? new RemediationResult(true, null)
                : new RemediationResult(false, body?.GetValueOrDefault("error")?.ToString() ?? $"Collector returned {(int)response.StatusCode}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new RemediationResult(false, "Collector service is unreachable");
        }
    }
}
