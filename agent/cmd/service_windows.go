//go:build windows

package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "TenantWardenAgent"

// runStart runs under the Service Control Manager when started as a service, otherwise in
// the foreground. A service has no console, so it logs to agent.log next to the config.
func runStart() error {
	if isService, err := svc.IsWindowsService(); err == nil && isService {
		return svc.Run(serviceName, &agentService{})
	}
	return runForeground()
}

type agentService struct{}

func (s *agentService) Execute(args []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- runAgent(buildLogger(filepath.Join(stateDir(), "agent.log")), stop) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case err := <-done:
			if err != nil {
				return true, 1 // non-zero exit: the recovery actions restart the service
			}
			return false, 0
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				close(stop)
				select {
				case <-done:
				case <-time.After(10 * time.Second):
				}
				return false, 0
			}
		}
	}
}

func installService(configPath string) error {
	if _, err := os.Stat(configPath); err != nil {
		return fmt.Errorf("no configuration at %s; run 'tenantwarden-agent register' first", configPath)
	}
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("cannot reach the Service Control Manager (run from an elevated prompt): %w", err)
	}
	defer m.Disconnect()
	if s, err := m.OpenService(serviceName); err == nil {
		s.Close()
		return fmt.Errorf("the %s service already exists; run 'tenantwarden-agent uninstall' first", serviceName)
	}

	dir := os.Getenv("ProgramFiles")
	if dir == "" {
		dir = `C:\Program Files`
	}
	exe, err := installBinary(filepath.Join(dir, "TenantWarden", "tenantwarden-agent.exe"))
	if err != nil {
		return err
	}

	s, err := m.CreateService(serviceName, exe, mgr.Config{
		DisplayName:      "TenantWarden Agent",
		Description:      "Streams system metrics, security events and inventory to TenantWarden.",
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
	}, "start", "--config", configPath)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer s.Close()
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
	}, 86400)
	if err := s.Start(); err != nil {
		return fmt.Errorf("service installed but did not start: %w", err)
	}
	fmt.Printf("Installed and started the %s service (%s).\n", serviceName, exe)
	fmt.Printf("Logs: %s\n", filepath.Join(filepath.Dir(configPath), "agent.log"))
	return nil
}

func uninstallService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("cannot reach the Service Control Manager (run from an elevated prompt): %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("the %s service is not installed", serviceName)
	}
	defer s.Close()
	if st, err := s.Query(); err == nil && st.State != svc.Stopped {
		_, _ = s.Control(svc.Stop)
		for i := 0; i < 20; i++ {
			if st, err := s.Query(); err != nil || st.State == svc.Stopped {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	if err := s.Delete(); err != nil {
		return fmt.Errorf("delete service: %w", err)
	}
	fmt.Printf("Removed the %s service. The configuration in %s is kept.\n", serviceName, configDir())
	return nil
}

func serviceState() string {
	m, err := mgr.Connect()
	if err != nil {
		return "unknown (run elevated to check)"
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return "not installed"
	}
	defer s.Close()
	st, err := s.Query()
	if err != nil {
		return "unknown"
	}
	return map[svc.State]string{
		svc.Stopped: "stopped", svc.StartPending: "starting", svc.StopPending: "stopping", svc.Running: "running",
	}[st.State]
}

// restrictFile limits the file to SYSTEM and Administrators (well-known SIDs, so it works
// on every Windows language).
func restrictFile(path string) error {
	out, err := exec.Command("icacls", path, "/inheritance:r", "/grant:r", "*S-1-5-18:F", "*S-1-5-32-544:F").CombinedOutput()
	if err != nil {
		return fmt.Errorf("restrict access to %s: %v: %s", path, err, out)
	}
	return nil
}
