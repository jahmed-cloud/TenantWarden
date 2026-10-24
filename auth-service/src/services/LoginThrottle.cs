using StackExchange.Redis;

namespace TenantWarden.Auth.Services;

public interface ILoginThrottle
{
    Task<bool> IsLockedAsync(string key);
    Task<int>  RegisterFailureAsync(string key);
    Task ResetAsync(string key);
}

/// <summary>
/// Redis-backed brute-force protection: after MaxAttempts failed logins for a
/// given key (email+IP) within the window, the account is locked for LockMinutes.
/// </summary>
public class LoginThrottle : ILoginThrottle
{
    private const int MaxAttempts = 5;
    private const int LockMinutes = 15;
    private readonly IDatabase _db;

    public LoginThrottle(IConnectionMultiplexer redis) => _db = redis.GetDatabase();

    private static string CountKey(string k) => $"login_fail:{k}";
    private static string LockKey(string k)  => $"login_lock:{k}";

    public async Task<bool> IsLockedAsync(string key)
        => await _db.KeyExistsAsync(LockKey(key));

    public async Task<int> RegisterFailureAsync(string key)
    {
        var count = await _db.StringIncrementAsync(CountKey(key));
        if (count == 1)
            await _db.KeyExpireAsync(CountKey(key), TimeSpan.FromMinutes(LockMinutes));

        if (count >= MaxAttempts)
        {
            await _db.StringSetAsync(LockKey(key), "1", TimeSpan.FromMinutes(LockMinutes));
            await _db.KeyDeleteAsync(CountKey(key));
        }
        return (int)count;
    }

    public async Task ResetAsync(string key)
    {
        await _db.KeyDeleteAsync(CountKey(key));
        await _db.KeyDeleteAsync(LockKey(key));
    }
}
