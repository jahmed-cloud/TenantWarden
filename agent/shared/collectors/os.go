package collectors

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Event is one security-relevant OS event. Level is critical | error | warning | info;
// the platform raises an alert for every critical event.
type Event struct {
	Level      string    `json:"level"`
	Source     string    `json:"source"`
	Message    string    `json:"message"`
	OccurredAt time.Time `json:"occurred_at"`
}

// OSCollector gathers what gopsutil cannot: the platform's event log, a security inventory
// (patches, encryption, firewall, antivirus, services, software) and the server roles running
// on the host. NewOSCollector is defined once per platform (os_linux.go, os_windows.go, os_other.go).
type OSCollector interface {
	// Inventory is sent on start and every inventory interval; it replaces the previous one.
	Inventory(ctx context.Context) (map[string]any, error)
	// Events returns events that occurred after since, oldest first: the built-in sources plus
	// the extra channels / units from the monitoring profile and the discovered workloads.
	Events(ctx context.Context, since time.Time, extra EventSources) ([]Event, error)
	// Discover finds server roles (SQL Server, IIS, AD DS, nginx, MySQL …), their log files and
	// the host's certificates. It is cheap enough to run every few minutes.
	Discover(ctx context.Context) Discovery
}

// EventSources are event-log inputs beyond the built-ins.
type EventSources struct {
	Channels []ChannelSource // Windows Event Log channels
	Units    []UnitSource    // systemd journal units
	// Windows Application-log providers of discovered SQL Server instances (MSSQLSERVER, MSSQL$NAME)
	SQLProviders []string
}

// ChannelSource is a Windows Event Log channel. Without IDs only critical, error and warning
// entries are read; with IDs, those events at any level.
type ChannelSource struct {
	Channel string
	IDs     []int
	Level   string // auto (from the event) | critical | error | warning | info
}

type UnitSource struct {
	Unit  string
	Level string
}

// Workload is a server role found on the host.
type Workload struct {
	Type    string         `json:"type"`              // sqlserver | iis | adds | dns | nginx | mysql | postgresql …
	Name    string         `json:"name"`              // instance or display name
	Status  string         `json:"status"`            // running | stopped
	Startup string         `json:"startup,omitempty"` // auto | manual | disabled
	Version string         `json:"version,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

// Certificate is a machine certificate and how long it has left.
type Certificate struct {
	Subject    string    `json:"subject"`
	Issuer     string    `json:"issuer"`
	Expires    time.Time `json:"expires"`
	DaysLeft   int       `json:"days_left"`
	SelfSigned bool      `json:"self_signed"`
	Location   string    `json:"location"`
}

// LogFile is a log a discovered workload writes, tailed like a custom log source.
type LogFile struct {
	Source  string // event source, e.g. "nginx", "SQL Server"
	Path    string // file or glob
	Include string // regex: only matching lines become events
	Level   string // auto | critical | error | warning | info
	// FoldLogins counts "Login failed … [CLIENT: x]" lines per client instead of sending each
	FoldLogins bool
}

type Discovery struct {
	Workloads    []Workload
	Logs         []LogFile
	Channels     []ChannelSource // event channels the discovered roles write to (Directory Service, DNS Server …)
	SQLProviders []string
	Certificates []Certificate
}

// Failed logins from one source within a single collection window that make a brute-force alert
const bruteForceThreshold = 10

// FoldFailures is bruteForce for other packages (the log tailer).
func FoldFailures(source string, failures map[string]int, at time.Time) []Event {
	return bruteForce(source, failures, at)
}

// DetectLevel guesses an event level from a log line.
func DetectLevel(line string) string {
	l := strings.ToLower(line)
	switch {
	case strings.Contains(l, "panic") || strings.Contains(l, "fatal") || strings.Contains(l, "emerg") ||
		strings.Contains(l, "[crit") || strings.Contains(l, "critical") || strings.Contains(l, "[alert"):
		return "critical"
	case strings.Contains(l, "error") || strings.Contains(l, "[err") || strings.Contains(l, "exception") || strings.Contains(l, "failed"):
		return "error"
	case strings.Contains(l, "warn"):
		return "warning"
	}
	return "info"
}

// bruteForce folds repeated failed logins into one event per source: a warning below the
// threshold, critical at or above it. Logging every failure would flood the event table.
func bruteForce(source string, failures map[string]int, at time.Time) []Event {
	var out []Event
	for from, n := range failures {
		level := "warning"
		if n >= bruteForceThreshold {
			level = "critical"
		}
		out = append(out, Event{
			Level:      level,
			Source:     source,
			Message:    fmt.Sprintf("%d failed logins from %s since the last collection", n, from),
			OccurredAt: at,
		})
	}
	return out
}

// run executes a command and returns trimmed stdout. Missing tools are expected on
// minimal hosts and containers, so callers treat errors as "not available".
func run(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// lines splits command output into non-empty lines.
func lines(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

// truncate puts an event message on one line and keeps it to a size the platform stores in full.
func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// decodeList accepts a JSON array or a single object (PowerShell emits either).
func decodeList(raw string, v any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if !strings.HasPrefix(raw, "[") {
		raw = "[" + raw + "]"
	}
	return json.Unmarshal([]byte(raw), v)
}
