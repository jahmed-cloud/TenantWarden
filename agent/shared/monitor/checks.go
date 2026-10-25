package monitor

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CheckResult is sent to the portal in a "check" message.
type CheckResult struct {
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	Target       string    `json:"target"`
	OK           bool      `json:"ok"`
	LatencyMs    *int      `json:"latency_ms,omitempty"`
	StatusCode   *int      `json:"status_code,omitempty"`
	Error        string    `json:"error,omitempty"`
	CertDaysLeft *int      `json:"cert_days_left,omitempty"`
	CheckedAt    time.Time `json:"checked_at"`
}

// Checker runs each check on its own interval.
type Checker struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func NewChecker() *Checker { return &Checker{last: map[string]time.Time{}} }

// RunDue runs the checks whose interval has passed, at most 10 at a time.
func (c *Checker) RunDue(ctx context.Context, checks []Check) []CheckResult {
	now := time.Now()
	var due []Check
	c.mu.Lock()
	for _, ch := range checks {
		interval := time.Duration(max(ch.IntervalSeconds, 30)) * time.Second
		if now.Sub(c.last[ch.Name]) >= interval {
			c.last[ch.Name] = now
			due = append(due, ch)
		}
	}
	c.mu.Unlock()

	results := make([]CheckResult, len(due))
	sem := make(chan struct{}, 10)
	var wg sync.WaitGroup
	for i, ch := range due {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, ch Check) {
			defer wg.Done()
			defer func() { <-sem }()
			results[i] = Run(ctx, ch)
		}(i, ch)
	}
	wg.Wait()
	return results
}

func ms(d time.Duration) *int { v := int(d.Milliseconds()); return &v }

// Run performs one check.
func Run(ctx context.Context, ch Check) CheckResult {
	timeout := time.Duration(max(ch.TimeoutSeconds, 1)) * time.Second
	if ch.TimeoutSeconds == 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res := CheckResult{Name: ch.Name, Type: ch.Type, Target: ch.Target, CheckedAt: time.Now().UTC()}
	start := time.Now()

	switch ch.Type {
	case "tcp":
		var d net.Dialer
		conn, err := d.DialContext(ctx, "tcp", ch.Target)
		if err != nil {
			res.Error = shortError(err)
			return res
		}
		conn.Close()
		res.OK, res.LatencyMs = true, ms(time.Since(start))

	case "dns":
		addrs, err := net.DefaultResolver.LookupHost(ctx, ch.Target)
		if err != nil {
			res.Error = shortError(err)
			return res
		}
		res.LatencyMs = ms(time.Since(start))
		res.OK = len(addrs) > 0
		if ch.Contains != "" {
			res.OK = false
			for _, a := range addrs {
				if a == ch.Contains {
					res.OK = true
				}
			}
			if !res.OK {
				res.Error = fmt.Sprintf("resolved to %s, expected %s", strings.Join(addrs, ", "), ch.Contains)
			}
		}

	case "http":
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, ch.Target, nil)
		if err != nil {
			res.Error = shortError(err)
			return res
		}
		req.Header.Set("User-Agent", "TenantWarden-Agent/1.0 (endpoint check)")
		client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, DisableKeepAlives: true}}
		resp, err := client.Do(req)
		if err != nil {
			res.Error = shortError(err)
			return res
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		res.LatencyMs = ms(time.Since(start))
		code := resp.StatusCode
		res.StatusCode = &code
		if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
			days := int(time.Until(resp.TLS.PeerCertificates[0].NotAfter).Hours() / 24)
			res.CertDaysLeft = &days
		}
		res.OK = (ch.ExpectStatus == 0 && code < 400) || code == ch.ExpectStatus
		if !res.OK {
			res.Error = fmt.Sprintf("HTTP %d", code)
		} else if ch.Contains != "" && !strings.Contains(string(body), ch.Contains) {
			res.OK, res.Error = false, fmt.Sprintf("response doesn't contain %q", ch.Contains)
		}

	default:
		res.Error = "unknown check type " + ch.Type
	}
	return res
}

func shortError(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}
