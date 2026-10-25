using System.Net.Http.Json;
using System.Text.Json;

namespace TenantWarden.Api.Services;

/// <summary>
/// alert-engine owns the metric catalogue and the query language (KQL-style, compiled to
/// read-only SQL scoped to one tenant). The API checks the caller's role and tenant, then asks it.
/// </summary>
public interface IAlertEngineClient
{
    /// <summary>{ metrics, templates, datasets } — cached for five minutes.</summary>
    Task<JsonElement> GetCatalogueAsync(CancellationToken ct = default);
    Task<MetricInfo?> GetMetricAsync(string metric, CancellationToken ct = default);
    Task<string?> ValidateQueryAsync(string query, CancellationToken ct = default);
    /// <summary>Runs a query; returns alert-engine's status code and JSON body unchanged.</summary>
    Task<(int Status, string Json)> RunQueryAsync(Guid tenantId, string query, int? windowMinutes, int limit, Guid[]? agents = null, CancellationToken ct = default);
}

public record MetricInfo(string Metric, string Source, bool Windowed, bool HasParam);

public class AlertEngineUnavailableException(string message) : Exception(message);

public class AlertEngineClient : IAlertEngineClient
{
    private static readonly SemaphoreSlim CacheLock = new(1, 1);
    private static JsonElement? _catalogue;
    private static DateTime _cachedAt;

    private readonly HttpClient _http;
    public AlertEngineClient(HttpClient http) => _http = http;

    public async Task<JsonElement> GetCatalogueAsync(CancellationToken ct = default)
    {
        if (_catalogue is { } fresh && DateTime.UtcNow - _cachedAt < TimeSpan.FromMinutes(5)) return fresh;
        await CacheLock.WaitAsync(ct);
        try
        {
            if (_catalogue is { } again && DateTime.UtcNow - _cachedAt < TimeSpan.FromMinutes(5)) return again;
            var json = await Send(() => _http.GetFromJsonAsync<JsonElement>("catalogue", ct));
            _catalogue = json.Clone();
            _cachedAt  = DateTime.UtcNow;
            return _catalogue.Value;
        }
        finally { CacheLock.Release(); }
    }

    public async Task<MetricInfo?> GetMetricAsync(string metric, CancellationToken ct = default)
    {
        var catalogue = await GetCatalogueAsync(ct);
        foreach (var m in catalogue.GetProperty("metrics").EnumerateArray())
            if (m.GetProperty("metric").GetString() == metric)
                return new MetricInfo(metric, m.GetProperty("source").GetString() ?? "custom",
                    m.GetProperty("windowed").GetBoolean(), m.TryGetProperty("param", out var p) && p.ValueKind == JsonValueKind.Object);
        return null;
    }

    public async Task<string?> ValidateQueryAsync(string query, CancellationToken ct = default)
    {
        var result = await Send(async () =>
        {
            using var response = await _http.PostAsJsonAsync("query/validate", new { query }, ct);
            return await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
        });
        return result.GetProperty("ok").GetBoolean() ? null : result.GetProperty("error").GetString();
    }

    public async Task<(int Status, string Json)> RunQueryAsync(Guid tenantId, string query, int? windowMinutes, int limit, Guid[]? agents = null, CancellationToken ct = default)
    {
        return await Send(async () =>
        {
            using var response = await _http.PostAsJsonAsync("query", new { tenantId, query, windowMinutes, limit, agents }, ct);
            return ((int)response.StatusCode, await response.Content.ReadAsStringAsync(ct));
        });
    }

    private static async Task<T> Send<T>(Func<Task<T>> call)
    {
        try { return await call(); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            throw new AlertEngineUnavailableException("The alert engine is unreachable; check the alert-engine container");
        }
    }
}
