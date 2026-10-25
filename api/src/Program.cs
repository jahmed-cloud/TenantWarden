using TenantWarden.Api.Config;
using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Middleware;
using TenantWarden.Api.Hubs;
using TenantWarden.Api.Models;
using Microsoft.AspNetCore.HttpOverrides;
using Serilog;

// ─── Bootstrap logger ─────────────────────────────────────────────────────────
Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
// Postgres TEXT[] → C# List<string> (see StringListTypeHandler at end of file).
Dapper.SqlMapper.AddTypeHandler(new StringListTypeHandler());

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // ── Serilog ───────────────────────────────────────────────────────────────
    builder.Host.UseSerilog((ctx, services, cfg) =>
        cfg.ReadFrom.Configuration(ctx.Configuration)
           .ReadFrom.Services(services)
           .Enrich.FromLogContext()
           .Enrich.WithProperty("service", "tenantwarden-api")
           .WriteTo.Console());

    // ── Services ──────────────────────────────────────────────────────────────
    builder.Services
        .AddTenantWardenOptions(builder.Configuration)
        .AddTenantWardenDatabase(builder.Configuration)
        .AddTenantWardenAuth(builder.Configuration)
        .AddTenantWardenCache(builder.Configuration)
        .AddTenantWardenKafka(builder.Configuration)
        .AddTenantWardenStorage(builder.Configuration)
        .AddTenantWardenServices(builder.Configuration)
        .AddTenantWardenBackgroundJobs(builder.Configuration)
        .AddTenantWardenObservability()
        .AddTenantWardenHealthChecks(builder.Configuration);

    // Enums go over the wire as their Postgres labels ("high", "entra_id"), which is what the frontend
    // expects; inet columns as plain address strings.
    builder.Services.AddSignalR().AddJsonProtocol(o =>
    {
        o.PayloadSerializerOptions.Converters.Add(PgEnum.JsonConverter());
        o.PayloadSerializerOptions.Converters.Add(new IPAddressJsonConverter());
    });
    builder.Services.AddControllers().AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(PgEnum.JsonConverter());
        o.JsonSerializerOptions.Converters.Add(new IPAddressJsonConverter());
    });
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddTenantWardenSwagger();

    // Only the nginx gateway can reach the API (no host port), so trust the single
    // hop it appends: ForwardLimit 1 takes the rightmost X-Forwarded-For entry,
    // which nginx sets to the real client address.
    builder.Services.Configure<ForwardedHeadersOptions>(opt =>
    {
        opt.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        opt.KnownNetworks.Clear();
        opt.KnownProxies.Clear();
    });

    builder.Services.AddCors(opt => opt.AddPolicy("tenantwarden", policy =>
        policy.WithOrigins(builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? [])
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials()));

    // ── Build ─────────────────────────────────────────────────────────────────
    var app = builder.Build();

    await app.Services.MigrateDatabase();

    app.UseForwardedHeaders();
    app.UseSerilogRequestLogging();
    app.UseTenantWardenExceptionHandler();

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "TenantWarden API v1"));
    }

    app.UseHttpsRedirection();
    app.UseCors("tenantwarden");
    app.UseAuthentication();
    app.UseAuthorization();
    app.UseTenantWardenAuditLog();
    // Rate limiting is done per client IP by the nginx gateway (api_limit / auth_limit zones)

    // ── Routing ───────────────────────────────────────────────────────────────
    app.MapControllers();
    app.MapHub<TenantWardenHub>("/ws/hub");
    app.MapHealthChecks("/health");
    app.MapPrometheusScrapingEndpoint("/metrics");

    Log.Information("TenantWarden API starting on {Urls}", app.Urls);
    await app.RunAsync();
}
catch (Exception ex)
{
    Log.Fatal(ex, "TenantWarden API terminated unexpectedly");
    Environment.ExitCode = 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}

// ── Dapper: map Postgres TEXT[] to List<string> ───────────────────────────────
// Without this, any query mapping a text-array column (e.g. tenants.enabled_modules)
// into a List<string> property throws "Error parsing column".
public class StringListTypeHandler : Dapper.SqlMapper.TypeHandler<List<string>>
{
    public override List<string> Parse(object value) => value switch
    {
        string[] arr   => [.. arr],
        List<string> l => l,
        _              => [],
    };

    public override void SetValue(System.Data.IDbDataParameter parameter, List<string>? value)
        => parameter.Value = value?.ToArray() ?? System.Array.Empty<string>();
}

// ── JSON: Postgres INET → string ──────────────────────────────────────────────
// Npgsql returns inet columns (risky_users.ip_address, audit_logs.ip_address, …) as
// IPAddress, which System.Text.Json can't serialise: its ScopeId getter throws for IPv4.
public class IPAddressJsonConverter : System.Text.Json.Serialization.JsonConverter<System.Net.IPAddress>
{
    public override System.Net.IPAddress? Read(ref System.Text.Json.Utf8JsonReader reader, Type typeToConvert, System.Text.Json.JsonSerializerOptions options)
        => System.Net.IPAddress.TryParse(reader.GetString(), out var ip) ? ip : null;

    public override void Write(System.Text.Json.Utf8JsonWriter writer, System.Net.IPAddress value, System.Text.Json.JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString());
}
