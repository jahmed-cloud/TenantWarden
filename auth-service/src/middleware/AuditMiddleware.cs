using System.Security.Claims;
using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;
using TenantWarden.Auth.Config;

namespace TenantWarden.Auth.Middleware;

/// <summary>
/// Audits account changes made by a signed-in user (user admin, password, MFA, API keys) to
/// audit_logs, like the API's AuditLogMiddleware. Logins are written by UserService.
/// </summary>
public class AuditMiddleware
{
    private static readonly HashSet<string> Methods = ["POST", "PUT", "PATCH", "DELETE"];
    private static readonly string[] Skipped = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/msal"];
    private readonly RequestDelegate _next;

    public AuditMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, IOptions<DatabaseOptions> db, ILogger<AuditMiddleware> log)
    {
        await _next(ctx);

        var path = ctx.Request.Path.Value ?? "";
        if (!Methods.Contains(ctx.Request.Method) || ctx.User.Identity?.IsAuthenticated != true
            || Skipped.Any(s => path.Equals(s, StringComparison.OrdinalIgnoreCase))) return;

        var values = ctx.Request.RouteValues;
        try
        {
            await using var conn = new NpgsqlConnection(db.Value.Postgres);
            await conn.ExecuteAsync(
                @"INSERT INTO audit_logs (tenant_id, user_id, user_email, action, resource, resource_id, ip_address, user_agent, success)
                  SELECT @tenantId, @userId, @email, @action, @resource, @resourceId, @ip::inet, @agent, @success
                  WHERE @tenantId IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = @tenantId)",
                new
                {
                    tenantId   = Guid.TryParse(ctx.User.FindFirstValue("tenant_id"), out var t) ? t : (Guid?)null,
                    userId     = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown",
                    email      = ctx.User.FindFirstValue(ClaimTypes.Email) ?? ctx.User.FindFirstValue("email") ?? "",
                    action     = $"{ctx.Request.Method.ToLowerInvariant()} {values["action"]?.ToString()?.ToLowerInvariant() ?? path}",
                    resource   = values["controller"]?.ToString()?.ToLowerInvariant() ?? "auth",
                    resourceId = values["id"]?.ToString(),
                    ip         = ctx.Connection.RemoteIpAddress?.ToString(),
                    agent      = ctx.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua[..Math.Min(ua.Length, 300)] : null,
                    success    = ctx.Response.StatusCode < 400,
                });
        }
        catch (Exception ex)
        {
            log.LogWarning("Audit log write failed for {Method} {Path}: {Error}", ctx.Request.Method, path, ex.Message);
        }
    }
}
