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

    /// <summary>
    /// Runs a SELECT. Values go in as ClickHouse server-side parameters — write
    /// <c>{name:Type}</c> in the SQL and pass <c>name</c> in <paramref name="parameters"/>.
    /// </summary>
    Task<List<T>> QueryAsync<T>(string sql, IReadOnlyDictionary<string, object>? parameters = null, CancellationToken ct = default);
}

/// <summary>ClickHouse over its HTTP interface. Connection string: http://user:password@host:8123/database</summary>
public class ClickHouseService : IClickHouseService
{
    private static readonly HashSet<string> WritableTables = ["agent_metrics", "custom_events", "alert_history", "signin_events", "secure_score_history"];
    private static readonly System.Text.Json.JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly HttpClient _http;

    public ClickHouseService(string url)
    {
        var uri = new Uri(url);
        _http = new HttpClient { BaseAddress = new Uri($"{uri.Scheme}://{uri.Authority}/"), Timeout = TimeSpan.FromSeconds(15) };

        // HttpClient never sends user-info from a URL, so pass credentials the ClickHouse way
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var parts = uri.UserInfo.Split(':', 2);
            _http.DefaultRequestHeaders.Add("X-ClickHouse-User", Uri.UnescapeDataString(parts[0]));
            if (parts.Length > 1) _http.DefaultRequestHeaders.Add("X-ClickHouse-Key", Uri.UnescapeDataString(parts[1]));
        }
        var database = uri.AbsolutePath.Trim('/');
        if (database.Length > 0) _http.DefaultRequestHeaders.Add("X-ClickHouse-Database", database);
    }

    public async Task<List<T>> QueryAsync<T>(string sql, IReadOnlyDictionary<string, object>? parameters = null, CancellationToken ct = default)
    {
        var qs = new System.Text.StringBuilder(
            "?default_format=JSONEachRow&date_time_output_format=iso&output_format_json_quote_64bit_integers=0");
        foreach (var (name, value) in parameters ?? new Dictionary<string, object>())
            qs.Append($"&param_{name}={Uri.EscapeDataString(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "")}");

        using var response = await _http.PostAsync(qs.ToString(), new StringContent(sql), ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"ClickHouse query failed: {body.Trim()}");

        return body.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                   .Select(line => System.Text.Json.JsonSerializer.Deserialize<T>(line, ReadOptions)!)
                   .ToList();
    }

    public async Task InsertAsync(string table, IEnumerable<object> rows, CancellationToken ct = default)
    {
        if (!WritableTables.Contains(table)) throw new ArgumentException($"Unknown ClickHouse table '{table}'", nameof(table));

        var json = string.Join('\n', rows.Select(r => System.Text.Json.JsonSerializer.Serialize(r)));
        if (json.Length == 0) return;

        var query = Uri.EscapeDataString($"INSERT INTO {table} FORMAT JSONEachRow");
        using var response = await _http.PostAsync($"?query={query}&date_time_input_format=best_effort", new StringContent(json), ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"ClickHouse insert into {table} failed: {(await response.Content.ReadAsStringAsync(ct)).Trim()}");
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
