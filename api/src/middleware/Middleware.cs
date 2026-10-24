using System.Diagnostics;
using System.Security.Claims;
using TenantWarden.Api.Services;

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

public class AuditLogMiddleware
{
    private static readonly HashSet<string> _auditedMethods = ["POST", "PUT", "PATCH", "DELETE"];
    private readonly RequestDelegate _next;

    public AuditLogMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, IAuditService audit)
    {
        await _next(ctx);

        if (_auditedMethods.Contains(ctx.Request.Method) && ctx.Response.StatusCode < 400)
        {
            var userId    = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous";
            var userEmail = ctx.User.FindFirstValue(ClaimTypes.Email) ?? "";
            var tenantId  = ctx.User.FindFirstValue("tenant_id");
            var ip        = ctx.Connection.RemoteIpAddress?.ToString() ?? "";

            // Fire and forget — don't slow down the request
            _ = Task.Run(async () =>
            {
                try
                {
                    // In production, write to audit_logs table via IAuditService
                    var log = ctx.RequestServices.GetRequiredService<ILogger<AuditLogMiddleware>>();
                    log.LogInformation(
                        "AUDIT {Method} {Path} user:{UserId} tenant:{TenantId} status:{Status}",
                        ctx.Request.Method, ctx.Request.Path, userId, tenantId, ctx.Response.StatusCode);
                }
                catch { /* audit must never crash the app */ }
            });
        }
    }
}

public static class AuditMiddlewareExtensions
{
    public static IApplicationBuilder UseTenantWardenAuditLog(this IApplicationBuilder app)
        => app.UseMiddleware<AuditLogMiddleware>();
}
