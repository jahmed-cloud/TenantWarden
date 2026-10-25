//go:build !linux

package collectors

import (
	"context"

	"github.com/shirou/gopsutil/v3/net"
)

// connectionCounts counts TCP sockets by state (Windows: GetExtendedTcpTable, no admin needed).
func connectionCounts(ctx context.Context) (*ConnCounts, error) {
	conns, err := net.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, err
	}
	c := &ConnCounts{Total: len(conns)}
	for _, conn := range conns {
		switch conn.Status {
		case "ESTABLISHED":
			c.Established++
		case "LISTEN":
			c.Listen++
		case "TIME_WAIT":
			c.TimeWait++
		case "CLOSE_WAIT":
			c.CloseWait++
		}
	}
	return c, nil
}
