//go:build !windows

package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

const (
	unitName = "tenantwarden-agent"
	unitPath = "/etc/systemd/system/tenantwarden-agent.service"
)

func runStart() error { return runForeground() }

// The agent runs as root: the journal, package simulation and firewall state need it.
const unitTemplate = `[Unit]
Description=TenantWarden Agent
Documentation=https://tenantwarden.org
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s start --config %s
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
`

func installService(configPath string) error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("service install supports systemd (Linux) and Windows; on %s run 'tenantwarden-agent start --config %s' from your service manager", runtime.GOOS, configPath)
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return fmt.Errorf("systemctl not found; run 'tenantwarden-agent start --config %s' from your init system", configPath)
	}
	if _, err := os.Stat(configPath); err != nil {
		return fmt.Errorf("no configuration at %s; run 'tenantwarden-agent register' first", configPath)
	}
	if os.Geteuid() != 0 {
		return fmt.Errorf("installing the service needs root; run it with sudo")
	}
	bin, err := installBinary("/usr/local/bin/tenantwarden-agent")
	if err != nil {
		return err
	}
	if err := os.WriteFile(unitPath, []byte(fmt.Sprintf(unitTemplate, bin, configPath)), 0644); err != nil {
		return fmt.Errorf("write %s: %w", unitPath, err)
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", "--now", unitName}, {"restart", unitName}} {
		if out, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %s: %v: %s", strings.Join(args, " "), err, out)
		}
	}
	fmt.Printf("Installed and started %s (%s).\n", unitName, bin)
	fmt.Printf("Logs: journalctl -u %s -f\n", unitName)
	return nil
}

func uninstallService() error {
	if _, err := os.Stat(unitPath); err != nil {
		return fmt.Errorf("the %s service is not installed", unitName)
	}
	_ = exec.Command("systemctl", "disable", "--now", unitName).Run()
	if err := os.Remove(unitPath); err != nil {
		return fmt.Errorf("remove %s (needs root): %w", unitPath, err)
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	fmt.Printf("Removed the %s service. The configuration in %s is kept.\n", unitName, configDir())
	return nil
}

func serviceState() string {
	if _, err := os.Stat(unitPath); err != nil {
		return "not installed"
	}
	out, _ := exec.Command("systemctl", "is-active", unitName).Output()
	return strings.TrimSpace(string(out))
}

func restrictFile(path string) error {
	return os.Chmod(path, 0600)
}
