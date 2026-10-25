//go:build !linux && !windows

package collectors

import (
	"context"
	"time"

	"github.com/shirou/gopsutil/v3/host"
	"go.uber.org/zap"
)

type basicCollector struct {
	log *zap.Logger
}

// NewOSCollector returns a collector for platforms without a dedicated one (macOS, BSD):
// system metrics and a host inventory, no event log yet.
func NewOSCollector(log *zap.Logger) OSCollector {
	return &basicCollector{log: log}
}

func (c *basicCollector) Inventory(ctx context.Context) (map[string]any, error) {
	inv := map[string]any{"collected_at": time.Now().UTC()}
	if k, err := host.KernelVersionWithContext(ctx); err == nil {
		inv["kernel"] = k
	}
	if out, err := run(ctx, 10*time.Second, "/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"); err == nil {
		inv["firewall"] = out
	}
	if out, err := run(ctx, 10*time.Second, "fdesetup", "status"); err == nil {
		inv["disk_encryption"] = out
	}
	return inv, nil
}

func (c *basicCollector) Events(ctx context.Context, since time.Time, extra EventSources) ([]Event, error) {
	return nil, nil
}

func (c *basicCollector) Discover(ctx context.Context) Discovery {
	return Discovery{}
}
