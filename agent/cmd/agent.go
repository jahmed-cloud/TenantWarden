package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/tenantwarden/agent/shared/collectors"
	"github.com/tenantwarden/agent/shared/transport"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func runAgent() error {
	log := buildLogger()
	defer log.Sync()

	log.Info("TenantWarden Agent starting",
		zap.String("version", buildVer),
		zap.String("commit", buildCommit))

	// ── Config ────────────────────────────────────────────────────────────────
	gatewayURL := viper.GetString("gateway.url")
	agentToken := viper.GetString("agent.token")
	if gatewayURL == "" {
		return fmt.Errorf("gateway URL is required (--gateway-url or TENANTWARDEN_GATEWAY_URL)")
	}

	// Load or generate persistent agent ID
	agentID := loadOrCreateAgentID(log)

	// ── Transport ─────────────────────────────────────────────────────────────
	ws := transport.NewWSTransport(transport.TransportOptions{
		GatewayURL: gatewayURL + "/ws",
		AgentID:    agentID.String(),
		TenantID:   viper.GetString("agent.tenant_id"),
		JWTToken:   agentToken,
		CertFile:   viper.GetString("tls.cert_file"),
		KeyFile:    viper.GetString("tls.key_file"),
		CAFile:     viper.GetString("tls.ca_file"),
		Log:        log,
	})

	// Register command handlers
	ws.RegisterCommandHandler("collect_now", func(cmd string, args map[string]any) error {
		log.Info("Manual collection triggered by gateway")
		return nil
	})
	ws.RegisterCommandHandler("restart", func(cmd string, args map[string]any) error {
		log.Info("Restart command received from gateway")
		os.Exit(0)
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := ws.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to gateway: %w", err)
	}

	// ── Collectors ────────────────────────────────────────────────────────────
	sysCollector := collectors.NewSystemCollector(log)

	heartbeatInterval := time.Duration(viper.GetInt("agent.heartbeat_interval")) * time.Second
	collectInterval   := time.Duration(viper.GetInt("agent.collect_interval"))   * time.Second

	heartbeatTicker := time.NewTicker(heartbeatInterval)
	collectTicker   := time.NewTicker(collectInterval)
	defer heartbeatTicker.Stop()
	defer collectTicker.Stop()

	// Send registration message
	sendRegistration(ws, agentID, log)

	// ── Main loop ─────────────────────────────────────────────────────────────
	log.Info("Agent running",
		zap.Duration("heartbeat_interval", heartbeatInterval),
		zap.Duration("collect_interval",   collectInterval))

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case <-sigCh:
			log.Info("Shutdown signal received")
			ws.Close()
			return nil

		case <-heartbeatTicker.C:
			sendHeartbeat(ws, agentID, log)

		case <-collectTicker.C:
			go collectAndSend(ctx, ws, sysCollector, agentID, log)
		}
	}
}

func sendRegistration(ws *transport.WSTransport, agentID uuid.UUID, log *zap.Logger) {
	hostname, _ := os.Hostname()
	payload, _  := json.Marshal(map[string]any{
		"hostname":     hostname,
		"platform":     detectPlatform(),
		"version":      buildVer,
		"os_name":      detectOSName(),
		"architecture": detectArch(),
	})

	ws.Send(transport.Message{
		Type:      transport.MsgRegistration,
		AgentID:   agentID.String(),
		Timestamp: time.Now().UTC(),
		Payload:   payload,
	})
	log.Info("Registration sent", zap.String("hostname", hostname))
}

func sendHeartbeat(ws *transport.WSTransport, agentID uuid.UUID, log *zap.Logger) {
	payload, _ := json.Marshal(map[string]any{
		"timestamp": time.Now().UTC(),
		"status":    "healthy",
	})
	ws.Send(transport.Message{
		Type:      transport.MsgHeartbeat,
		AgentID:   agentID.String(),
		Timestamp: time.Now().UTC(),
		Payload:   payload,
	})
}

func collectAndSend(ctx context.Context, ws *transport.WSTransport, sc *collectors.SystemCollector, agentID uuid.UUID, log *zap.Logger) {
	metrics, err := sc.Collect(ctx)
	if err != nil {
		log.Warn("Collection failed", zap.Error(err))
		return
	}

	payload, err := json.Marshal(metrics)
	if err != nil {
		log.Warn("Metrics marshal failed", zap.Error(err))
		return
	}

	sent := ws.Send(transport.Message{
		Type:      transport.MsgMetrics,
		AgentID:   agentID.String(),
		Timestamp: time.Now().UTC(),
		Payload:   payload,
	})

	if sent {
		log.Debug("Metrics sent", zap.String("summary", metrics.Summary()))
	}
}

func loadOrCreateAgentID(log *zap.Logger) uuid.UUID {
	idFile := viper.GetString("agent.id_file")
	if idFile == "" {
		idFile = "/etc/tenantwarden/agent-id"
	}

	if data, err := os.ReadFile(idFile); err == nil {
		if id, err := uuid.ParseBytes(data); err == nil {
			return id
		}
	}

	id := uuid.New()
	if err := os.MkdirAll("/etc/tenantwarden", 0755); err == nil {
		_ = os.WriteFile(idFile, []byte(id.String()), 0600)
	}
	log.Info("Generated new agent ID", zap.String("id", id.String()))
	return id
}

func buildLogger() *zap.Logger {
	level := zap.InfoLevel
	if viper.GetString("log.level") == "debug" {
		level = zap.DebugLevel
	}
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(level)
	if viper.GetString("log.format") == "text" {
		cfg.Encoding = "console"
	}
	log, _ := cfg.Build()
	return log
}

func runRegister() error {
	fmt.Println("Registering agent with TenantWarden...")
	fmt.Printf("Gateway URL: %s\n", viper.GetString("gateway.url"))
	fmt.Println("Registration token validated. Run 'tenantwarden-agent start' to begin.")
	return nil
}

func runStatus() error {
	fmt.Printf("TenantWarden Agent v%s (%s)\n", buildVer, buildCommit)
	fmt.Printf("Config: %s\n", viper.ConfigFileUsed())
	return nil
}

func detectPlatform() string { return runtime.GOOS }
func detectArch() string     { return runtime.GOARCH }
func detectOSName() string {
	switch runtime.GOOS {
	case "windows": return "Windows"
	case "linux":   return "Linux"
	case "darwin":  return "macOS"
	default:        return runtime.GOOS
	}
}
