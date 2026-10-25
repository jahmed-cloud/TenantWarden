using TenantWarden.Api.Hubs;
using TenantWarden.Api.Services;
using TenantWarden.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
using Minio;
using Hangfire;
using Hangfire.PostgreSql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using System.Text;

namespace TenantWarden.Api.Config;

public static class ServiceRegistration
{
    public static IServiceCollection AddTenantWardenOptions(this IServiceCollection s, IConfiguration cfg)
    {
        s.Configure<AppOptions>(cfg.GetSection("App"));
        s.Configure<StorageOptions>(cfg.GetSection("Storage:MinIO"));
        return s;
    }

    public static IServiceCollection AddTenantWardenDatabase(this IServiceCollection s, IConfiguration cfg)
    {
        s.AddSingleton<IDbConnectionFactory>(new NpgsqlConnectionFactory(
            cfg.GetConnectionString("Postgres") ?? throw new InvalidOperationException("Postgres connection required")));
        s.AddSingleton<IClickHouseService>(new ClickHouseService(
            cfg.GetConnectionString("ClickHouse") ?? "http://clickhouse:8123"));
        return s;
    }

    public static IServiceCollection AddTenantWardenAuth(this IServiceCollection s, IConfiguration cfg)
    {
        var jwtKey = cfg["Auth:Jwt:SigningKey"] ?? throw new InvalidOperationException("JWT signing key required");

        // Bearer JWT for people, X-API-Key for integrations — one policy scheme picks per request
        s.AddAuthentication(opt =>
         {
             opt.DefaultScheme          = "BearerOrApiKey";
             opt.DefaultChallengeScheme = "BearerOrApiKey";
         })
         .AddPolicyScheme("BearerOrApiKey", "Bearer token or API key", opt =>
             opt.ForwardDefaultSelector = ctx => ctx.Request.Headers.ContainsKey(ApiKeyAuthenticationHandler.HeaderName)
                 ? ApiKeyAuthenticationHandler.SchemeName
                 : JwtBearerDefaults.AuthenticationScheme)
         .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(
             ApiKeyAuthenticationHandler.SchemeName, null)
         .AddJwtBearer(opt =>
         {
             opt.TokenValidationParameters = new TokenValidationParameters
             {
                 ValidateIssuerSigningKey = true,
                 IssuerSigningKey        = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
                 ValidateIssuer          = true,
                 ValidIssuer             = cfg["Auth:Jwt:Issuer"] ?? "tenantwarden",
                 ValidateAudience        = true,
                 ValidAudience           = cfg["Auth:Jwt:Audience"] ?? "tenantwarden-api",
                 ValidateLifetime        = true,
                 ClockSkew               = TimeSpan.FromSeconds(30),
             };

             opt.Events = new JwtBearerEvents
             {
                 OnMessageReceived = ctx =>
                 {
                     var token = ctx.Request.Query["token"].ToString();
                     if (!string.IsNullOrEmpty(token) && ctx.Request.Path.StartsWithSegments("/ws"))
                         ctx.Token = token;
                     return Task.CompletedTask;
                 }
             };
         });

        s.AddAuthorization(opt =>
        {
            opt.AddPolicy("AdminOnly",    p => p.RequireRole("super_admin", "org_admin"));
            opt.AddPolicy("SecurityTeam", p => p.RequireRole("super_admin", "org_admin", "security_admin", "soc_analyst"));
            opt.AddPolicy("ReadOnly",     p => p.RequireAuthenticatedUser());
        });

        return s;
    }

    public static IServiceCollection AddTenantWardenCache(this IServiceCollection s, IConfiguration cfg)
    {
        var connStr = cfg.GetConnectionString("Redis") ?? "localhost:6379";
        s.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(connStr));
        // Distributed cache for session / response caching
        s.AddStackExchangeRedisCache(opt => opt.Configuration = connStr);
        return s;
    }

    public static IServiceCollection AddTenantWardenKafka(this IServiceCollection s, IConfiguration cfg)
    {
        s.Configure<KafkaOptions>(cfg.GetSection("Kafka"));
        s.AddSingleton<IEventBus, KafkaEventBus>();
        return s;
    }

    public static IServiceCollection AddTenantWardenStorage(this IServiceCollection s, IConfiguration cfg)
    {
        s.AddMinio(opt =>
        {
            opt.WithEndpoint(cfg["Storage:MinIO:Endpoint"] ?? "minio:9000")
               .WithCredentials(cfg["Storage:MinIO:AccessKey"]!, cfg["Storage:MinIO:SecretKey"]!);
        });
        return s;
    }

    public static IServiceCollection AddTenantWardenServices(this IServiceCollection s, IConfiguration cfg)
    {
        s.AddHttpClient<IRemediationClient, RemediationClient>(c =>
        {
            c.BaseAddress = new Uri(cfg["Collector:Url"] ?? "http://collector-service:3001/");
            c.Timeout     = TimeSpan.FromSeconds(30);
        });
        s.AddHttpClient<IAlertEngineClient, AlertEngineClient>(c =>
        {
            c.BaseAddress = new Uri(cfg["AlertEngine:Url"] ?? "http://alert-engine:3002/");
            c.Timeout     = TimeSpan.FromSeconds(15);
        });
        s.AddHostedService<AgentTelemetryConsumer>();
        s.AddScoped<IAlertService, AlertService>();
        s.AddScoped<IIdentityService, IdentityService>();
        s.AddScoped<IDeviceService, DeviceService>();
        s.AddScoped<ITenantService, TenantService>();
        s.AddScoped<IAgentService, AgentService>();
        s.AddScoped<IAnalyticsService, AnalyticsService>();
        s.AddScoped<IComplianceService, ComplianceService>();
        s.AddScoped<INotificationService, NotificationService>();
        s.AddScoped<ISearchService, SearchService>();
        s.AddSingleton<ITenantWardenHubPublisher, TenantWardenHubPublisher>();
        return s;
    }

    public static IServiceCollection AddTenantWardenBackgroundJobs(this IServiceCollection s, IConfiguration cfg)
    {
        var connStr = cfg.GetConnectionString("Postgres")!;
        s.AddHangfire(hf => hf
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(o => o.UseNpgsqlConnection(connStr)));

        s.AddHangfireServer(opt =>
        {
            opt.WorkerCount = Environment.ProcessorCount * 2;
            opt.Queues      = ["critical", "default", "low"];
        });

        return s;
    }

    public static IServiceCollection AddTenantWardenObservability(this IServiceCollection s)
    {
        // OpenTelemetry.Extensions.Hosting provides AddOpenTelemetry() on IServiceCollection
        s.AddOpenTelemetry()
         .WithMetrics(m => m
             .AddAspNetCoreInstrumentation()
             .AddHttpClientInstrumentation()
             .AddRuntimeInstrumentation()
             .AddPrometheusExporter())
         .WithTracing(t => t
             .AddAspNetCoreInstrumentation()
             .AddHttpClientInstrumentation());
        return s;
    }

    public static IServiceCollection AddTenantWardenHealthChecks(this IServiceCollection s, IConfiguration cfg)
    {
        s.AddHealthChecks()
         .AddNpgSql(cfg.GetConnectionString("Postgres")!, name: "postgres")
         .AddRedis(cfg.GetConnectionString("Redis")!,    name: "redis")
         .AddUrlGroup(new Uri("http://clickhouse:8123/ping"), name: "clickhouse");
        return s;
    }

    public static IServiceCollection AddTenantWardenSwagger(this IServiceCollection s)
    {
        s.AddSwaggerGen(opt =>
        {
            opt.SwaggerDoc("v1", new() { Title = "TenantWarden API", Version = "v1" });
            opt.AddSecurityDefinition("Bearer", new()
            {
                Type         = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
                Scheme       = "bearer",
                BearerFormat = "JWT",
            });
            opt.AddSecurityRequirement(new()
            {
                [new() { Reference = new() { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" } }] = []
            });
        });
        return s;
    }
}

public class AppOptions     { public string Edition { get; set; } = "Community"; public string Version { get; set; } = "1.0.0"; }
public class StorageOptions { public string Endpoint { get; set; } = ""; public string AccessKey { get; set; } = ""; public string SecretKey { get; set; } = ""; }
public class KafkaOptions   { public string BootstrapServers { get; set; } = "kafka:9092"; }
