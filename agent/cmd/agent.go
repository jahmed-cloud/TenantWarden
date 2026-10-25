package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/spf13/viper"
	"github.com/tenantwarden/agent/shared/collectors"
	"github.com/tenantwarden/agent/shared/monitor"
	"github.com/tenantwarden/agent/shared/transport"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// runForeground runs the agent until Ctrl+C / SIGTERM.
func runForeground() error {
	stop := make(chan struct{})
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() { <-sigCh; close(stop) }()
	return runAgent(buildLogger(""), stop)
}

// runAgent connects to the gateway and runs the collectors until stop is closed.
func runAgent(log *zap.Logger, stop <-chan struct{}) error {
	defer log.Sync()
	log.Info("TenantWarden Agent starting",
		zap.String("version", buildVer),
		zap.String("commit", buildCommit),
		zap.String("config", viper.ConfigFileUsed()))

	gatewayURL := wsURL(viper.GetString("gateway.url"))
	token      := viper.GetString("agent.token")
	if gatewayURL == "" || token == "" {
		return fmt.Errorf("agent is not registered: run 'tenantwarden-agent register --gateway-url <url> --agent-token <token>' first")
	}
	agentID := loadOrCreateAgentID(log, false)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sysCollector := collectors.NewSystemCollector(log)
	osCollector  := collectors.NewOSCollector(log)
	events       := newEventPump(filepath.Join(stateDir(), "events-since"))
	tailer       := monitor.NewTailer(filepath.Join(stateDir(), "log-offsets.json"))
	checker      := monitor.NewChecker()
	mon          := newMonitorState(log)

	// The first reports wait for the first connection: queued before it, they would reach the
	// portal ahead of the registration, which creates the agent's row.
	var firstReports sync.Once
	var ws *transport.WSTransport
	ws = transport.NewWSTransport(transportOptions(gatewayURL, token, agentID, log, func() {
		// Re-register on every reconnect so the portal always has current host details
		sendRegistration(ctx, ws, gatewayURL, log)
		firstReports.Do(func() {
			// Discovery comes first: the inventory, events and workload logs all use what it finds
			go collectAndSend(ctx, ws, sysCollector, log)
			go func() {
				mon.discover(ctx, ws, osCollector, log)
				go events.run(ctx, ws, osCollector, mon.eventSources(), log)
				sendInventory(ctx, ws, osCollector, mon, log)
			}()
		})
	}))

	// The tenant's monitoring profile arrives on every (re)connect and whenever it is edited
	ws.OnConfig(func(raw json.RawMessage) {
		if err := mon.store.SetRemote(raw); err != nil {
			log.Warn("Monitoring profile from the portal could not be read", zap.Error(err))
			return
		}
		p := mon.profile()
		log.Info("Monitoring profile applied",
			zap.Int("log_sources", len(p.Logs)), zap.Int("event_channels", len(p.EventChannels)),
			zap.Int("journal_units", len(p.JournalUnits)), zap.Int("checks", len(p.Checks)))
	})

	collectNow := make(chan struct{}, 1)
	ws.RegisterCommandHandler("collect_now", func(cmd string, args map[string]any) error {
		log.Info("Collection requested by the portal")
		select {
		case collectNow <- struct{}{}:
		default:
		}
		return nil
	})
	ws.RegisterCommandHandler("restart", func(cmd string, args map[string]any) error {
		log.Info("Restart requested by the portal; the service manager starts the agent again")
		os.Exit(0)
		return nil
	})

	if err := ws.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to gateway: %w", err)
	}

	heartbeat := ticker(viper.GetInt("agent.heartbeat_interval"))
	collect   := ticker(viper.GetInt("agent.collect_interval"))
	eventTick := ticker(viper.GetInt("agent.events_interval"))
	invTick   := ticker(viper.GetInt("agent.inventory_interval"))
	logTick   := ticker(viper.GetInt("agent.logs_interval"))
	discTick  := ticker(viper.GetInt("agent.discovery_interval"))
	checkTick := ticker(15)
	for _, t := range []*time.Ticker{heartbeat, collect, eventTick, invTick, logTick, discTick, checkTick} {
		defer t.Stop()
	}

	log.Info("Agent running",
		zap.String("agent_id", agentID.String()),
		zap.String("gateway", gatewayURL))

	for {
		select {
		case <-stop:
			log.Info("Shutting down")
			ws.Close()
			return nil

		case <-heartbeat.C:
			sendHeartbeat(ws)

		case <-collect.C:
			go collectAndSend(ctx, ws, sysCollector, log)

		case <-eventTick.C:
			go events.run(ctx, ws, osCollector, mon.eventSources(), log)

		case <-invTick.C:
			go sendInventory(ctx, ws, osCollector, mon, log)

		case <-discTick.C:
			go mon.discover(ctx, ws, osCollector, log)

		case <-logTick.C:
			go mon.tailLogs(ws, tailer, log)

		case <-checkTick.C:
			go mon.runChecks(ctx, ws, checker, log)

		case <-collectNow:
			go collectAndSend(ctx, ws, sysCollector, log)
			go sendInventory(ctx, ws, osCollector, mon, log)
			go events.run(ctx, ws, osCollector, mon.eventSources(), log)
		}
	}
}

func transportOptions(gatewayURL, token string, agentID uuid.UUID, log *zap.Logger, onConnect func()) transport.TransportOptions {
	return transport.TransportOptions{
		GatewayURL: gatewayURL,
		AgentID:    agentID.String(),
		JWTToken:   token,
		CAFile:     viper.GetString("tls.ca_file"),
		Log:        log,
		OnConnect:  onConnect,
	}
}

// ticker returns a ticker for the interval in seconds; 0 or less never fires.
func ticker(seconds int) *time.Ticker {
	if seconds <= 0 {
		t := time.NewTicker(time.Hour)
		t.Stop()
		return t
	}
	return time.NewTicker(time.Duration(seconds) * time.Second)
}

// wsURL accepts http(s):// or ws(s):// and appends /ws unless the URL already ends with it,
// so "https://portal/agent" and "wss://host:4433" both work.
func wsURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(raw, "https://"):
		raw = "wss://" + strings.TrimPrefix(raw, "https://")
	case strings.HasPrefix(raw, "http://"):
		raw = "ws://" + strings.TrimPrefix(raw, "http://")
	case !strings.HasPrefix(raw, "ws://") && !strings.HasPrefix(raw, "wss://"):
		raw = "wss://" + raw
	}
	if !strings.HasSuffix(raw, "/ws") {
		raw += "/ws"
	}
	return raw
}

func send(ws *transport.WSTransport, typ transport.MessageType, payload any) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return ws.Send(transport.Message{Type: typ, Timestamp: time.Now().UTC(), Payload: data})
}

func sendRegistration(ctx context.Context, ws *transport.WSTransport, gatewayURL string, log *zap.Logger) {
	hostname, _ := os.Hostname()
	payload := map[string]any{
		"hostname":     hostname,
		"platform":     platform(),
		"version":      buildVer,
		"architecture": runtime.GOARCH,
		"ip_address":   localIP(gatewayURL),
		"tags":         viper.GetStringSlice("agent.tags"),
	}
	if info, err := host.InfoWithContext(ctx); err == nil {
		payload["os_name"]    = osName(info)
		payload["os_version"] = info.PlatformVersion
		payload["kernel"]     = info.KernelVersion
	}
	send(ws, transport.MsgRegistration, payload)
	log.Info("Registration sent", zap.String("hostname", hostname))
}

func sendHeartbeat(ws *transport.WSTransport) {
	send(ws, transport.MsgHeartbeat, map[string]any{"timestamp": time.Now().UTC(), "status": "healthy"})
}

func collectAndSend(ctx context.Context, ws *transport.WSTransport, sc *collectors.SystemCollector, log *zap.Logger) {
	metrics, err := sc.Collect(ctx)
	if err != nil {
		log.Warn("Metric collection failed", zap.Error(err))
		return
	}
	metrics.Platform = platform()
	if send(ws, transport.MsgMetrics, metrics) {
		log.Debug("Metrics sent", zap.String("summary", metrics.Summary()))
	}
}

var inventoryMu sync.Mutex

func sendInventory(ctx context.Context, ws *transport.WSTransport, oc collectors.OSCollector, mon *monitorState, log *zap.Logger) {
	if !inventoryMu.TryLock() {
		return // the previous inventory is still being collected
	}
	defer inventoryMu.Unlock()
	inv, err := oc.Inventory(ctx)
	if err != nil {
		log.Warn("Inventory collection failed", zap.Error(err))
		return
	}
	inv["agent_version"] = buildVer
	// The full inventory replaces the stored one, so it carries the latest discovery too
	d := mon.getDiscovery()
	inv["workloads"], inv["certificates"] = nonNil(d.Workloads), nonNil(d.Certificates)
	if send(ws, transport.MsgInventory, inv) {
		log.Info("Inventory sent", zap.Int("fields", len(inv)))
	}
}

// eventPump reads the OS event log from a bookmark, so a restart neither repeats nor loses
// events (the first run looks back one hour).
type eventPump struct {
	mu    sync.Mutex
	busy  bool
	since time.Time
	file  string
}

func newEventPump(file string) *eventPump {
	p := &eventPump{file: file, since: time.Now().Add(-time.Hour)}
	if data, err := os.ReadFile(file); err == nil {
		if ts, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64); err == nil {
			if t := time.Unix(ts, 0); t.After(time.Now().Add(-24 * time.Hour)) {
				p.since = t
			}
		}
	}
	return p
}

func (p *eventPump) run(ctx context.Context, ws *transport.WSTransport, oc collectors.OSCollector, extra collectors.EventSources, log *zap.Logger) {
	if viper.GetInt("agent.events_interval") <= 0 {
		return
	}
	p.mu.Lock()
	if p.busy {
		p.mu.Unlock()
		return
	}
	p.busy = true
	since := p.since
	p.mu.Unlock()

	started := time.Now()
	events, err := oc.Events(ctx, since, extra)

	p.mu.Lock()
	p.busy = false
	if err == nil {
		p.since = started
		_ = os.WriteFile(p.file, []byte(strconv.FormatInt(started.Unix(), 10)), 0600)
	}
	p.mu.Unlock()

	if err != nil {
		log.Debug("Event collection unavailable", zap.Error(err))
		return
	}
	sendEvents(ws, events)
	if len(events) > 0 {
		log.Info("Events sent", zap.Int("count", len(events)))
	}
}

func sendEvents(ws *transport.WSTransport, events []collectors.Event) {
	for i := 0; i < len(events); i += 100 {
		end := min(i+100, len(events))
		send(ws, transport.MsgEvent, map[string]any{"events": events[i:end]})
	}
}

func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

// ── Monitoring profile, discovery, custom logs, endpoint checks ─────────────

// monitorState is what the profile and discovery loops share.
type monitorState struct {
	store *monitor.Store
	host  monitor.Host

	mu        sync.RWMutex
	discovery collectors.Discovery
	busy      sync.Mutex // one discovery / log read at a time
	logsBusy  sync.Mutex
}

func newMonitorState(log *zap.Logger) *monitorState {
	var local monitor.Profile
	if err := viper.UnmarshalKey("monitoring", &local); err != nil {
		log.Warn("The monitoring section of the config could not be read", zap.Error(err))
	}
	hostname, _ := os.Hostname()
	host := monitor.Host{Name: hostname, Platform: platform(), Tags: viper.GetStringSlice("agent.tags")}
	if host.Platform == "darwin" {
		host.Platform = "macos"
	}
	return &monitorState{store: monitor.NewStore(local), host: host}
}

func (m *monitorState) profile() monitor.Profile { return m.store.Effective(m.host) }

func (m *monitorState) getDiscovery() collectors.Discovery {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.discovery
}

// discover refreshes the workloads and certificates and sends them as a partial inventory
// (merged into the stored one), so a stopped SQL Server shows up within minutes.
func (m *monitorState) discover(ctx context.Context, ws *transport.WSTransport, oc collectors.OSCollector, log *zap.Logger) {
	if !m.busy.TryLock() {
		return
	}
	defer m.busy.Unlock()
	d := oc.Discover(ctx)
	m.mu.Lock()
	m.discovery = d
	m.mu.Unlock()
	send(ws, transport.MsgInventory, map[string]any{
		"_partial": true, "workloads": nonNil(d.Workloads), "certificates": nonNil(d.Certificates),
		"discovered_at": time.Now().UTC(),
	})
	log.Debug("Discovery sent", zap.Int("workloads", len(d.Workloads)), zap.Int("certificates", len(d.Certificates)))
}

func (m *monitorState) eventSources() collectors.EventSources {
	p, d := m.profile(), m.getDiscovery()
	es := collectors.EventSources{Channels: append([]collectors.ChannelSource{}, d.Channels...), SQLProviders: d.SQLProviders}
	for _, c := range p.EventChannels {
		es.Channels = append(es.Channels, collectors.ChannelSource{Channel: c.Channel, IDs: c.IDs, Level: c.Level})
	}
	for _, u := range p.JournalUnits {
		es.Units = append(es.Units, collectors.UnitSource{Unit: u.Unit, Level: u.Level})
	}
	return es
}

// tailLogs reads the custom log sources and the logs of discovered workloads.
func (m *monitorState) tailLogs(ws *transport.WSTransport, t *monitor.Tailer, log *zap.Logger) {
	if !m.logsBusy.TryLock() {
		return
	}
	defer m.logsBusy.Unlock()
	sources := m.profile().Logs
	for _, l := range m.getDiscovery().Logs {
		sources = append(sources, monitor.WorkloadLog(l.Source, l.Path, l.Include, l.Level, l.FoldLogins))
	}
	if len(sources) == 0 {
		return
	}
	if events := t.Collect(sources); len(events) > 0 {
		sendEvents(ws, events)
		log.Info("Log events sent", zap.Int("count", len(events)))
	}
}

func (m *monitorState) runChecks(ctx context.Context, ws *transport.WSTransport, c *monitor.Checker, log *zap.Logger) {
	checks := m.profile().Checks
	if len(checks) == 0 {
		return
	}
	if results := c.RunDue(ctx, checks); len(results) > 0 {
		send(ws, transport.MsgCheck, map[string]any{"results": results})
		log.Debug("Check results sent", zap.Int("count", len(results)))
	}
}

// platform is the OS, or "docker" when the agent runs inside a container.
func platform() string {
	if runtime.GOOS == "linux" {
		if _, err := os.Stat("/.dockerenv"); err == nil {
			return "docker"
		}
	}
	return runtime.GOOS
}

// osName is e.g. "Microsoft Windows 11 Pro" or "Ubuntu"; the version is reported separately.
func osName(info *host.InfoStat) string {
	if runtime.GOOS == "windows" || info.Platform == "" {
		return info.Platform
	}
	return strings.ToUpper(info.Platform[:1]) + info.Platform[1:]
}

// localIP is the address this host uses to reach the gateway (UDP dial sends no packets).
func localIP(gatewayURL string) string {
	u, err := url.Parse(gatewayURL)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	port := u.Port()
	if port == "" {
		port = map[bool]string{true: "443", false: "80"}[u.Scheme == "wss"]
	}
	conn, err := net.DialTimeout("udp", net.JoinHostPort(u.Hostname(), port), 2*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

// loadOrCreateAgentID keeps one ID per host; the gateway binds it to the first tenant it sees.
func loadOrCreateAgentID(log *zap.Logger, reset bool) uuid.UUID {
	idFile := viper.GetString("agent.id_file")
	if idFile == "" {
		idFile = filepath.Join(stateDir(), "agent-id")
	}
	if !reset {
		if data, err := os.ReadFile(idFile); err == nil {
			if id, err := uuid.ParseBytes([]byte(strings.TrimSpace(string(data)))); err == nil {
				return id
			}
		}
	}
	id := uuid.New()
	if err := os.MkdirAll(filepath.Dir(idFile), 0755); err == nil {
		if err := os.WriteFile(idFile, []byte(id.String()), 0600); err != nil {
			log.Warn("Could not save the agent ID; a new one is used on every start", zap.String("file", idFile), zap.Error(err))
		}
	}
	log.Info("Generated new agent ID", zap.String("id", id.String()))
	return id
}

// buildLogger logs to stdout, or to logFile when set (the Windows service has no console).
func buildLogger(logFile string) *zap.Logger {
	level := zap.InfoLevel
	switch viper.GetString("log.level") {
	case "debug":
		level = zap.DebugLevel
	case "warn":
		level = zap.WarnLevel
	case "error":
		level = zap.ErrorLevel
	}
	if logFile != "" {
		// Start over once the file passes 10 MB; the agent logs little at info level
		if st, err := os.Stat(logFile); err == nil && st.Size() > 10<<20 {
			_ = os.Remove(logFile)
		}
		if f, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); err == nil {
			enc := zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig())
			return zap.New(zapcore.NewCore(enc, zapcore.AddSync(f), level))
		}
	}
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(level)
	if viper.GetString("log.format") == "text" {
		cfg.Encoding = "console"
	}
	log, err := cfg.Build()
	if err != nil {
		return zap.NewNop()
	}
	return log
}
