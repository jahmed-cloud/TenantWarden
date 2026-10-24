package transport

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// MessageType identifies the kind of message sent over the wire.
type MessageType string

const (
	MsgHeartbeat    MessageType = "heartbeat"
	MsgMetrics      MessageType = "metrics"
	MsgEvent        MessageType = "event"
	MsgAlert        MessageType = "alert"
	MsgRegistration MessageType = "registration"
	MsgAck          MessageType = "ack"
	MsgCommand      MessageType = "command"
)

// Message is the envelope for all agent ↔ gateway communication.
type Message struct {
	Type      MessageType     `json:"type"`
	AgentID   string          `json:"agent_id"`
	TenantID  string          `json:"tenant_id"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

// CommandHandler is called when the gateway sends a command to the agent.
type CommandHandler func(cmd string, args map[string]any) error

// WSTransport manages the persistent WebSocket connection to the gateway.
type WSTransport struct {
	gatewayURL     string
	agentID        string
	tenantID       string
	jwtToken       string
	certFile       string
	keyFile        string
	caFile         string
	log            *zap.Logger

	mu             sync.Mutex
	conn           *websocket.Conn
	connected      bool
	reconnectDelay time.Duration
	maxReconnect   int
	sendCh         chan Message
	cmdHandlers    map[string]CommandHandler
	done           chan struct{}
}

// NewWSTransport creates a new transport. Call Connect() to establish the link.
func NewWSTransport(opts TransportOptions) *WSTransport {
	return &WSTransport{
		gatewayURL:     opts.GatewayURL,
		agentID:        opts.AgentID,
		tenantID:       opts.TenantID,
		jwtToken:       opts.JWTToken,
		certFile:       opts.CertFile,
		keyFile:        opts.KeyFile,
		caFile:         opts.CAFile,
		log:            opts.Log,
		reconnectDelay: 5 * time.Second,
		maxReconnect:   20,
		sendCh:         make(chan Message, 256),
		cmdHandlers:    make(map[string]CommandHandler),
		done:           make(chan struct{}),
	}
}

type TransportOptions struct {
	GatewayURL string
	AgentID    string
	TenantID   string
	JWTToken   string
	CertFile   string
	KeyFile    string
	CAFile     string
	Log        *zap.Logger
}

// RegisterCommandHandler registers a handler for a specific gateway command.
func (t *WSTransport) RegisterCommandHandler(cmd string, h CommandHandler) {
	t.cmdHandlers[cmd] = h
}

// Send queues a message for delivery. Non-blocking; drops if queue is full.
func (t *WSTransport) Send(msg Message) bool {
	msg.AgentID  = t.agentID
	msg.TenantID = t.tenantID
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now().UTC()
	}
	select {
	case t.sendCh <- msg:
		return true
	default:
		t.log.Warn("send queue full, dropping message", zap.String("type", string(msg.Type)))
		return false
	}
}

// Connect establishes the WebSocket connection with auto-reconnect.
func (t *WSTransport) Connect(ctx context.Context) error {
	go t.loop(ctx)
	return nil
}

// Close shuts down the transport.
func (t *WSTransport) Close() {
	close(t.done)
}

func (t *WSTransport) loop(ctx context.Context) {
	attempts := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.done:
			return
		default:
		}

		t.log.Info("connecting to gateway", zap.String("url", t.gatewayURL), zap.Int("attempt", attempts+1))

		if err := t.connect(ctx); err != nil {
			attempts++
			delay := t.reconnectDelay * time.Duration(min(attempts, t.maxReconnect))
			t.log.Warn("connection failed", zap.Error(err), zap.Duration("retry_in", delay))
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return
			case <-t.done:
				return
			}
			continue
		}

		attempts = 0
		t.log.Info("connected to gateway")

		if err := t.readWriteLoop(ctx); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				t.log.Info("connection closed by gateway")
			} else {
				t.log.Warn("connection error", zap.Error(err))
			}
		}
	}
}

func (t *WSTransport) connect(ctx context.Context) error {
	tlsCfg, err := t.buildTLSConfig()
	if err != nil {
		return fmt.Errorf("TLS config: %w", err)
	}

	dialer := websocket.Dialer{
		TLSClientConfig:  tlsCfg,
		HandshakeTimeout: 15 * time.Second,
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+t.jwtToken)
	header.Set("X-Agent-ID",    t.agentID)
	header.Set("X-Tenant-ID",   t.tenantID)

	conn, _, err := dialer.DialContext(ctx, t.gatewayURL, header)
	if err != nil {
		return err
	}

	t.mu.Lock()
	t.conn      = conn
	t.connected = true
	t.mu.Unlock()

	return nil
}

func (t *WSTransport) readWriteLoop(ctx context.Context) error {
	conn := t.conn
	defer func() {
		conn.Close()
		t.mu.Lock()
		t.connected = false
		t.mu.Unlock()
	}()

	// gorilla/websocket allows one concurrent reader and one concurrent writer, so
	// reads get their own goroutine. A read error is permanent for the connection
	// (gorilla panics after repeated reads on a failed one), so any read error —
	// including the 90s liveness timeout — ends this connection and loop() reconnects.
	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})

	readErr := make(chan error, 1)
	go func() {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				readErr <- err
				return
			}
			conn.SetReadDeadline(time.Now().Add(90 * time.Second))
			t.handleIncoming(data)
		}
	}()

	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil

		case <-t.done:
			return nil

		case err := <-readErr:
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				return nil
			}
			return err

		case <-pingTicker.C:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return err
			}

		case msg, ok := <-t.sendCh:
			if !ok {
				return nil
			}
			data, _ := json.Marshal(msg)
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return err
			}
		}
	}
}

func (t *WSTransport) handleIncoming(data []byte) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		t.log.Warn("malformed message from gateway", zap.Error(err))
		return
	}

	if msg.Type == MsgCommand {
		var cmd struct {
			Command string         `json:"command"`
			Args    map[string]any `json:"args"`
		}
		if err := json.Unmarshal(msg.Payload, &cmd); err != nil {
			return
		}
		if h, ok := t.cmdHandlers[cmd.Command]; ok {
			if err := h(cmd.Command, cmd.Args); err != nil {
				t.log.Error("command handler error", zap.String("cmd", cmd.Command), zap.Error(err))
			}
		}
	}
}

func (t *WSTransport) buildTLSConfig() (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS13}

	if t.caFile != "" {
		caPEM, err := os.ReadFile(t.caFile)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		pool.AppendCertsFromPEM(caPEM)
		cfg.RootCAs = pool
	}

	if t.certFile != "" && t.keyFile != "" {
		cert, err := tls.LoadX509KeyPair(t.certFile, t.keyFile)
		if err != nil {
			return nil, err
		}
		cfg.Certificates = []tls.Certificate{cert}
	}

	return cfg, nil
}

func min(a, b int) int {
	if a < b { return a }
	return b
}
