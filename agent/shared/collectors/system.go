package collectors

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"go.uber.org/zap"
)

// SystemMetrics holds a point-in-time snapshot of system resources.
type SystemMetrics struct {
	CollectedAt time.Time `json:"collected_at"`
	Hostname    string    `json:"hostname"`
	Platform    string    `json:"platform"`
	OS          string    `json:"os"`
	OSVersion   string    `json:"os_version"`
	KernelArch  string    `json:"kernel_arch"`
	Uptime      uint64    `json:"uptime_seconds"`

	CPU     CPUMetrics     `json:"cpu"`
	Memory  MemoryMetrics  `json:"memory"`
	Disks   []DiskMetrics  `json:"disks"`
	Network []NetMetrics   `json:"network"`
}

type CPUMetrics struct {
	LogicalCores  int     `json:"logical_cores"`
	PhysicalCores int     `json:"physical_cores"`
	UsagePercent  float64 `json:"usage_percent"`
	LoadAvg1      float64 `json:"load_avg_1m,omitempty"`
	LoadAvg5      float64 `json:"load_avg_5m,omitempty"`
	LoadAvg15     float64 `json:"load_avg_15m,omitempty"`
}

type MemoryMetrics struct {
	TotalBytes     uint64  `json:"total_bytes"`
	UsedBytes      uint64  `json:"used_bytes"`
	AvailableBytes uint64  `json:"available_bytes"`
	UsagePercent   float64 `json:"usage_percent"`
	SwapTotalBytes uint64  `json:"swap_total_bytes"`
	SwapUsedBytes  uint64  `json:"swap_used_bytes"`
}

type DiskMetrics struct {
	Device       string  `json:"device"`
	Mountpoint   string  `json:"mountpoint"`
	FSType       string  `json:"fs_type"`
	TotalBytes   uint64  `json:"total_bytes"`
	UsedBytes    uint64  `json:"used_bytes"`
	FreeBytes    uint64  `json:"free_bytes"`
	UsagePercent float64 `json:"usage_percent"`
}

type NetMetrics struct {
	Interface    string `json:"interface"`
	BytesSent    uint64 `json:"bytes_sent"`
	BytesRecv    uint64 `json:"bytes_recv"`
	PacketsSent  uint64 `json:"packets_sent"`
	PacketsRecv  uint64 `json:"packets_recv"`
	ErrIn        uint64 `json:"err_in"`
	ErrOut       uint64 `json:"err_out"`
}

// SystemCollector gathers OS-level metrics.
type SystemCollector struct {
	log *zap.Logger
}

func NewSystemCollector(log *zap.Logger) *SystemCollector {
	return &SystemCollector{log: log}
}

// Collect gathers a full system metrics snapshot.
func (c *SystemCollector) Collect(ctx context.Context) (*SystemMetrics, error) {
	metrics := &SystemMetrics{
		CollectedAt: time.Now().UTC(),
		Platform:    runtime.GOOS,
	}

	// ── Host info ────────────────────────────────────────────────────────────
	if info, err := host.InfoWithContext(ctx); err == nil {
		metrics.Hostname   = info.Hostname
		metrics.OS         = info.OS
		metrics.OSVersion  = info.PlatformVersion
		metrics.KernelArch = info.KernelArch
		metrics.Uptime     = info.Uptime
	} else {
		c.log.Warn("failed to collect host info", zap.Error(err))
	}

	// ── CPU ───────────────────────────────────────────────────────────────────
	if pct, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(pct) > 0 {
		metrics.CPU.UsagePercent = roundFloat(pct[0], 2)
	}
	if logical, err := cpu.CountsWithContext(ctx, true); err == nil {
		metrics.CPU.LogicalCores = logical
	}
	if physical, err := cpu.CountsWithContext(ctx, false); err == nil {
		metrics.CPU.PhysicalCores = physical
	}

	// ── Memory ────────────────────────────────────────────────────────────────
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		metrics.Memory = MemoryMetrics{
			TotalBytes:     vm.Total,
			UsedBytes:      vm.Used,
			AvailableBytes: vm.Available,
			UsagePercent:   roundFloat(vm.UsedPercent, 2),
		}
	}
	if sm, err := mem.SwapMemoryWithContext(ctx); err == nil {
		metrics.Memory.SwapTotalBytes = sm.Total
		metrics.Memory.SwapUsedBytes  = sm.Used
	}

	// ── Disks ─────────────────────────────────────────────────────────────────
	if parts, err := disk.PartitionsWithContext(ctx, false); err == nil {
		for _, p := range parts {
			usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
			if err != nil {
				continue
			}
			metrics.Disks = append(metrics.Disks, DiskMetrics{
				Device:       p.Device,
				Mountpoint:   p.Mountpoint,
				FSType:       p.Fstype,
				TotalBytes:   usage.Total,
				UsedBytes:    usage.Used,
				FreeBytes:    usage.Free,
				UsagePercent: roundFloat(usage.UsedPercent, 2),
			})
		}
	}

	// ── Network ───────────────────────────────────────────────────────────────
	if ifaces, err := net.IOCountersWithContext(ctx, true); err == nil {
		for _, iface := range ifaces {
			if iface.BytesRecv == 0 && iface.BytesSent == 0 {
				continue // skip loopback / inactive
			}
			metrics.Network = append(metrics.Network, NetMetrics{
				Interface:   iface.Name,
				BytesSent:   iface.BytesSent,
				BytesRecv:   iface.BytesRecv,
				PacketsSent: iface.PacketsSent,
				PacketsRecv: iface.PacketsRecv,
				ErrIn:       iface.Errin,
				ErrOut:      iface.Errout,
			})
		}
	}

	return metrics, nil
}

// Summary returns a short human-readable string for logging.
func (m *SystemMetrics) Summary() string {
	return fmt.Sprintf("cpu=%.1f%% mem=%.1f%% disks=%d",
		m.CPU.UsagePercent, m.Memory.UsagePercent, len(m.Disks))
}

func roundFloat(f float64, digits int) float64 {
	pow := 1.0
	for i := 0; i < digits; i++ {
		pow *= 10
	}
	return float64(int(f*pow+0.5)) / pow
}
