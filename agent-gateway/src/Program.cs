using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography.X509Certificates;
using Dapper;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using StackExchange.Redis;
using Serilog;

Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;

Log.Logger = new LoggerConfiguration().WriteTo.Console().CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);

// ── Kestrel: HTTP always on 8082; HTTPS/mTLS on 4433 only if certs exist ──────
builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.ListenAnyIP(8082);

    try
    {
        var certPath = builder.Configuration["Tls:CertPath"];
        var keyPath  = builder.Configuration["Tls:KeyPath"];
        if (!string.IsNullOrEmpty(certPath) && File.Exists(certPath) &&
            !string.IsNullOrEmpty(keyPath)  && File.Exists(keyPath))
        {
            // Re-export via PFX — avoids ephemeral-key and PEM-parsing issues on Alpine
            using var pem = X509Certificate2.CreateFromPemFile(certPath, keyPath);
            var cert = new X509Certificate2(pem.Export(X509ContentType.Pfx));
            kestrel.ListenAnyIP(4433, o => o.UseHttps(cert));
            Log.Information("Agent gateway HTTPS enabled on :4433");
        }
        else
        {
            Log.Warning("TLS certs not found — HTTPS on :4433 disabled, HTTP only");
        }
    }
    catch (Exception ex)
    {
        Log.Warning(ex, "TLS setup failed — agent gateway running HTTP-only on :8082");
    }
});
builder.Host.UseSerilog((ctx, _, cfg) =>
    cfg.Enrich.WithProperty("service", "tenantwarden-agent-gw")
       .WriteTo.Console());

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"));

builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("Postgres")!)
    .AddRedis(builder.Configuration.GetConnectionString("Redis")!);

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30),
});

app.MapHealthChecks("/health");

// ── Agent authentication ──────────────────────────────────────────────────────
// Agents present an enrollment token minted by the API
// (POST /api/v1/agents/enrollment-tokens): an HS256 JWT signed with the shared
// JWT signing key, audience "tenantwarden-agent", carrying the tenant_id it is
// bound to. User access tokens (audience tenantwarden-api) are rejected here, and
// enrollment tokens are rejected by the API.

const string AgentTokenAudience = "tenantwarden-agent";
const int    MaxMessageBytes    = 1024 * 1024;

var signingKey = builder.Configuration["Auth:Jwt:SigningKey"];
TokenValidationParameters? agentTokenValidation = null;
if (string.IsNullOrEmpty(signingKey))
{
    Log.Error("Auth:Jwt:SigningKey is not set — every agent connection will be rejected");
}
else
{
    agentTokenValidation = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        ValidateIssuer           = true,
        ValidIssuer              = builder.Configuration["Auth:Jwt:Issuer"] ?? "tenantwarden",
        ValidateAudience         = true,
        ValidAudience            = AgentTokenAudience,
        ValidateLifetime         = true,
        ClockSkew                = TimeSpan.FromSeconds(30),
    };
}
var tokenHandler = new JsonWebTokenHandler();

// Internal endpoints (/command, /agents) are for other TenantWarden services only.
// They are disabled unless Agent:InternalApiToken is set, and callers must send
// it in X-Internal-Token. nginx does not route them either.
var internalApiToken = builder.Configuration["Agent:InternalApiToken"];

IResult? RejectUnlessInternal(HttpContext ctx)
{
    if (string.IsNullOrEmpty(internalApiToken)) return Results.NotFound();
    var supplied = ctx.Request.Headers["X-Internal-Token"].ToString();
    var ok = CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(internalApiToken));
    return ok ? null : Results.Unauthorized();
}

// ── In-memory agent connection registry ───────────────────────────────────────

var connections = new ConcurrentDictionary<string, WebSocket>();

// ── WebSocket endpoint ────────────────────────────────────────────────────────

app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    if (!Guid.TryParse(context.Request.Headers["X-Agent-ID"].FirstOrDefault(), out var agentGuid))
    {
        context.Response.StatusCode = 401;
        return;
    }
    var agentId = agentGuid.ToString();

    // ── Validate the enrollment token ─────────────────────────────────────────
    var auth  = context.Request.Headers.Authorization.ToString();
    var token = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth["Bearer ".Length..].Trim() : "";
    if (agentTokenValidation is null || token.Length == 0)
    {
        Log.Warning("Agent {AgentId} rejected: no token", agentId);
        context.Response.StatusCode = 401;
        return;
    }

    var validation = await tokenHandler.ValidateTokenAsync(token, agentTokenValidation);
    var tenantClaim = validation.IsValid ? validation.ClaimsIdentity.FindFirst("tenant_id")?.Value : null;
    if (!Guid.TryParse(tenantClaim, out var tenantGuid))
    {
        Log.Warning("Agent {AgentId} rejected: invalid token ({Reason})", agentId, validation.Exception?.Message ?? "no tenant_id");
        context.Response.StatusCode = 401;
        return;
    }
    var tenantId = tenantGuid.ToString();
    var redis    = context.RequestServices.GetRequiredService<IConnectionMultiplexer>().GetDatabase();

    var jti = validation.ClaimsIdentity.FindFirst("jti")?.Value;
    if (jti is not null && await redis.KeyExistsAsync($"agent_token_revoked:{jti}"))
    {
        Log.Warning("Agent {AgentId} rejected: token {Jti} revoked", agentId, jti);
        context.Response.StatusCode = 401;
        return;
    }

    // An agent ID belongs to the tenant it first connected with — stops a token
    // for one tenant from impersonating another tenant's agent.
    var bindKey = $"agent_tenant:{agentId}";
    await redis.StringSetAsync(bindKey, tenantId, when: When.NotExists);
    if (await redis.StringGetAsync(bindKey) != tenantId)
    {
        Log.Warning("Agent {AgentId} rejected: bound to a different tenant", agentId);
        context.Response.StatusCode = 403;
        return;
    }

    var claimedTenant = context.Request.Headers["X-Tenant-ID"].FirstOrDefault();
    if (!string.IsNullOrEmpty(claimedTenant) && !string.Equals(claimedTenant, tenantId, StringComparison.OrdinalIgnoreCase))
        Log.Warning("Agent {AgentId} sent X-Tenant-ID {Claimed} but its token is for {TenantId} — using the token", agentId, claimedTenant, tenantId);

    var ws = await context.WebSockets.AcceptWebSocketAsync();
    connections[agentId] = ws;

    Log.Information("Agent connected: {AgentId} tenant:{TenantId}", agentId, tenantId);

    // Update agent status in Redis
    await redis.StringSetAsync($"agent_heartbeat:{agentId}", DateTimeOffset.UtcNow.ToUnixTimeSeconds(), TimeSpan.FromSeconds(120));

    try
    {
        // Messages may span several frames — accumulate until EndOfMessage
        var buffer  = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (ws.State == WebSocketState.Open)
        {
            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                break;
            }

            message.Write(buffer, 0, result.Count);
            if (message.Length > MaxMessageBytes)
            {
                Log.Warning("Agent {AgentId} sent a message over {Max} bytes — closing", agentId, MaxMessageBytes);
                await ws.CloseAsync(WebSocketCloseStatus.MessageTooBig, "message too large", CancellationToken.None);
                break;
            }
            if (!result.EndOfMessage)
                continue;

            var json = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
            message.SetLength(0);
            await HandleAgentMessage(agentId, tenantId, json, redis);
        }
    }
    catch (WebSocketException) { /* connection dropped */ }
    finally
    {
        connections.TryRemove(agentId, out _);
        Log.Information("Agent disconnected: {AgentId}", agentId);
        await redis.KeyDeleteAsync($"agent_heartbeat:{agentId}");
    }
});

// ── Internal HTTP endpoint to push commands to agents ─────────────────────────

app.MapPost("/command/{agentId}", async (string agentId, HttpContext ctx) =>
{
    if (RejectUnlessInternal(ctx) is { } rejected) return rejected;

    if (!connections.TryGetValue(agentId, out var ws) || ws.State != WebSocketState.Open)
        return Results.NotFound(new { error = "Agent not connected" });

    var body    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
    var payload = Encoding.UTF8.GetBytes(body);
    await ws.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
    return Results.Ok(new { sent = true });
});

app.MapGet("/agents/connected", (HttpContext ctx) =>
    RejectUnlessInternal(ctx) ?? Results.Ok(new { count = connections.Count, agents = connections.Keys }));

Log.Information("TenantWarden Agent Gateway starting");
await app.RunAsync();

// ── Message handler ───────────────────────────────────────────────────────────

static async Task HandleAgentMessage(string agentId, string tenantId, string json, IDatabase redis)
{
    try
    {
        if (JsonNode.Parse(json) is not JsonObject msg) return;

        // Stamp the identity the gateway verified — never forward the ids the agent wrote itself
        msg["agent_id"]  = agentId;
        msg["tenant_id"] = tenantId;
        var type     = msg["type"] is JsonValue v && v.TryGetValue<string>(out var t) ? t : null;
        var verified = msg.ToJsonString();

        switch (type)
        {
            case "heartbeat":
                await redis.StringSetAsync($"agent_heartbeat:{agentId}", DateTimeOffset.UtcNow.ToUnixTimeSeconds(), TimeSpan.FromSeconds(120));
                break;

            case "metrics":
                // Forward to analytics via Redis pub/sub
                await redis.PublishAsync(RedisChannel.Literal("tenantwarden:agent_metrics"), verified);
                break;

            case "event":
                await redis.PublishAsync(RedisChannel.Literal("tenantwarden:agent_events"), verified);
                break;

            case "registration":
                await redis.PublishAsync(RedisChannel.Literal("tenantwarden:agent_registration"), verified);
                Log.Information("Agent registered: {AgentId}", agentId);
                break;
        }
    }
    catch (JsonException ex)
    {
        Log.Warning(ex, "Malformed message from agent {AgentId}", agentId);
    }
}
