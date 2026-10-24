package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	cfgFile   string
	buildVer  string
	buildTime string
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
	Short: "TenantWarden infrastructure agent",
	Long: `TenantWarden Agent — collects system metrics, security events,
and telemetry and streams them securely to the TenantWarden platform.`,
}

// startCmd runs the agent daemon.
var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the TenantWarden agent",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runAgent()
	},
}

// registerCmd registers this agent with the platform.
var registerCmd = &cobra.Command{
	Use:   "register",
	Short: "Register this agent with the TenantWarden platform",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runRegister()
	},
}

// statusCmd prints current agent status.
var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show agent status",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runStatus()
	},
}

// versionCmd prints build information.
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("TenantWarden Agent\n")
		fmt.Printf("  Version:    %s\n", buildVer)
		fmt.Printf("  Build time: %s\n", buildTime)
		fmt.Printf("  Commit:     %s\n", buildCommit)
	},
}

func init() {
	cobra.OnInitialize(initConfig)

	RootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default: /etc/tenantwarden/agent.yaml)")
	RootCmd.PersistentFlags().String("gateway-url", "", "TenantWarden agent gateway URL (e.g. wss://host:4433)")
	RootCmd.PersistentFlags().String("agent-token", "", "Agent registration token")
	RootCmd.PersistentFlags().String("log-level", "info", "Log level: debug|info|warn|error")
	RootCmd.PersistentFlags().Bool("no-color", false, "Disable colored log output")

	_ = viper.BindPFlag("gateway.url",    RootCmd.PersistentFlags().Lookup("gateway-url"))
	_ = viper.BindPFlag("agent.token",    RootCmd.PersistentFlags().Lookup("agent-token"))
	_ = viper.BindPFlag("log.level",      RootCmd.PersistentFlags().Lookup("log-level"))

	startCmd.Flags().Int("heartbeat-interval", 30, "Heartbeat interval in seconds")
	startCmd.Flags().Int("collect-interval", 60, "Metrics collection interval in seconds")
	startCmd.Flags().Bool("collect-events", true, "Collect system event logs")
	startCmd.Flags().Bool("collect-processes", false, "Collect running process list")

	_ = viper.BindPFlag("agent.heartbeat_interval", startCmd.Flags().Lookup("heartbeat-interval"))
	_ = viper.BindPFlag("agent.collect_interval",   startCmd.Flags().Lookup("collect-interval"))

	RootCmd.AddCommand(startCmd, registerCmd, statusCmd, versionCmd)
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		viper.AddConfigPath("/etc/tenantwarden")
		viper.AddConfigPath("$HOME/.tenantwarden")
		viper.AddConfigPath(".")
		viper.SetConfigName("agent")
		viper.SetConfigType("yaml")
	}

	viper.SetEnvPrefix("TENANTWARDEN")
	// Keys are dotted (gateway.url); env vars can't be, so TENANTWARDEN_GATEWAY_URL → gateway.url
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err == nil {
		fmt.Printf("Using config: %s\n", viper.ConfigFileUsed())
	}
}
