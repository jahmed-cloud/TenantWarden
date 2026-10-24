namespace TenantWarden.Auth.Middleware;

public static class ExceptionMiddlewareExtensions
{
    public static IApplicationBuilder UseAuthExceptionHandler(this IApplicationBuilder app)
        => app.UseExceptionHandler(err => err.Run(async ctx =>
        {
            ctx.Response.StatusCode  = 500;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsJsonAsync(new { error = "An unexpected error occurred" });
        }));
}
