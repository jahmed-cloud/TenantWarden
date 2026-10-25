package collectors

import (
	"bufio"
	"context"
	"os"
	"strings"
)

// connectionCounts reads /proc/net/tcp{,6} directly: gopsutil also maps every socket to its
// process, which means walking /proc/*/fd on each collection.
func connectionCounts(ctx context.Context) (*ConnCounts, error) {
	c := &ConnCounts{}
	read := 0
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		read++
		s := bufio.NewScanner(f)
		s.Scan() // header
		for s.Scan() {
			fields := strings.Fields(s.Text())
			if len(fields) < 4 {
				continue
			}
			c.Total++
			switch fields[3] { // st, hex TCP state
			case "01":
				c.Established++
			case "0A":
				c.Listen++
			case "06":
				c.TimeWait++
			case "08":
				c.CloseWait++
			}
		}
		f.Close()
	}
	if read == 0 {
		return nil, os.ErrNotExist
	}
	return c, nil
}
