package config

import (
	"os"
	"time"

	"github.com/spf13/viper"
)

// AgentConfig holds all runtime configuration for the agent.
type AgentConfig struct {
	Gateway struct {
		URL               string        `mapstructure:"url"`
		ReconnectInterval time.Duration `mapstructure:"reconnect_interval"`
		MaxReconnects     int           `mapstructure:"max_reconnect_attempts"`
	} `mapstructure:"gateway"`

	Agent struct {
		Token             string `mapstructure:"token"`
		HeartbeatInterval int    `mapstructure:"heartbeat_interval"`
		CollectInterval   int    `mapstructure:"collect_interval"`
		IDFile            string `mapstructure:"id_file"`
	} `mapstructure:"agent"`

	TLS struct {
		CAFile   string `mapstructure:"ca_file"`
		CertFile string `mapstructure:"cert_file"`
		KeyFile  string `mapstructure:"key_file"`
	} `mapstructure:"tls"`

	Collectors struct {
		System     CollectorToggle `mapstructure:"system"`
		Processes  CollectorToggle `mapstructure:"processes"`
		Services   CollectorToggle `mapstructure:"services"`
		Docker     CollectorToggle `mapstructure:"docker"`
		Logs       LogCollector    `mapstructure:"logs"`
		Network    CollectorToggle `mapstructure:"network"`
	} `mapstructure:"collectors"`

	Log struct {
		Level  string `mapstructure:"level"`
		Format string `mapstructure:"format"`
		Output string `mapstructure:"output"`
	} `mapstructure:"log"`
}

type CollectorToggle struct {
	Enabled bool `mapstructure:"enabled"`
}

type LogCollector struct {
	Enabled bool     `mapstructure:"enabled"`
	Sources []string `mapstructure:"sources"`
}

// Load reads the agent configuration from the config file and environment variables.
func Load() (*AgentConfig, error) {
	cfg := &AgentConfig{}

	// Defaults
	viper.SetDefault("agent.heartbeat_interval", 30)
	viper.SetDefault("agent.collect_interval",   60)
	viper.SetDefault("agent.id_file",             defaultIDFile())
	viper.SetDefault("log.level",                 "info")
	viper.SetDefault("log.format",                "json")
	viper.SetDefault("collectors.system.enabled", true)
	viper.SetDefault("collectors.docker.enabled", true)
	viper.SetDefault("collectors.logs.enabled",   true)

	if err := viper.Unmarshal(cfg); err != nil {
		return nil, err
	}

	// Override token from environment if not in config
	if cfg.Agent.Token == "" {
		cfg.Agent.Token = os.Getenv("TENANTWARDEN_AGENT_TOKEN")
	}
	if cfg.Gateway.URL == "" {
		cfg.Gateway.URL = os.Getenv("TENANTWARDEN_GATEWAY_URL")
	}

	return cfg, nil
}

func defaultIDFile() string {
	if os.Getenv("OS") == "Windows_NT" {
		return `C:\ProgramData\TenantWarden\agent-id`
	}
	return "/etc/tenantwarden/agent-id"
}
