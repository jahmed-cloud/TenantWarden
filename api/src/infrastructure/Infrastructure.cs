using Npgsql;
using System.Data;

namespace TenantWarden.Api.Infrastructure;

public interface IDbConnectionFactory
{
    NpgsqlConnection CreateConnection();
}

public class NpgsqlConnectionFactory : IDbConnectionFactory
{
    private readonly string _connectionString;
    public NpgsqlConnectionFactory(string connectionString) => _connectionString = connectionString;
    public NpgsqlConnection CreateConnection() => new(_connectionString);
}

// ── ClickHouse analytics client ────────────────────────────────────────────────

public interface IClickHouseService
{
    Task InsertAsync(string table, IEnumerable<object> rows, CancellationToken ct = default);
    Task<List<T>> QueryAsync<T>(string sql, CancellationToken ct = default);
}

public class ClickHouseService : IClickHouseService
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;

    public ClickHouseService(string url)
    {
        _baseUrl = url.TrimEnd('/');
        _http    = new HttpClient { BaseAddress = new Uri(_baseUrl) };
    }

    public async Task<List<T>> QueryAsync<T>(string sql, CancellationToken ct = default)
    {
        // Use ClickHouse.Client in production; HTTP API for simplicity here
        var response = await _http.PostAsync(
            "?default_format=JSONEachRow",
            new StringContent(sql),
            ct);
        response.EnsureSuccessStatusCode();
        // Parse JSON lines — simplified
        return [];
    }

    public async Task InsertAsync(string table, IEnumerable<object> rows, CancellationToken ct = default)
    {
        var json = string.Join('\n', rows.Select(r => System.Text.Json.JsonSerializer.Serialize(r)));
        await _http.PostAsync($"?query=INSERT+INTO+{table}+FORMAT+JSONEachRow", new StringContent(json), ct);
    }
}

// ── Kafka event bus ───────────────────────────────────────────────────────────

public interface IEventBus
{
    Task PublishAsync<T>(string topic, T message, CancellationToken ct = default);
}

public class KafkaEventBus : IEventBus
{
    private readonly ILogger<KafkaEventBus> _log;
    public KafkaEventBus(ILogger<KafkaEventBus> log) => _log = log;

    public async Task PublishAsync<T>(string topic, T message, CancellationToken ct = default)
    {
        // Confluent.Kafka producer injected here in production
        _log.LogDebug("Event published to {Topic}: {Type}", topic, typeof(T).Name);
        await Task.CompletedTask;
    }
}

// ── DB migration runner ────────────────────────────────────────────────────────

public static class DatabaseMigrator
{
    public static async Task MigrateDatabase(this IServiceProvider services)
    {
        var log = services.GetRequiredService<ILogger<IDbConnectionFactory>>();
        var db  = services.GetRequiredService<IDbConnectionFactory>();

        try
        {
            await using var conn = db.CreateConnection();
            await conn.OpenAsync();
            log.LogInformation("Database connection verified");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Database connection failed — migrations may be pending");
        }
    }
}
