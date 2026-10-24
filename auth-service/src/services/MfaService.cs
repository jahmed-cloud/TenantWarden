using OtpNet;
using System.Security.Cryptography;

namespace TenantWarden.Auth.Services;

public interface IMfaService
{
    (string Secret, string QrUri) GenerateTotpSetup(string email, string issuer = "TenantWarden");
    bool ValidateTotp(string secret, string code);
    string GenerateBackupCode();
    bool ValidateBackupCode(string storedHash, string code);
}

public class MfaService : IMfaService
{
    public (string Secret, string QrUri) GenerateTotpSetup(string email, string issuer = "TenantWarden")
    {
        var key    = KeyGeneration.GenerateRandomKey(20);
        var secret = Base32Encoding.ToString(key);
        var uri    = new OtpUri(OtpType.Totp, secret, email, issuer).ToString();
        return (secret, uri);
    }

    public bool ValidateTotp(string secret, string code)
    {
        try
        {
            var key  = Base32Encoding.ToBytes(secret);
            var totp = new Totp(key);
            return totp.VerifyTotp(code, out _, new VerificationWindow(previous: 1, future: 1));
        }
        catch { return false; }
    }

    public string GenerateBackupCode()
    {
        var bytes = new byte[5];
        RandomNumberGenerator.Fill(bytes);
        var code = Convert.ToHexString(bytes).ToUpper();
        // Format as XXXXX-XXXXX
        return $"{code[..5]}-{code[5..]}";
    }

    public bool ValidateBackupCode(string storedHash, string code)
        => BCrypt.Net.BCrypt.Verify(code.Replace("-", "").ToUpper(), storedHash);
}
