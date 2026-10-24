//go:build windows

package collectors

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"go.uber.org/zap"
)

// WindowsEvent represents a Windows Event Log entry.
type WindowsEvent struct {
	ID          int       `json:"id"`
	Level       string    `json:"level"`
	Source      string    `json:"source"`
	Message     string    `json:"message"`
	TimeCreated time.Time `json:"time_created"`
	Channel     string    `json:"channel"`
}

// WindowsService represents a Windows service.
type WindowsService struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	StartType   string `json:"start_type"`
}

// BitLockerVolume represents a BitLocker-protected volume.
type BitLockerVolume struct {
	MountPoint      string `json:"mount_point"`
	EncryptionMethod string `json:"encryption_method"`
	ProtectionStatus string `json:"protection_status"`
	LockStatus      string `json:"lock_status"`
}

// WindowsCollector collects Windows-specific metrics and security data.
type WindowsCollector struct {
	log *zap.Logger
}

func NewWindowsCollector(log *zap.Logger) *WindowsCollector {
	return &WindowsCollector{log: log}
}

// CollectEventLog reads recent security events from Windows Event Log via PowerShell.
func (c *WindowsCollector) CollectEventLog(ctx context.Context, channels []string, maxEvents int) ([]WindowsEvent, error) {
	if len(channels) == 0 {
		channels = []string{"Security", "System", "Application"}
	}
	if maxEvents <= 0 {
		maxEvents = 100
	}

	var allEvents []WindowsEvent

	for _, ch := range channels {
		ps := fmt.Sprintf(`
Get-WinEvent -LogName '%s' -MaxEvents %d -ErrorAction SilentlyContinue |
Select-Object Id, LevelDisplayName, ProviderName, Message, TimeCreated |
ConvertTo-Json -Compress`, ch, maxEvents)

		out, err := c.runPowerShell(ctx, ps)
		if err != nil {
			c.log.Warn("EventLog collection failed", zap.String("channel", ch), zap.Error(err))
			continue
		}

		// Parse JSON output — simplified; use encoding/json in production
		_ = out
		allEvents = append(allEvents, WindowsEvent{
			Channel: ch,
			Source:  "EventLog",
		})
	}

	return allEvents, nil
}

// CollectServices enumerates Windows services and their status.
func (c *WindowsCollector) CollectServices(ctx context.Context) ([]WindowsService, error) {
	ps := `Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json -Compress`
	out, err := c.runPowerShell(ctx, ps)
	if err != nil {
		return nil, fmt.Errorf("collect services: %w", err)
	}
	_ = out
	// Parse JSON in production
	return nil, nil
}

// CollectBitLocker enumerates BitLocker volume protection status.
func (c *WindowsCollector) CollectBitLocker(ctx context.Context) ([]BitLockerVolume, error) {
	ps := `
Get-BitLockerVolume |
Select-Object MountPoint, EncryptionMethod, ProtectionStatus, LockStatus |
ConvertTo-Json -Compress`

	out, err := c.runPowerShell(ctx, ps)
	if err != nil {
		// Not a fatal error — BitLocker may not be installed
		c.log.Debug("BitLocker collection failed", zap.Error(err))
		return nil, nil
	}
	_ = out
	return nil, nil
}

// CollectInstalledSoftware lists installed programs via the registry.
func (c *WindowsCollector) CollectInstalledSoftware(ctx context.Context) ([]map[string]string, error) {
	ps := `
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* |
Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
Where-Object { $_.DisplayName -ne $null } |
ConvertTo-Json -Compress`

	out, err := c.runPowerShell(ctx, ps)
	if err != nil {
		return nil, fmt.Errorf("collect software: %w", err)
	}
	_ = out
	return nil, nil
}

// CollectWindowsUpdates checks for pending Windows updates.
func (c *WindowsCollector) CollectWindowsUpdates(ctx context.Context) ([]map[string]string, error) {
	ps := `
$Session = New-Object -ComObject Microsoft.Update.Session
$Searcher = $Session.CreateUpdateSearcher()
$Results = $Searcher.Search("IsInstalled=0 and Type='Software'")
$Results.Updates | Select-Object Title, MsrcSeverity, IsDownloaded | ConvertTo-Json -Compress`

	out, err := c.runPowerShell(ctx, ps)
	if err != nil {
		c.log.Debug("Windows update check failed", zap.Error(err))
		return nil, nil
	}
	_ = out
	return nil, nil
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func (c *WindowsCollector) runPowerShell(ctx context.Context, script string) (string, error) {
	cmd := exec.CommandContext(ctx,
		"powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script)

	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
