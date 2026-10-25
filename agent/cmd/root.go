package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	cfgFile     string
	buildVer    string
	buildTime   string
	buildCommit string
)

func SetBuildInfo(version, time, commit string) {
	buildVer    = version
	buildTime   = time
	buildCommit = commit
}

// RootCmd is the base command when called without any subcommands.
var RootCmd = &cobra.Command{
	Use:   "tenantwarden-agent",
	Short: "TenantWarden endpoint agent",
	Long: `TenantWarden Agent: streams system metrics, security events and a host inventory
to your TenantWarden portal.

Get an enrollment token from the portal (Agents → Add agent), then:

  tenantwarden-agent register --gateway-url <url> --agent-token <token> --install`,
	SilenceUsage:  true,
	SilenceErrors: true, // main prints the error once
}

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Run the agent in the foreground (or as the installed service)",
	RunE:  func(cmd *cobra.Command, args []string) error { return runStart() },
}

var registerCmd = &cobra.Command{
	Use:   "register",
	Short: "Check the enrollment token and gateway, then save the configuration",
	RunE: func(cmd *cobra.Command, args []string) error {
		install, _ := cmd.Flags().GetBool("install")
		resetID, _ := cmd.Flags().GetBool("reset-id")
		return runRegister(install, resetID)
	},
}

var installCmd = &cobra.Command{
	Use:   "install",
	Short: "Install and start the agent as a service (systemd or Windows service)",
	RunE:  func(cmd *cobra.Command, args []string) error { return installService(configPath()) },
}

var uninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Stop and remove the agent service (keeps the configuration)",
	RunE:  func(cmd *cobra.Command, args []string) error { return uninstallService() },
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the configuration and test the connection to the gateway",
	RunE:  func(cmd *cobra.Command, args []string) error { return runStatus() },
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("TenantWarden Agent\n")
		fmt.Printf("  Version:    %s\n", buildVer)
		fmt.Printf("  Build time: %s\n", buildTime)
		fmt.Printf("  Commit:     %s\n", buildCommit)
		fmt.Printf("  Platform:   %s/%s\n", runtime.GOOS, runtime.GOARCH)
	},
}

func init() {
	cobra.OnInitialize(initConfig)

	pf := RootCmd.PersistentFlags()
	pf.StringVar(&cfgFile, "config", "", "config file (default: "+filepath.Join(configDir(), "agent.yaml")+")")
	pf.String("gateway-url", "", "agent gateway URL, e.g. wss://portal.example.com/agent or ws://host:8090/agent")
	pf.String("agent-token", "", "enrollment token from the portal (Agents → Add agent)")
	pf.String("ca-file", "", "CA certificate that signed the gateway's TLS certificate (self-signed setups)")
	pf.String("log-level", "info", "log level: debug|info|warn|error")

	_ = viper.BindPFlag("gateway.url", pf.Lookup("gateway-url"))
	_ = viper.BindPFlag("agent.token", pf.Lookup("agent-token"))
	_ = viper.BindPFlag("tls.ca_file", pf.Lookup("ca-file"))
	_ = viper.BindPFlag("log.level",   pf.Lookup("log-level"))

	sf := startCmd.Flags()
	sf.Int("heartbeat-interval", 30, "seconds between heartbeats")
	sf.Int("collect-interval", 60, "seconds between metric collections")
	sf.Int("events-interval", 300, "seconds between event log reads (0 disables)")
	sf.Int("inventory-interval", 21600, "seconds between inventory reports (0 disables)")
	sf.Int("logs-interval", 60, "seconds between reads of custom and workload log files (0 disables)")
	sf.Int("discovery-interval", 300, "seconds between server-role discoveries (0 disables)")
	_ = viper.BindPFlag("agent.heartbeat_interval", sf.Lookup("heartbeat-interval"))
	_ = viper.BindPFlag("agent.collect_interval",   sf.Lookup("collect-interval"))
	_ = viper.BindPFlag("agent.events_interval",    sf.Lookup("events-interval"))
	_ = viper.BindPFlag("agent.inventory_interval", sf.Lookup("inventory-interval"))
	_ = viper.BindPFlag("agent.logs_interval",      sf.Lookup("logs-interval"))
	_ = viper.BindPFlag("agent.discovery_interval", sf.Lookup("discovery-interval"))

	registerCmd.Flags().Bool("install", false, "also install and start the agent as a service")
	registerCmd.Flags().Bool("reset-id", false, "generate a new agent ID (needed to move a host to another tenant)")
	registerCmd.Flags().StringSlice("tags", nil, "host tags for targeting monitoring-profile items, e.g. --tags sql,prod")
	_ = viper.BindPFlag("agent.tags", registerCmd.Flags().Lookup("tags"))

	RootCmd.AddCommand(startCmd, registerCmd, installCmd, uninstallCmd, statusCmd, versionCmd)
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		viper.AddConfigPath(configDir())
		viper.AddConfigPath("$HOME/.tenantwarden")
		viper.AddConfigPath(".")
		viper.SetConfigName("agent")
		viper.SetConfigType("yaml")
	}

	viper.SetEnvPrefix("TENANTWARDEN")
	// Keys are dotted (gateway.url); env vars can't be, so TENANTWARDEN_GATEWAY_URL → gateway.url
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	_ = viper.ReadInConfig()
}

// configDir is where register writes agent.yaml and where the agent keeps its ID and state.
func configDir() string {
	if runtime.GOOS == "windows" {
		if pd := os.Getenv("ProgramData"); pd != "" {
			return filepath.Join(pd, "TenantWarden")
		}
		return `C:\ProgramData\TenantWarden`
	}
	return "/etc/tenantwarden"
}

// configPath is the config file in use: --config, the file viper found, or the default.
func configPath() string {
	if cfgFile != "" {
		if abs, err := filepath.Abs(cfgFile); err == nil {
			return abs
		}
		return cfgFile
	}
	if used := viper.ConfigFileUsed(); used != "" {
		return used
	}
	return filepath.Join(configDir(), "agent.yaml")
}

// stateDir holds the agent ID and the event-log bookmark, next to the config file.
func stateDir() string {
	return filepath.Dir(configPath())
}
