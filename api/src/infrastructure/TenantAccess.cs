using System.Security.Claims;

namespace TenantWarden.Api.Infrastructure;

/// <summary>
/// Tenant scoping for platform users. super_admin can reach every tenant; every
/// other role only the tenant in its token's tenant_id claim (none if unset).
/// </summary>
public static class TenantAccess
{
    public const string SuperAdminRole = "super_admin";

    public static bool IsSuperAdmin(this ClaimsPrincipal user) => user.IsInRole(SuperAdminRole);

    public static Guid? HomeTenantId(this ClaimsPrincipal user)
        => Guid.TryParse(user.FindFirstValue("tenant_id"), out var id) ? id : null;

    public static bool CanAccessTenant(this ClaimsPrincipal user, Guid tenantId)
        => user.IsSuperAdmin() || user.HomeTenantId() == tenantId;

    /// <summary>
    /// Resolves an optional tenantId filter. super_admin may omit it (= all tenants);
    /// everyone else is pinned to their home tenant. False when the caller asked for
    /// a tenant they can't access, or has no tenant at all.
    /// </summary>
    public static bool TryScopeTenant(this ClaimsPrincipal user, Guid? requested, out Guid? scoped)
    {
        if (user.IsSuperAdmin()) { scoped = requested; return true; }
        scoped = user.HomeTenantId();
        return scoped is not null && (requested is null || requested == scoped);
    }

    /// <summary>Platform user id — JwtBearer maps "sub" to NameIdentifier on the way in.</summary>
    public static string UserId(this ClaimsPrincipal user)
        => user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub") ?? string.Empty;

    /// <summary>Who did something, as people read it: the email, else the user id.</summary>
    public static string Actor(this ClaimsPrincipal user)
        => user.FindFirstValue(ClaimTypes.Email) ?? user.FindFirstValue("email") ?? user.UserId();
}

/// <summary>
/// The portal's machine filter: ?agents=guid,guid (agent ids). Missing or empty means every machine.
/// </summary>
public static class AgentFilter
{
    public static Guid[]? Parse(string? agents)
    {
        if (string.IsNullOrWhiteSpace(agents)) return null;
        var ids = agents.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Select(s => Guid.TryParse(s, out var g) ? g : (Guid?)null)
                        .Where(g => g.HasValue).Select(g => g!.Value).Distinct().Take(1000).ToArray();
        // An unparseable filter matches nothing rather than everything
        return ids.Length == 0 ? [Guid.Empty] : ids;
    }

    /// <summary>ClickHouse Array(UUID) parameter value; empty array = no filter.</summary>
    public static string ToClickHouse(Guid[]? agents) =>
        "[" + string.Join(",", (agents ?? []).Select(g => $"'{g}'")) + "]";
}
