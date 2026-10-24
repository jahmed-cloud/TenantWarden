//go:build linux

package collectors

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"go.uber.org/zap"
)

// JournalEntry represents a systemd journal log entry.
type JournalEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Unit      string    `json:"unit"`
	Priority  int       `json:"priority"`
	Message   string    `json:"message"`
	PID       string    `json:"pid"`
}

// SystemdUnit represents a systemd service unit.
type SystemdUnit struct {
	Name        string `json:"name"`
	LoadState   string `json:"load_state"`
	ActiveState string `json:"active_state"`
	SubState    string `json:"sub_state"`
	Description string `json:"description"`
}

// DockerContainerInfo holds container metrics.
type DockerContainerInfo struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Image       string  `json:"image"`
	Status      string  `json:"status"`
	State       string  `json:"state"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemUsageMB  float64 `json:"mem_usage_mb"`
	MemLimitMB  float64 `json:"mem_limit_mb"`
	RestartCount int    `json:"restart_count"`
}

// LinuxCollector collects Linux-specific metrics and security data.
type LinuxCollector struct {
	log *zap.Logger
}

func NewLinuxCollector(log *zap.Logger) *LinuxCollector {
	return &LinuxCollector{log: log}
}

// CollectJournal reads recent systemd journal entries for a unit.
func (c *LinuxCollector) CollectJournal(ctx context.Context, unit string, lines int) ([]JournalEntry, error) {
	if lines <= 0 {
		lines = 100
	}

	args := []string{"-n", fmt.Sprintf("%d", lines), "--output=short-iso", "--no-pager"}
	if unit != "" {
		args = append(args, "-u", unit)
	}

	out, err := exec.CommandContext(ctx, "journalctl", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("journalctl: %w", err)
	}

	var entries []JournalEntry
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" { continue }
		entries = append(entries, JournalEntry{
			Timestamp: time.Now().UTC(),
			Message:   line,
		})
	}
	return entries, nil
}

// CollectSystemdUnits lists all active systemd units.
func (c *LinuxCollector) CollectSystemdUnits(ctx context.Context) ([]SystemdUnit, error) {
	out, err := exec.CommandContext(ctx,
		"systemctl", "list-units", "--type=service", "--no-pager", "--no-legend",
	).Output()
	if err != nil {
		return nil, fmt.Errorf("systemctl: %w", err)
	}

	var units []SystemdUnit
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 { continue }
		units = append(units, SystemdUnit{
			Name:        fields[0],
			LoadState:   fields[1],
			ActiveState: fields[2],
			SubState:    fields[3],
			Description: strings.Join(fields[4:], " "),
		})
	}
	return units, nil
}

// CollectDockerContainers collects running container metrics.
func (c *LinuxCollector) CollectDockerContainers(ctx context.Context) ([]DockerContainerInfo, error) {
	// docker stats --no-stream --format json
	out, err := exec.CommandContext(ctx,
		"docker", "stats", "--no-stream",
		"--format", "{{.ID}},{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}",
	).Output()
	if err != nil {
		// Docker may not be installed — not a fatal error
		c.log.Debug("Docker stats collection skipped", zap.Error(err))
		return nil, nil
	}

	var containers []DockerContainerInfo
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" { continue }
		parts := strings.SplitN(line, ",", 5)
		if len(parts) < 4 { continue }
		containers = append(containers, DockerContainerInfo{
			ID:   parts[0],
			Name: parts[1],
		})
	}
	return containers, nil
}

// CollectOpenPorts lists listening TCP/UDP ports via ss.
func (c *LinuxCollector) CollectOpenPorts(ctx context.Context) ([]string, error) {
	out, err := exec.CommandContext(ctx, "ss", "-tlnp").Output()
	if err != nil {
		return nil, fmt.Errorf("ss: %w", err)
	}

	var ports []string
	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Scan() // skip header
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" { continue }
		fields := strings.Fields(line)
		if len(fields) >= 4 {
			ports = append(ports, fields[3]) // local address:port
		}
	}
	return ports, nil
}

// CollectKernelVersion returns the running kernel version.
func (c *LinuxCollector) CollectKernelVersion(ctx context.Context) (string, error) {
	out, err := exec.CommandContext(ctx, "uname", "-r").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// CollectLastLogins returns recent login history from /var/log/lastlog.
func (c *LinuxCollector) CollectLastLogins(ctx context.Context) ([]string, error) {
	out, err := exec.CommandContext(ctx, "last", "-n", "20", "--time-format", "iso").Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 20 {
		lines = lines[:20]
	}
	return lines, nil
}
