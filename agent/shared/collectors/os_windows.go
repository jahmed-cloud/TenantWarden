package collectors

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
	"unicode/utf16"

	"go.uber.org/zap"
)

type windowsCollector struct {
	log *zap.Logger
}

// NewOSCollector returns the Windows collector (Event Log, Defender, BitLocker, firewall,
// Windows Update, installed software). The Security log needs the agent to run as SYSTEM
// or an administrator; without it those events are skipped.
func NewOSCollector(log *zap.Logger) OSCollector {
	return &windowsCollector{log: log}
}

const psPrelude = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`

const inventoryScript = psPrelude + `
$inv = [ordered]@{ collected_at = (Get-Date).ToUniversalTime().ToString('o') }
$os = Get-CimInstance Win32_OperatingSystem
$inv.os_caption = $os.Caption
$inv.os_build   = $os.BuildNumber
if ($os.LastBootUpTime) { $inv.last_boot = $os.LastBootUpTime.ToUniversalTime().ToString('o') }
$cs = Get-CimInstance Win32_ComputerSystem
$inv.domain = $cs.Domain
$inv.domain_joined = [bool]$cs.PartOfDomain

$hf = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
if ($hf) { $inv.last_patch = $hf.InstalledOn.ToString('yyyy-MM-dd'); $inv.last_patch_id = $hf.HotFixID }

$mp = Get-MpComputerStatus
if ($mp) {
  $inv.defender = [ordered]@{
    antivirus_enabled   = [bool]$mp.AntivirusEnabled
    realtime_protection = [bool]$mp.RealTimeProtectionEnabled
    tamper_protection   = [bool]$mp.IsTamperProtected
    signature_age_days  = [int]$mp.AntivirusSignatureAge
    quick_scan_age_days = [int]$mp.QuickScanAge
  }
}

$inv.firewall = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ profile = "$($_.Name)"; enabled = ("$($_.Enabled)" -eq 'True') } })

$bl = Get-BitLockerVolume
if ($bl) {
  $inv.bitlocker = @($bl | ForEach-Object { [ordered]@{ volume = "$($_.MountPoint)"; protection = "$($_.ProtectionStatus)"; status = "$($_.VolumeStatus)"; percent = [int]$_.EncryptionPercentage } })
} else {
  # Without admin rights the shell property still says whether C: is protected
  $p = (New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection')
  $state = switch ($p) { 1 {'On'} 6 {'On'} 2 {'Off'} 3 {'Encrypting'} 4 {'Decrypting'} default {'Unknown'} }
  $inv.bitlocker = @([ordered]@{ volume = 'C:'; protection = $state })
}

$sys = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$inv.uac_enabled = ($sys.EnableLUA -eq 1)
$ts = Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server'
$inv.rdp_enabled = ($ts.fDenyTSConnections -eq 0)

$inv.admin_users = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { "$($_.Name)" })
$inv.services_running = @(Get-CimInstance Win32_Service -Filter "State='Running'").Count
$inv.listening_ports = @(Get-NetTCPConnection -State Listen | ForEach-Object { "tcp $($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique | Select-Object -First 100)

$apps = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent } | Sort-Object DisplayName -Unique
$inv.software_count = @($apps).Count
$inv.software = @($apps | Select-Object -First 300 | ForEach-Object { [ordered]@{ name = "$($_.DisplayName)"; version = "$($_.DisplayVersion)"; publisher = "$($_.Publisher)" } })

$inv | ConvertTo-Json -Depth 4 -Compress
`

// The update search can take minutes on a cold cache, so it runs on its own timeout.
const updatesScript = psPrelude + `
$r = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software' and IsHidden=0")
[ordered]@{
  pending_updates          = $r.Updates.Count
  pending_security_updates = @($r.Updates | Where-Object { $_.MsrcSeverity }).Count
  pending_update_titles    = @($r.Updates | Select-Object -First 20 | ForEach-Object { $_.Title })
} | ConvertTo-Json -Compress
`

func (c *windowsCollector) Inventory(ctx context.Context) (map[string]any, error) {
	out, err := powershell(ctx, 2*time.Minute, inventoryScript)
	if err != nil {
		return nil, fmt.Errorf("inventory script: %w", err)
	}
	inv := map[string]any{}
	if err := json.Unmarshal([]byte(out), &inv); err != nil {
		return nil, fmt.Errorf("inventory output: %w", err)
	}
	if out, err := powershell(ctx, 5*time.Minute, updatesScript); err == nil {
		var upd map[string]any
		if json.Unmarshal([]byte(out), &upd) == nil {
			for k, v := range upd {
				inv[k] = v
			}
		}
	} else {
		c.log.Debug("Windows Update search failed", zap.Error(err))
	}
	return inv, nil
}

// eventsCore reads System/Application errors, selected Security events and Defender detections
// since $since. Failed logons (4625) are counted per source and folded into one event in Go.
// SQL Server providers are skipped here and read by the SQL section with their own rules.
const eventsCore = `
$out = New-Object System.Collections.ArrayList
function Add-Event($level, $source, $message, $time) {
  if (-not $message) { return }
  [void]$out.Add([ordered]@{ level = $level; source = "$source"; message = "$message"; occurred_at = $time.ToUniversalTime().ToString('o') })
}
function Level-Of($e, $fixed) {
  if ($fixed -and $fixed -ne 'auto') { return $fixed }
  switch ($e.Level) { 1 {'critical'} 2 {'error'} 3 {'warning'} default {'info'} }
}
function Text-Of($e) { if ($e.Message) { $e.Message } else { "Event $($e.Id) from $($e.ProviderName)" } }

Get-WinEvent -FilterHashtable @{ LogName = 'System','Application'; Level = 1,2; StartTime = $since } -MaxEvents 200 |
  ForEach-Object { if ($sqlProviders -contains $_.ProviderName) { return }; Add-Event $(if ($_.Level -eq 1) {'critical'} else {'error'}) $_.ProviderName $_.Message $_.TimeCreated }

$failed = @{}
Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625,4720,4732,4740,1102; StartTime = $since } -MaxEvents 2000 | ForEach-Object {
  $p = $_.Properties
  switch ($_.Id) {
    4625 { $from = "$($p[19].Value)"; if (-not $from -or $from -eq '-') { $from = "account $($p[5].Value)" }; $failed[$from] = 1 + [int]$failed[$from] }
    1102 { Add-Event 'critical' 'Security' 'The Security audit log was cleared' $_.TimeCreated }
    4720 { Add-Event 'warning' 'Security' "User account $($p[0].Value) created by $($p[4].Value)" $_.TimeCreated }
    4732 {
      $level = if ("$($p[4].Value)" -eq 'S-1-5-32-544') {'critical'} else {'warning'}
      Add-Event $level 'Security' "$($p[1].Value) added to local group $($p[2].Value) by $($p[6].Value)" $_.TimeCreated
    }
    4740 { Add-Event 'warning' 'Security' "Account $($p[0].Value) locked out (caller $($p[1].Value))" $_.TimeCreated }
  }
}

Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1006,1116,1117,5001; StartTime = $since } -MaxEvents 100 |
  ForEach-Object { Add-Event 'critical' 'Windows Defender' (($_.Message -split [Environment]::NewLine)[0..6] -join ' ') $_.TimeCreated }
`

// sqlSection reads the Application log entries of the discovered SQL Server instances: failed
// logins (18456) counted per client, storage / log-full / scheduler errors as critical, the rest
// by level. Event source "SQL Server".
const sqlSection = `
$sqlFailed = @{}
if ($sqlProviders.Count -gt 0) {
  Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = $sqlProviders; StartTime = $since } -MaxEvents 1000 | ForEach-Object {
    if ($_.Id -eq 18456) {
      $m = [regex]::Match("$($_.Message)", '\[CLIENT: ([^\]]+)\]')
      $client = if ($m.Success) { $m.Groups[1].Value } else { 'unknown' }
      $sqlFailed[$client] = 1 + [int]$sqlFailed[$client]
    } elseif (@(823, 824, 825, 9002, 1105, 17883, 17884, 17888) -contains $_.Id) {
      Add-Event 'critical' 'SQL Server' "$($_.ProviderName): $(Text-Of $_)" $_.TimeCreated
    } elseif ($_.Level -ge 1 -and $_.Level -le 3) {
      Add-Event (Level-Of $_ 'auto') 'SQL Server' "$($_.ProviderName): $(Text-Of $_)" $_.TimeCreated
    }
  }
}
`

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func psList(items []string) string {
	quoted := make([]string, len(items))
	for i, it := range items {
		quoted[i] = psQuote(it)
	}
	return "@(" + strings.Join(quoted, ", ") + ")"
}

// eventsScript assembles the built-in queries, the SQL Server section and one query per extra
// channel. Get-WinEvent takes at most ~20 event IDs per query, so long ID lists are split.
func eventsScript(since time.Time, extra EventSources) string {
	var b strings.Builder
	b.WriteString(psPrelude)
	fmt.Fprintf(&b, "$since = [DateTimeOffset]::FromUnixTimeSeconds(%d).LocalDateTime\n", since.Unix())
	fmt.Fprintf(&b, "$sqlProviders = %s\n", psList(extra.SQLProviders))
	b.WriteString(eventsCore)
	b.WriteString(sqlSection)
	for _, ch := range extra.Channels {
		query := func(filter string) {
			fmt.Fprintf(&b, "Get-WinEvent -FilterHashtable @{ LogName = %s; StartTime = $since; %s } -MaxEvents 200 | ForEach-Object { Add-Event (Level-Of $_ %s) %s (Text-Of $_) $_.TimeCreated }\n",
				psQuote(ch.Channel), filter, psQuote(ch.Level), psQuote(ch.Channel))
		}
		if len(ch.IDs) == 0 {
			query("Level = 1,2,3")
			continue
		}
		for i := 0; i < len(ch.IDs); i += 20 {
			ids := make([]string, 0, 20)
			for _, id := range ch.IDs[i:min(i+20, len(ch.IDs))] {
				ids = append(ids, fmt.Sprint(id))
			}
			query("Id = " + strings.Join(ids, ","))
		}
	}
	b.WriteString("[ordered]@{ events = $out; failed_logins = $failed; sql_failed = $sqlFailed } | ConvertTo-Json -Depth 4 -Compress\n")
	return b.String()
}

func (c *windowsCollector) Events(ctx context.Context, since time.Time, extra EventSources) ([]Event, error) {
	out, err := powershell(ctx, 2*time.Minute, eventsScript(since, extra))
	if err != nil {
		return nil, fmt.Errorf("event log script: %w", err)
	}
	var res struct {
		Events       json.RawMessage `json:"events"`
		FailedLogins map[string]int  `json:"failed_logins"`
		SQLFailed    map[string]int  `json:"sql_failed"`
	}
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		return nil, fmt.Errorf("event log output: %w", err)
	}
	var events []Event
	if err := decodeList(string(res.Events), &events); err != nil {
		return nil, fmt.Errorf("event list: %w", err)
	}
	for i := range events {
		events[i].Message = truncate(events[i].Message, 1000)
	}
	now := time.Now().UTC()
	events = append(events, bruteForce("Security", res.FailedLogins, now)...)
	return append(events, bruteForce("SQL Server", res.SQLFailed, now)...), nil
}

// discoverScript finds server roles from the installed services, SQL Server instances from the
// registry, and machine certificates. Roles that run on every Windows edition (file sharing,
// print spooler, Remote Desktop) only count on servers.
const discoverScript = psPrelude + `
$os = Get-CimInstance Win32_OperatingSystem
$server = $os.ProductType -ne 1
$svcs = @{}
Get-CimInstance Win32_Service | ForEach-Object { $svcs[$_.Name] = $_ }
$work = New-Object System.Collections.ArrayList
function Startup-Of($s) { switch ("$($s.StartMode)") { 'Auto' {'auto'} 'Manual' {'manual'} 'Disabled' {'disabled'} default {"$($s.StartMode)".ToLower()} } }
function Add-Role($type, $name, $svc, $version, $details) {
  [void]$work.Add([ordered]@{ type = $type; name = $name; status = $(if ($svc.State -eq 'Running') {'running'} else {'stopped'});
    startup = (Startup-Of $svc); version = $version; details = $details })
}

$sqlProviders = New-Object System.Collections.ArrayList
$inst = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
if ($inst) {
  foreach ($p in ($inst.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' })) {
    $name = $p.Name; $id = $p.Value
    $svcName = if ($name -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { 'MSSQL$' + $name }
    $agentName = if ($name -eq 'MSSQLSERVER') { 'SQLSERVERAGENT' } else { 'SQLAgent$' + $name }
    $svc = $svcs[$svcName]
    if (-not $svc) { continue }
    $root = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$id"
    $setup = Get-ItemProperty "$root\Setup"
    $tcp = Get-ItemProperty "$root\MSSQLServer\SuperSocketNetLib\Tcp\IPAll"
    $agent = $svcs[$agentName]
    Add-Role 'sqlserver' $name $svc "$($setup.Version)" ([ordered]@{
      edition = "$($setup.Edition)"; port = $(if ($tcp.TcpPort) { "$($tcp.TcpPort)" } else { "$($tcp.TcpDynamicPorts)" })
      sql_agent = $(if ($agent) { "$($agent.State)".ToLower() } else { 'not installed' }); data_root = "$($setup.SQLDataRoot)"; service = $svcName })
    [void]$sqlProviders.Add($svcName)
  }
}

$roles = @(
  @('iis', 'W3SVC', 'IIS'), @('adds', 'NTDS', 'Active Directory Domain Services'), @('dns', 'DNS', 'DNS Server'),
  @('dhcp', 'DHCPServer', 'DHCP Server'), @('hyperv', 'vmms', 'Hyper-V'), @('adcs', 'CertSvc', 'AD Certificate Services'),
  @('wsus', 'WsusService', 'WSUS'), @('exchange', 'MSExchangeIS', 'Exchange Server'), @('ssrs', 'SQLServerReportingServices', 'SQL Server Reporting Services'),
  @('ssis', 'MsDtsServer*', 'SQL Server Integration Services'), @('docker', 'docker', 'Docker'), @('mysql', 'MySQL*', 'MySQL'),
  @('postgresql', 'postgresql*', 'PostgreSQL'), @('mongodb', 'MongoDB', 'MongoDB'), @('redis', 'Redis', 'Redis'), @('tomcat', 'Tomcat*', 'Apache Tomcat')
)
if ($server) { $roles += @(@('fileserver', 'LanmanServer', 'File Server'), @('printspooler', 'Spooler', 'Print Spooler'), @('rds', 'TermService', 'Remote Desktop Services')) }
foreach ($r in $roles) {
  foreach ($svc in @($svcs.Values | Where-Object { $_.Name -like $r[1] })) {
    $details = [ordered]@{ service = $svc.Name }
    # (continue inside a switch would only leave the switch, so the share check sits outside it)
    if ($r[0] -eq 'fileserver') { $shares = @(Get-SmbShare | Where-Object { -not $_.Special }).Count; if ($shares -eq 0) { continue }; $details.shares = $shares }
    switch ($r[0]) {
      'iis' { $appcmd = "$env:windir\system32\inetsrv\appcmd.exe"; if (Test-Path $appcmd) { $details.sites = @(& $appcmd list site 2>$null).Count } }
      'adds' { $details.domain = (Get-CimInstance Win32_ComputerSystem).Domain }
      'hyperv' { $details.vms = @(Get-VM).Count }
    }
    Add-Role $r[0] $(if ($svc.DisplayName) { $svc.DisplayName } else { $r[2] }) $svc '' $details
  }
}

$certs = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.NotAfter -gt (Get-Date).AddDays(-30) } | Select-Object -First 50 | ForEach-Object {
  [ordered]@{ subject = $_.Subject; issuer = $_.Issuer; expires = $_.NotAfter.ToUniversalTime().ToString('o');
    days_left = [int][Math]::Floor(($_.NotAfter - (Get-Date)).TotalDays); self_signed = ($_.Subject -eq $_.Issuer); location = 'LocalMachine\My' }
})

[ordered]@{ workloads = $work; sql_providers = $sqlProviders; certificates = $certs } | ConvertTo-Json -Depth 5 -Compress
`

// Event channels the discovered roles write their own errors to.
var roleChannels = map[string][]string{
	"adds":   {"Directory Service", "DFS Replication"},
	"dns":    {"DNS Server"},
	"hyperv": {"Microsoft-Windows-Hyper-V-VMMS-Admin"},
	"adcs":   {"Microsoft-Windows-CertificationAuthority/Operational"},
}

func (c *windowsCollector) Discover(ctx context.Context) Discovery {
	var d Discovery
	out, err := powershell(ctx, 90*time.Second, discoverScript)
	if err != nil {
		c.log.Debug("Workload discovery failed", zap.Error(err))
		return d
	}
	var res struct {
		Workloads    json.RawMessage `json:"workloads"`
		SQLProviders json.RawMessage `json:"sql_providers"`
		Certificates json.RawMessage `json:"certificates"`
	}
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		c.log.Debug("Workload discovery output", zap.Error(err))
		return d
	}
	_ = decodeList(string(res.Workloads), &d.Workloads)
	_ = decodeList(string(res.SQLProviders), &d.SQLProviders)
	_ = decodeList(string(res.Certificates), &d.Certificates)
	seen := map[string]bool{}
	for _, w := range d.Workloads {
		for _, ch := range roleChannels[w.Type] {
			if !seen[ch] {
				seen[ch] = true
				d.Channels = append(d.Channels, ChannelSource{Channel: ch, Level: "auto"})
			}
		}
	}
	return d
}

// powershell runs a script via -EncodedCommand, which sidesteps command-line quoting.
func powershell(ctx context.Context, timeout time.Duration, script string) (string, error) {
	u := utf16.Encode([]rune(script))
	buf := make([]byte, len(u)*2)
	for i, r := range u {
		binary.LittleEndian.PutUint16(buf[i*2:], r)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-EncodedCommand", base64.StdEncoding.EncodeToString(buf)).Output()
	if err != nil {
		return "", err
	}
	// Windows PowerShell may prefix UTF-8 output with a BOM
	return strings.TrimSpace(strings.TrimPrefix(string(out), "\ufeff")), nil
}
