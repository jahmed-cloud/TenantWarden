using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TenantWarden.Api.Infrastructure;
using TenantWarden.Api.Models;

namespace TenantWarden.Api.Hubs;

[Authorize]
public class TenantWardenHub : Hub
{
    private readonly ILogger<TenantWardenHub> _log;

    public TenantWardenHub(ILogger<TenantWardenHub> log) => _log = log;

    public override async Task OnConnectedAsync()
    {
        var userId   = Context.User?.UserId() ?? "unknown";
        var tenantId = Context.GetHttpContext()?.Request.Query["tenantId"].ToString();
        if (!string.IsNullOrEmpty(tenantId))
        {
            if (Guid.TryParse(tenantId, out var tid) && Context.User?.CanAccessTenant(tid) == true)
                await Groups.AddToGroupAsync(Context.ConnectionId, $"tenant:{tid}");
            else
                _log.LogWarning("Client {ConnectionId} user:{UserId} denied tenant:{TenantId}", Context.ConnectionId, userId, tenantId);
        }

        _log.LogInformation("Client connected: {ConnectionId} user:{UserId} tenant:{TenantId}",
            Context.ConnectionId, userId, tenantId);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _log.LogInformation("Client disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // Client calls this to subscribe to specific alert severities
    public async Task SubscribeToSeverity(string severity)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"severity:{severity.ToLower()}");
    }

    // Client joins a specific tenant room
    public async Task JoinTenant(string tenantId)
    {
        if (!Guid.TryParse(tenantId, out var tid) || Context.User?.CanAccessTenant(tid) != true)
            throw new HubException("Access to this tenant is denied");

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, "all_tenants");
        await Groups.AddToGroupAsync(Context.ConnectionId, $"tenant:{tid}");
    }
}

// ─── Hub event publisher — injected into services ─────────────────────────────

public interface ITenantWardenHubPublisher
{
    Task PublishLiveStats(string tenantId, object stats, CancellationToken ct = default);
    Task PublishAlert(string tenantId, Alert alert, CancellationToken ct = default);
    Task PublishAgentStatus(string tenantId, object agentUpdate, CancellationToken ct = default);
    Task PublishServiceHealth(string tenantId, object health, CancellationToken ct = default);
}

public class TenantWardenHubPublisher : ITenantWardenHubPublisher
{
    private readonly IHubContext<TenantWardenHub> _hub;

    public TenantWardenHubPublisher(IHubContext<TenantWardenHub> hub) => _hub = hub;

    public Task PublishLiveStats(string tenantId, object stats, CancellationToken ct = default) =>
        _hub.Clients.Group($"tenant:{tenantId}").SendAsync("live_stats", stats, ct);

    public Task PublishAlert(string tenantId, Alert alert, CancellationToken ct = default) =>
        _hub.Clients.Group($"tenant:{tenantId}").SendAsync(
            alert.Status == AlertStatus.Active ? "alert_created" : "alert_updated",
            new { alert.Id, alert.Title, alert.Severity, alert.Status, alert.Source, alert.CreatedAt },
            ct);

    public Task PublishAgentStatus(string tenantId, object agentUpdate, CancellationToken ct = default) =>
        _hub.Clients.Group($"tenant:{tenantId}").SendAsync("agent_status", agentUpdate, ct);

    public Task PublishServiceHealth(string tenantId, object health, CancellationToken ct = default) =>
        _hub.Clients.Group($"tenant:{tenantId}").SendAsync("service_health", health, ct);
}
