namespace TenantWarden.Auth.Models;

public class PlatformUser
{
    public Guid     Id             { get; set; }
    public string   Email          { get; set; } = "";
    public string   DisplayName    { get; set; } = "";
    public string   Role           { get; set; } = "viewer";
    public Guid?    TenantId       { get; set; }
    public string?  AzureObjectId  { get; set; }
    public string?  PasswordHash   { get; set; }
    public bool     IsActive       { get; set; } = true;
    public bool     MfaEnabled     { get; set; } = false;
    public string?  TotpSecret     { get; set; }
    public string?  ApiKeyHash     { get; set; }
    public DateTime? LastLoginAt   { get; set; }
    public bool     MustChangePassword { get; set; } = false;
    public DateTime CreatedAt      { get; set; }
    public DateTime UpdatedAt      { get; set; }

    public UserProfile ToProfile() => new(Id, Email, DisplayName, Role, TenantId, MfaEnabled, LastLoginAt, MustChangePassword);
}

public record UserProfile(Guid Id, string Email, string DisplayName, string Role, Guid? TenantId, bool MfaEnabled, DateTime? LastLoginAt, bool MustChangePassword = false);
