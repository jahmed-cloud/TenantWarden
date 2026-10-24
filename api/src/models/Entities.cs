using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TenantWarden.Api.Models;

// ─── Enumerations ─────────────────────────────────────────────────────────────

public enum AlertSeverity    { Critical = 1, High = 2, Medium = 3, Low = 4, Info = 5 }
public enum AlertStatus      { Active, Acknowledged, Investigating, Resolved, Suppressed }
public enum AlertSource
{
    [JsonStringEnumMemberName("entra_id")]
    EntraId,
    Defender, Intune, Purview, Exchange, SharePoint, Teams, Agent, Custom,

    /// <summary>
    /// Same value as <see cref="EntraId"/>; matches the Postgres label 'entra_id' so
    /// Dapper's case-insensitive Enum.Parse can read it. Write labels with <see cref="PgEnum.ToPg"/>.
    /// </summary>
    [System.ComponentModel.EditorBrowsable(System.ComponentModel.EditorBrowsableState.Never)]
    Entra_Id = EntraId,
}
public enum TenantStatus     { Active, Paused, Error, Provisioning }
public enum AgentStatus      { Online, Offline, Degraded, Provisioning }
public enum AgentPlatform    { Windows, Linux, MacOS, Docker, Kubernetes }
public enum IncidentSeverity { Critical = 1, High = 2, Medium = 3, Low = 4 }
public enum IncidentStatus   { Active, Contained, Investigating, Resolved }
public enum UserRiskLevel    { None, Low, Medium, High }

/// <summary>
/// One naming rule for enum values outside C#: the Postgres label, which is the member's
/// [JsonStringEnumMemberName] if it has one, else the lower-cased member name. ToPg() applies it
/// to SQL parameters (never use ToString().ToLower()); JsonConverter() applies it to API and
/// SignalR JSON, so clients see the same strings the database stores.
/// </summary>
public static class PgEnum
{
    /// <summary>The Postgres enum label for a C# enum value.</summary>
    public static string ToPg(this Enum value)
    {
        var name = value.ToString();
        return value.GetType().GetField(name)?.GetCustomAttribute<JsonStringEnumMemberNameAttribute>()?.Name
               ?? name.ToLowerInvariant();
    }

    /// <summary>Writes enums as their Postgres labels; still accepts labels, names or numbers on input.</summary>
    public static JsonStringEnumConverter JsonConverter() => new(new LowerCaseNamingPolicy());

    private sealed class LowerCaseNamingPolicy : JsonNamingPolicy
    {
        public override string ConvertName(string name) => name.ToLowerInvariant();
    }
}

// ─── Base entity ──────────────────────────────────────────────────────────────

public abstract class BaseEntity
{
    public Guid      Id        { get; init; } = Guid.NewGuid();
    public DateTime  CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime  UpdatedAt { get; set;  } = DateTime.UtcNow;
}

// ─── Tenant ───────────────────────────────────────────────────────────────────

public class Tenant : BaseEntity
{
    public required string        DisplayName   { get; set; }
    public required string        AzureTenantId { get; set; }
    public required string        Domain        { get; set; }
    public TenantStatus           Status        { get; set; } = TenantStatus.Provisioning;
    public string?                Description   { get; set; }
    public string?                LogoUrl       { get; set; }

    // Graph API credentials (encrypted at rest)
    public required string        ClientId      { get; set; }
    public required string        EncryptedClientSecret { get; set; }

    // Sync metadata
    public DateTime?              LastSyncAt    { get; set; }
    public string?                LastSyncError { get; set; }
    public int                    UserCount     { get; set; }
    public int                    DeviceCount   { get; set; }

    // Module enablement
    public List<string>           EnabledModules { get; set; } = [];

    // Navigation
    public ICollection<Alert>     Alerts   { get; set; } = [];
    public ICollection<TenantWarden.Api.Models.Agent> Agents { get; set; } = [];
}

// ─── Alert ────────────────────────────────────────────────────────────────────

public class Alert : BaseEntity
{
    public Guid            TenantId       { get; set; }
    public required string Title          { get; set; }
    public required string Description    { get; set; }
    public AlertSeverity   Severity       { get; set; }
    public AlertStatus     Status         { get; set; } = AlertStatus.Active;
    public AlertSource     Source         { get; set; }
    public required string Category       { get; set; }

    // Affected entities
    public List<string>    AffectedUsers   { get; set; } = [];
    public List<string>    AffectedDevices { get; set; } = [];
    public string?         AffectedIpAddress { get; set; }
    public string?         AffectedCountry   { get; set; }

    // Enrichment
    public string?         RecommendedAction { get; set; }
    public string?         AiInsight         { get; set; }
    public double?         RiskScore         { get; set; }
    public string?         ExternalId        { get; set; }  // Defender incident ID etc.

    // Assignment
    public string?         AssignedTo     { get; set; }
    public DateTime?       AcknowledgedAt { get; set; }
    public DateTime?       ResolvedAt     { get; set; }
    public string?         Resolution     { get; set; }

    // Additional context (JSON)
    public string?         Metadata       { get; set; }

    public Tenant?         Tenant         { get; set; }
}

// ─── Agent ────────────────────────────────────────────────────────────────────

public class Agent : BaseEntity
{
    public Guid            TenantId       { get; set; }
    public required string Hostname       { get; set; }
    public required string AgentId        { get; set; }   // UUID assigned at registration
    public AgentPlatform   Platform       { get; set; }
    public required string Version        { get; set; }
    public AgentStatus     Status         { get; set; } = AgentStatus.Provisioning;

    // System info
    public string?         OsName         { get; set; }
    public string?         OsVersion      { get; set; }
    public string?         Architecture   { get; set; }
    public string?         IpAddress      { get; set; }
    public string?         MacAddress     { get; set; }
    public string?         DomainName     { get; set; }

    // Auth (stored as hashes / public keys only)
    public required string JwtPublicKey   { get; set; }
    public required string Fingerprint    { get; set; }
    public DateTime?       LastSeenAt     { get; set; }
    public DateTime?       LastHeartbeatAt { get; set; }

    // Current metrics (latest snapshot)
    public double?         CpuPercent     { get; set; }
    public double?         MemoryPercent  { get; set; }
    public double?         DiskPercent    { get; set; }
    public string?         Tags           { get; set; }

    public Tenant?         Tenant         { get; set; }
}

// ─── User (platform user, not M365 user) ─────────────────────────────────────

public class PlatformUser : BaseEntity
{
    public required string Email         { get; set; }
    public required string DisplayName   { get; set; }
    public required string Role          { get; set; }  // matches UserRole enum
    public Guid?           TenantId      { get; set; }
    public string?         AzureObjectId { get; set; }
    public bool            IsActive      { get; set; } = true;
    public bool            MfaEnabled    { get; set; } = false;
    public string?         TotpSecret    { get; set; }
    public DateTime?       LastLoginAt   { get; set; }
    public string?         ApiKey        { get; set; }   // hashed
}

// ─── Risky User (from Entra ID Identity Protection) ──────────────────────────

public class RiskyUser : BaseEntity
{
    public Guid            TenantId          { get; set; }
    public required string AzureObjectId     { get; set; }
    public required string UserPrincipalName { get; set; }
    public required string DisplayName       { get; set; }
    public UserRiskLevel   RiskLevel         { get; set; }
    public string?         RiskDetail        { get; set; }
    public string?         CountryCode       { get; set; }
    public string?         IpAddress         { get; set; }
    public bool            IsDeleted         { get; set; }
    public bool            IsProcessed       { get; set; }
    public DateTime?       RiskLastUpdatedAt { get; set; }
}

// ─── Notification Channel ─────────────────────────────────────────────────────

public class NotificationChannel : BaseEntity
{
    public Guid            TenantId    { get; set; }
    public required string Name        { get; set; }
    public required string Type        { get; set; }  // teams | slack | email | webhook | pagerduty
    public required string Config      { get; set; }  // JSON config (encrypted sensitive values)
    public bool            IsEnabled   { get; set; } = true;
    public AlertSeverity   MinSeverity { get; set; } = AlertSeverity.Medium;
    public List<string>    Categories  { get; set; } = [];
}

// ─── Alert Rule ───────────────────────────────────────────────────────────────

public class AlertRule : BaseEntity
{
    public Guid            TenantId       { get; set; }
    public required string Name           { get; set; }
    public required string Description    { get; set; }
    public AlertSeverity   Severity       { get; set; }
    public AlertSource     Source         { get; set; }
    public required string Condition      { get; set; }  // JSON DSL
    public int             ThresholdValue { get; set; }
    public int             WindowMinutes  { get; set; }  // evaluation window
    public bool            IsEnabled      { get; set; } = true;
    public int             CooldownMinutes{ get; set; } = 60;
    public DateTime?       LastTriggeredAt{ get; set; }
    public List<Guid>      ChannelIds     { get; set; } = [];
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

public class AuditLog : BaseEntity
{
    public Guid            TenantId    { get; set; }
    public required string UserId      { get; set; }
    public required string UserEmail   { get; set; }
    public required string Action      { get; set; }
    public required string Resource    { get; set; }
    public string?         ResourceId  { get; set; }
    public string?         IpAddress   { get; set; }
    public string?         UserAgent   { get; set; }
    public string?         OldValue    { get; set; }  // JSON
    public string?         NewValue    { get; set; }  // JSON
    public bool            Success     { get; set; }
}
