package main

import (
	"fmt"
	"os"

	"github.com/tenantwarden/agent/cmd"
)

// Build-time variables injected via -ldflags
var (
	Version   = "dev"
	BuildTime = "unknown"
	Commit    = "none"
)

func main() {
	cmd.SetBuildInfo(Version, BuildTime, Commit)

	if err := cmd.RootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
