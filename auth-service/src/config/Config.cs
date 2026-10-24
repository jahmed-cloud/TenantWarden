using System.Text;
using TenantWarden.Auth.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace TenantWarden.Auth.Config;

public class JwtOptions
{
    public string SigningKey             { get; set; } = "";
    public string Issuer                { get; set; } = "tenantwarden";
    public string Audience              { get; set; } = "tenantwarden-api";
    public int    AccessTokenExpiryMinutes { get; set; } = 15;
    public int    RefreshTokenExpiryDays   { get; set; } = 7;
}

public class DatabaseOptions
{
    public string Postgres { get; set; } = "";
    public string Redis    { get; set; } = "";
}

public static class ServiceExtensions
{
    public static IServiceCollection AddAuthOptions(this IServiceCollection services, IConfiguration cfg)
    {
        services.Configure<JwtOptions>(cfg.GetSection("Auth:Jwt"));
        services.Configure<DatabaseOptions>(cfg.GetSection("ConnectionStrings"));
        return services;
    }

    public static IServiceCollection AddAuthDatabase(this IServiceCollection services, IConfiguration cfg)
    {
        // Npgsql registered via options; Dapper used directly in services
        return services;
    }

    public static IServiceCollection AddAuthCache(this IServiceCollection services, IConfiguration cfg)
    {
        var redisConn = cfg.GetConnectionString("Redis") ?? "localhost:6379";
        services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));
        return services;
    }

    /// <summary>
    /// Registers JWT bearer validation so [Authorize] endpoints work.
    /// Without this, [Authorize] throws "No authenticationScheme was specified".
    /// </summary>
    public static IServiceCollection AddAuthJwtBearer(this IServiceCollection services, IConfiguration cfg)
    {
        var key = cfg["Auth:Jwt:SigningKey"]
                  ?? throw new InvalidOperationException("Auth:Jwt:SigningKey is required");

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(opt =>
                {
                    opt.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey        = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                        ValidateIssuer          = true,
                        ValidIssuer             = cfg["Auth:Jwt:Issuer"]   ?? "tenantwarden",
                        ValidateAudience        = true,
                        ValidAudience           = cfg["Auth:Jwt:Audience"] ?? "tenantwarden-api",
                        ValidateLifetime        = true,
                        ClockSkew               = TimeSpan.FromSeconds(30),
                    };
                });

        services.AddAuthorization();
        return services;
    }

    public static IServiceCollection AddAuthServices(this IServiceCollection services)
    {
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<ITokenService, TokenService>();
        services.AddSingleton<IMfaService, MfaService>();
        return services;
    }
}
