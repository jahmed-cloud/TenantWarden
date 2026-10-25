using System.Diagnostics;
using System.Security.Claims;
using Dapper;
using TenantWarden.Api.Infrastructure;

namespace TenantWarden.Api.Middleware;

// ─── Exception handler ────────────────────────────────────────────────────────

public static class ExceptionMiddlewareExtensions
{
    public static IApplicationBuilder UseTenantWardenExceptionHandler(this IApplicationBuilder app)
        => app.UseExceptionHandler(err => err.Run(async ctx =>
        {
            ctx.Response.StatusCode  = 500;
            ctx.Response.ContentType = "application/json";
            var log = ctx.RequestServices.GetRequiredService<ILogger<IApplicationBuilder>>();
            log.LogError("Unhandled exception on {Path}", ctx.Request.Path);
            await ctx.Response.WriteAsJsonAsync(new { error = "An unexpected error occurred", traceId = Activity.Current?.Id });
        }));
}

// ─── Audit log middleware ─────────────────────────────────────────────────────

/// <summary>
/// Writes one audit_logs row per authenticated change (POST/PUT/PATCH/DELETE), including
/// refused ones. Logins are audited by auth-service. High-volume ingestion endpoints are skipped.
/// </summary>
public class AuditLogMiddleware
{
    private static readonly HashSet<string> _auditedMethods = ["POST", "PUT", "PATCH", "DELETE"];
    private static readonly string[] _skippedPaths = ["/api/v1/events", "/heartbeat"];
    private readonly RequestDelegate _next;

    public AuditLogMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, IDbConnectionFactory db, ILogger<AuditLogMiddleware> log)
    {
        await _next(ctx);

        if (!_auditedMethods.Contains(ctx.Request.Method) || ctx.User.Identity?.IsAuthenticated != true) return;
        var path = ctx.Request.Path.Value ?? "";
        if (_skippedPaths.Any(p => path.Contains(p, StringComparison.OrdinalIgnoreCase))) return;

        var values     = ctx.Request.RouteValues;
        var resource   = values["controller"]?.ToString()?.ToLowerInvariant() ?? "api";
        var action     = $"{ctx.Request.Method.ToLowerInvariant()} {values["action"]?.ToString()?.ToLowerInvariant() ?? path}";
        var resourceId = (values["id"] ?? values["userId"] ?? values["agentId"] ?? values["tokenId"])?.ToString();
        var tenantId   = Guid.TryParse(ctx.User.FindFirstValue("tenant_id"), out var t) ? t
                       : Guid.TryParse(ctx.Request.Query["tenantId"], out var q) ? q : (Guid?)null;

        try
        {
            await using var conn = db.CreateConnection();
            await conn.ExecuteAsync(
                @"INSERT INTO audit_logs (tenant_id, user_id, user_email, action, resource, resource_id, ip_address, user_agent, success)
                  SELECT @tenantId, @userId, @email, @action, @resource, @resourceId, @ip::inet, @agent, @success
                  WHERE @tenantId IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = @tenantId)",
                new
                {
                    tenantId,
                    userId     = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown",
                    email      = ctx.User.FindFirstValue(ClaimTypes.Email) ?? ctx.User.FindFirstValue("email") ?? "",
                    action, resource, resourceId,
                    ip         = ctx.Connection.RemoteIpAddress?.ToString(),
                    agent      = ctx.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua[..Math.Min(ua.Length, 300)] : null,
                    success    = ctx.Response.StatusCode < 400,
                });
        }
        catch (Exception ex)
        {
            // Auditing must never fail the request that was already handled
            log.LogWarning("Audit log write failed for {Method} {Path}: {Error}", ctx.Request.Method, path, ex.Message);
        }
    }
}

public static class AuditMiddlewareExtensions
{
    public static IApplicationBuilder UseTenantWardenAuditLog(this IApplicationBuilder app)
        => app.UseMiddleware<AuditLogMiddleware>();
}
