package cmd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/viper"
	"github.com/tenantwarden/agent/shared/transport"
	"go.uber.org/zap"
)

type tokenInfo struct {
	TenantID string          `json:"tenant_id"`
	Exp      int64           `json:"exp"`
	Aud      json.RawMessage `json:"aud"`
}

// readToken decodes the enrollment token's claims for display and early errors.
// It does not verify the signature; the gateway does that.
func readToken(token string) (*tokenInfo, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("this is not a TenantWarden enrollment token")
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("this is not a TenantWarden enrollment token")
	}
	var t tokenInfo
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, fmt.Errorf("this is not a TenantWarden enrollment token")
	}
	if !strings.Contains(string(t.Aud), "tenantwarden-agent") || t.TenantID == "" {
		return nil, fmt.Errorf("this token is not an agent enrollment token; create one under Agents → Add agent")
	}
	return &t, nil
}

func (t *tokenInfo) expires() time.Time { return time.Unix(t.Exp, 0) }

func runRegister(install, resetID bool) error {
	gateway := wsURL(viper.GetString("gateway.url"))
	token   := strings.TrimSpace(viper.GetString("agent.token"))
	if gateway == "" || token == "" {
		return fmt.Errorf("--gateway-url and --agent-token are required (copy both from the portal: Agents → Add agent)")
	}
	info, err := readToken(token)
	if err != nil {
		return err
	}
	if time.Now().After(info.expires()) {
		return fmt.Errorf("this token expired on %s; create a new one in the portal", info.expires().Format(time.RFC1123))
	}

	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("cannot create %s (run as root / administrator, or pass --config): %w", filepath.Dir(path), err)
	}
	agentID := loadOrCreateAgentID(zap.NewNop(), resetID)

	fmt.Printf("Tenant:        %s\n", info.TenantID)
	fmt.Printf("Token expires: %s\n", info.expires().Format(time.RFC1123))
	fmt.Printf("Agent ID:      %s\n", agentID)
	fmt.Printf("Gateway:       %s\n", gateway)
	fmt.Print("Checking the connection... ")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := transport.Probe(ctx, transportOptions(gateway, token, agentID, zap.NewNop(), nil)); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("could not connect to the gateway: %w", err)
	}
	fmt.Println("ok")

	if err := writeConfig(path, gateway, token, viper.GetString("tls.ca_file"), viper.GetStringSlice("agent.tags")); err != nil {
		return err
	}
	fmt.Printf("Saved configuration to %s\n", path)

	if install {
		return installService(path)
	}
	fmt.Println("\nNext: run 'tenantwarden-agent install' to run the agent as a service,")
	fmt.Println("or 'tenantwarden-agent start' to run it in this terminal.")
	return nil
}

func writeConfig(path, gateway, token, caFile string, tags []string) error {
	if caFile != "" {
		if abs, err := filepath.Abs(caFile); err == nil {
			caFile = abs
		}
	}
	if tags == nil {
		tags = []string{}
	}
	tagsJSON, _ := json.Marshal(tags) // a JSON array is a valid YAML flow sequence
	// %q output is a valid YAML double-quoted string
	content := fmt.Sprintf(`# TenantWarden agent configuration, written by "tenantwarden-agent register" on %s
gateway:
  url: %q

agent:
  token: %q
  tags: %s                     # used by monitoring-profile items to target hosts
  heartbeat_interval: 30       # seconds
  collect_interval: 60         # system metrics and network throughput
  events_interval: 300         # OS event log (0 disables)
  logs_interval: 60            # custom and workload log files (0 disables)
  discovery_interval: 300      # server roles: SQL Server, IIS, nginx, … (0 disables)
  inventory_interval: 21600    # security inventory (0 disables)

tls:
  ca_file: %q

log:
  level: info                  # debug | info | warn | error
  format: json                 # json | text

# Local monitoring, merged with the profile set in the portal (Agents → Monitoring profile).
# monitoring:
#   logs:
#     - name: myapp                  # events appear with source "log:myapp"
#       path: /var/log/myapp/*.log   # file or glob; Windows: C:\App\logs\*.log
#       include: "ERROR|FATAL"       # regex, case-insensitive; only matching lines are sent
#       exclude: "healthcheck"
#       level: auto                  # auto | critical | error | warning | info
#   event_channels:                  # Windows
#     - channel: Microsoft-Windows-PowerShell/Operational
#       ids: [4104]
#   journal_units:                   # Linux
#     - unit: myapp.service
#       level: warning
#   checks:
#     - name: intranet
#       type: http                   # tcp (host:port) | http (URL) | dns (hostname)
#       target: https://intranet.example.com/health
#       interval_seconds: 60
`, time.Now().UTC().Format(time.RFC3339), gateway, token, tagsJSON, caFile)

	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return fmt.Errorf("cannot write %s (run as root / administrator, or pass --config): %w", path, err)
	}
	// The token lets a host report into the tenant, so keep the file private
	return restrictFile(path)
}

func runStatus() error {
	fmt.Printf("TenantWarden Agent %s (%s)\n", buildVer, buildCommit)
	used := viper.ConfigFileUsed()
	if used == "" {
		fmt.Println("Config:        none found; run 'tenantwarden-agent register' first")
		return nil
	}
	fmt.Printf("Config:        %s\n", used)
	gateway := wsURL(viper.GetString("gateway.url"))
	fmt.Printf("Gateway:       %s\n", gateway)
	agentID := loadOrCreateAgentID(zap.NewNop(), false)
	fmt.Printf("Agent ID:      %s\n", agentID)
	fmt.Printf("Service:       %s\n", serviceState())

	token := viper.GetString("agent.token")
	info, err := readToken(token)
	if err != nil {
		fmt.Printf("Token:         %v\n", err)
		return nil
	}
	fmt.Printf("Tenant:        %s\n", info.TenantID)
	fmt.Printf("Token expires: %s\n", info.expires().Format(time.RFC1123))

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := transport.Probe(ctx, transportOptions(gateway, token, agentID, zap.NewNop(), nil)); err != nil {
		fmt.Printf("Connection:    failed: %v\n", err)
		return nil
	}
	fmt.Println("Connection:    ok")
	return nil
}
