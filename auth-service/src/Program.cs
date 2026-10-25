using TenantWarden.Auth.Config;
using TenantWarden.Auth.Services;
using StackExchange.Redis;
using TenantWarden.Auth.Middleware;
using Microsoft.AspNetCore.HttpOverrides;
using Serilog;

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;

Log.Logger = new LoggerConfiguration().WriteTo.Console().CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Host.UseSerilog((ctx, _, cfg) =>
        cfg.ReadFrom.Configuration(ctx.Configuration)
           .Enrich.FromLogContext()
           .Enrich.WithProperty("service", "tenantwarden-auth")
           .WriteTo.Console());

    builder.Services
        .AddAuthOptions(builder.Configuration)
        .AddAuthDatabase(builder.Configuration)
        .AddAuthCache(builder.Configuration)
        .AddAuthJwtBearer(builder.Configuration)
        .AddAuthServices()
        .AddControllers();

    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();
    builder.Services.AddHealthChecks()
        .AddNpgSql(builder.Configuration.GetConnectionString("Postgres")!)
        .AddRedis(builder.Configuration.GetConnectionString("Redis")!);

    var redisConn = builder.Configuration.GetConnectionString("Redis") ?? "redis:6379";
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));
    builder.Services.AddSingleton<ILoginThrottle, LoginThrottle>();

    // Only the nginx gateway can reach this service (no host port), so trust the
    // single hop it appends. Without this the login lockout keys on the gateway's
    // IP, which lets anyone lock out any account.
    builder.Services.Configure<ForwardedHeadersOptions>(opt =>
    {
        opt.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        opt.KnownNetworks.Clear();
        opt.KnownProxies.Clear();
    });

    builder.Services.AddCors(opt => opt.AddPolicy("auth", p =>
        p.WithOrigins(builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? [])
         .AllowAnyMethod().AllowAnyHeader().AllowCredentials()));

    var app = builder.Build();

    app.UseForwardedHeaders();
    app.UseSerilogRequestLogging();
    app.UseAuthExceptionHandler();

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI();
    }

    app.UseCors("auth");
    app.UseAuthentication();
    app.UseAuthorization();
    app.UseMiddleware<AuditMiddleware>();
    app.MapControllers();
    app.MapHealthChecks("/health");

    Log.Information("TenantWarden Auth Service starting");
    await app.RunAsync();
}
catch (Exception ex) { Log.Fatal(ex, "Auth service failed"); }
finally { await Log.CloseAndFlushAsync(); }
