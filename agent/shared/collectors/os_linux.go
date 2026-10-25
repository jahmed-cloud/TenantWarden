package collectors

import (
	"bufio"
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/process"
	"go.uber.org/zap"
)

type linuxCollector struct {
	log *zap.Logger
}

// NewOSCollector returns the Linux collector (systemd journal, packages, services, firewall).
func NewOSCollector(log *zap.Logger) OSCollector {
	return &linuxCollector{log: log}
}

func (c *linuxCollector) Inventory(ctx context.Context) (map[string]any, error) {
	inv := map[string]any{"collected_at": time.Now().UTC()}

	if k, err := host.KernelVersionWithContext(ctx); err == nil {
		inv["kernel"] = k
	}
	if mgr, n, ok := c.packageCount(ctx); ok {
		inv["package_manager"] = mgr
		inv["packages"] = n
	}
	if total, security, ok := c.pendingUpdates(ctx); ok {
		inv["pending_updates"] = total
		inv["pending_security_updates"] = security
	}
	_, err := os.Stat("/var/run/reboot-required")
	inv["reboot_required"] = err == nil

	if out, err := run(ctx, 10*time.Second, "systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--plain"); err == nil {
		inv["services_running"] = len(lines(out))
	}
	if out, err := run(ctx, 10*time.Second, "systemctl", "list-units", "--type=service", "--state=failed", "--no-legend", "--plain"); err == nil {
		failed := []string{}
		for _, l := range lines(out) {
			failed = append(failed, strings.Fields(l)[0])
		}
		inv["services_failed"] = failed
	}

	inv["listening_ports"] = c.listeningPorts(ctx)
	inv["firewall"] = c.firewall(ctx)
	inv["disk_encryption"] = c.diskEncrypted(ctx)
	inv["ssh"] = sshdSettings("/etc/ssh/sshd_config")
	inv["login_users"], inv["admin_users"] = localUsers()

	if out, err := run(ctx, 10*time.Second, "docker", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"); err == nil {
		containers := []map[string]string{}
		for _, l := range lines(out) {
			f := strings.SplitN(l, "\t", 3)
			if len(f) == 3 {
				containers = append(containers, map[string]string{"name": f[0], "image": f[1], "status": f[2]})
			}
		}
		inv["containers"] = containers
	}
	return inv, nil
}

func (c *linuxCollector) packageCount(ctx context.Context) (string, int, bool) {
	if out, err := run(ctx, 30*time.Second, "dpkg-query", "-W", "-f=${binary:Package}\n"); err == nil {
		return "dpkg", len(lines(out)), true
	}
	if out, err := run(ctx, 30*time.Second, "rpm", "-qa"); err == nil {
		return "rpm", len(lines(out)), true
	}
	if out, err := run(ctx, 30*time.Second, "apk", "info"); err == nil {
		return "apk", len(lines(out)), true
	}
	return "", 0, false
}

// pendingUpdates simulates an upgrade, so it needs no root and changes nothing.
func (c *linuxCollector) pendingUpdates(ctx context.Context) (int, int, bool) {
	if out, err := run(ctx, 90*time.Second, "apt-get", "-s", "-o", "Debug::NoLocking=1", "upgrade"); err == nil {
		total, security := 0, 0
		for _, l := range lines(out) {
			if strings.HasPrefix(l, "Inst ") {
				total++
				if strings.Contains(l, "-security") {
					security++
				}
			}
		}
		return total, security, true
	}
	// dnf exits 100 when updates are available
	dnfCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	out, err := exec.CommandContext(dnfCtx, "dnf", "-q", "check-update").Output()
	var exit *exec.ExitError
	if err == nil || (errors.As(err, &exit) && exit.ExitCode() == 100) {
		total := 0
		for _, l := range lines(string(out)) {
			if len(strings.Fields(l)) == 3 {
				total++
			}
		}
		security := 0
		if sec, err := run(ctx, 90*time.Second, "dnf", "-q", "updateinfo", "list", "--security"); err == nil {
			security = len(lines(sec))
		}
		return total, security, true
	}
	return 0, 0, false
}

func (c *linuxCollector) listeningPorts(ctx context.Context) []string {
	ports := []string{}
	out, err := run(ctx, 10*time.Second, "ss", "-tulnH")
	if err != nil {
		return ports
	}
	seen := map[string]bool{}
	for _, l := range lines(out) {
		f := strings.Fields(l)
		if len(f) < 5 {
			continue
		}
		p := f[0] + " " + f[4] // e.g. "tcp 0.0.0.0:22"
		if !seen[p] {
			seen[p] = true
			ports = append(ports, p)
		}
	}
	return ports
}

func (c *linuxCollector) firewall(ctx context.Context) string {
	if out, err := run(ctx, 10*time.Second, "ufw", "status"); err == nil {
		if strings.Contains(out, "Status: active") {
			return "ufw active"
		}
		return "ufw inactive"
	}
	if out, err := run(ctx, 10*time.Second, "firewall-cmd", "--state"); err == nil {
		return "firewalld " + out
	}
	if out, err := run(ctx, 10*time.Second, "nft", "list", "ruleset"); err == nil {
		if strings.Contains(out, "chain") {
			return "nftables rules loaded"
		}
		return "nftables empty"
	}
	if os.Geteuid() != 0 {
		return "unknown (run the agent as root to read firewall state)"
	}
	return "none found (no ufw, firewalld or nftables)"
}

func (c *linuxCollector) diskEncrypted(ctx context.Context) bool {
	out, err := run(ctx, 10*time.Second, "lsblk", "-nr", "-o", "TYPE")
	return err == nil && strings.Contains(out, "crypt")
}

// sshdSettings reads the settings that matter most from sshd_config (defaults apply when unset).
func sshdSettings(path string) map[string]string {
	settings := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		return settings
	}
	defer f.Close()
	want := map[string]bool{"permitrootlogin": true, "passwordauthentication": true, "port": true}
	s := bufio.NewScanner(f)
	for s.Scan() {
		fields := strings.Fields(s.Text())
		if len(fields) < 2 || strings.HasPrefix(fields[0], "#") {
			continue
		}
		key := strings.ToLower(fields[0])
		if key == "match" {
			break // later settings only apply to matching connections
		}
		if want[key] {
			if _, set := settings[key]; !set { // sshd uses the first value it reads
				settings[key] = fields[1]
			}
		}
	}
	return settings
}

// localUsers counts accounts that can log in and lists members of the admin groups.
func localUsers() (int, []string) {
	login := 0
	if data, err := os.ReadFile("/etc/passwd"); err == nil {
		for _, l := range strings.Split(string(data), "\n") {
			f := strings.Split(l, ":")
			if len(f) == 7 && !strings.HasSuffix(f[6], "nologin") && !strings.HasSuffix(f[6], "false") && f[6] != "" {
				login++
			}
		}
	}
	admins := []string{}
	if data, err := os.ReadFile("/etc/group"); err == nil {
		for _, l := range strings.Split(string(data), "\n") {
			f := strings.Split(l, ":")
			if len(f) == 4 && (f[0] == "sudo" || f[0] == "wheel" || f[0] == "admin") && f[3] != "" {
				admins = append(admins, strings.Split(f[3], ",")...)
			}
		}
	}
	return login, admins
}

// ── Events (systemd journal) ─────────────────────────────────────────────────

type journalEntry struct {
	Priority   string          `json:"PRIORITY"`
	Unit       string          `json:"_SYSTEMD_UNIT"`
	Identifier string          `json:"SYSLOG_IDENTIFIER"`
	Comm       string          `json:"_COMM"`
	Message    json.RawMessage `json:"MESSAGE"`
	Realtime   string          `json:"__REALTIME_TIMESTAMP"`
}

func (e journalEntry) text() string {
	var s string
	if json.Unmarshal(e.Message, &s) == nil {
		return s
	}
	var b []byte // journald encodes non-UTF-8 messages as a byte array
	if json.Unmarshal(e.Message, &b) == nil {
		return string(b)
	}
	return ""
}

func (e journalEntry) time() time.Time {
	us, err := strconv.ParseInt(e.Realtime, 10, 64)
	if err != nil {
		return time.Now().UTC()
	}
	return time.UnixMicro(us).UTC()
}

func (c *linuxCollector) journal(ctx context.Context, since time.Time, args ...string) ([]journalEntry, error) {
	base := []string{"--since", fmt.Sprintf("@%d", since.Unix()), "--output=json", "--no-pager", "-q", "-n", "500"}
	out, err := run(ctx, 30*time.Second, "journalctl", append(base, args...)...)
	if err != nil {
		return nil, fmt.Errorf("journalctl: %w", err)
	}
	var entries []journalEntry
	for _, l := range lines(out) {
		var e journalEntry
		if json.Unmarshal([]byte(l), &e) == nil && e.time().After(since) {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

func priorityLevel(p string) string {
	switch p {
	case "0", "1", "2":
		return "critical"
	case "3":
		return "error"
	case "4":
		return "warning"
	}
	return "info"
}

// journalPriority is the journalctl -p ceiling for a profile level.
var journalPriority = map[string]string{"critical": "crit", "error": "err", "warning": "warning", "auto": "warning", "": "warning", "info": "info"}

func unitName(u string) string {
	if strings.Contains(u, ".") {
		return u
	}
	return u + ".service"
}

func (c *linuxCollector) Events(ctx context.Context, since time.Time, extra EventSources) ([]Event, error) {
	// Units from the monitoring profile are read on their own below, with their unit name as source
	custom := map[string]bool{}
	for _, u := range extra.Units {
		custom[unitName(u.Unit)] = true
	}

	// Warnings and worse from every unit
	entries, err := c.journal(ctx, since, "-p", "warning")
	if err != nil {
		return nil, err
	}
	var events []Event
	for _, e := range entries {
		if custom[e.Unit] {
			continue
		}
		source := e.Identifier
		if source == "" {
			source = e.Comm
		}
		if msg := e.text(); msg != "" {
			events = append(events, Event{Level: priorityLevel(e.Priority), Source: source, Message: truncate(msg, 1000), OccurredAt: e.time()})
		}
	}

	for _, u := range extra.Units {
		prio := journalPriority[u.Level]
		unitEntries, err := c.journal(ctx, since, "-u", unitName(u.Unit), "-p", prio)
		if err != nil {
			continue
		}
		for _, e := range unitEntries {
			level := u.Level
			if level == "" || level == "auto" {
				level = priorityLevel(e.Priority)
			}
			if msg := e.text(); msg != "" {
				events = append(events, Event{Level: level, Source: strings.TrimSuffix(u.Unit, ".service"), Message: truncate(msg, 1000), OccurredAt: e.time()})
			}
		}
	}

	// Failed SSH logins are logged at info level, so they need their own query
	ssh, err := c.journal(ctx, since, "-t", "sshd", "-t", "sshd-session")
	if err == nil {
		failures := map[string]int{}
		for _, e := range ssh {
			msg := e.text()
			if !strings.Contains(msg, "Failed password") && !strings.Contains(msg, "Invalid user") {
				continue
			}
			from := "unknown"
			if i := strings.Index(msg, " from "); i >= 0 {
				if f := strings.Fields(msg[i+6:]); len(f) > 0 {
					from = f[0]
				}
			}
			failures[from]++
		}
		events = append(events, bruteForce("sshd", failures, time.Now().UTC())...)
	}
	return events, nil
}

// ── Workload discovery ───────────────────────────────────────────────────────

type linuxRole struct {
	typ, label string
	units      []string // systemd units (a trailing @ matches template instances)
	procs      []string // process names when there is no systemd (containers)
	version    []string // command printing the version
	logs       []LogFile
}

var linuxRoles = []linuxRole{
	{"nginx", "nginx", []string{"nginx"}, []string{"nginx"}, []string{"nginx", "-v"},
		[]LogFile{{Source: "nginx", Path: "/var/log/nginx/error.log", Include: `\[(warn|error|crit|alert|emerg)\]`, Level: "auto"}}},
	{"apache", "Apache HTTP Server", []string{"apache2", "httpd"}, []string{"apache2", "httpd"}, []string{"apachectl", "-v"},
		[]LogFile{{Source: "apache", Path: "/var/log/apache2/error*.log", Include: `:(warn|error|crit|alert|emerg)\]`, Level: "auto"},
			{Source: "apache", Path: "/var/log/httpd/error_log", Include: `:(warn|error|crit|alert|emerg)\]`, Level: "auto"}}},
	{"mysql", "MySQL / MariaDB", []string{"mysql", "mysqld", "mariadb"}, []string{"mysqld", "mariadbd"}, []string{"mysqld", "--version"},
		[]LogFile{{Source: "MySQL", Path: "/var/log/mysql/error.log", Include: `\[(ERROR|Warning)\]`, Level: "auto"},
			{Source: "MySQL", Path: "/var/log/mysqld.log", Include: `\[(ERROR|Warning)\]`, Level: "auto"},
			{Source: "MySQL", Path: "/var/log/mariadb/mariadb.log", Include: `\[(ERROR|Warning)\]`, Level: "auto"}}},
	{"postgresql", "PostgreSQL", []string{"postgresql", "postgresql@"}, []string{"postgres"}, []string{"psql", "--version"},
		[]LogFile{{Source: "PostgreSQL", Path: "/var/log/postgresql/*.log", Include: `(ERROR|FATAL|PANIC|WARNING):`, Level: "auto"}}},
	{"sqlserver", "SQL Server", []string{"mssql-server"}, []string{"sqlservr"}, nil,
		[]LogFile{{Source: "SQL Server", Path: "/var/opt/mssql/log/errorlog", Include: `Error:|Login failed|Severity: (1[7-9]|2[0-5])`, Level: "auto", FoldLogins: true}}},
	{"redis", "Redis", []string{"redis-server", "redis"}, []string{"redis-server"}, []string{"redis-server", "--version"},
		[]LogFile{{Source: "Redis", Path: "/var/log/redis/redis*.log", Include: ` # `, Level: "warning"}}},
	{"mongodb", "MongoDB", []string{"mongod"}, []string{"mongod"}, []string{"mongod", "--version"},
		[]LogFile{{Source: "MongoDB", Path: "/var/log/mongodb/mongod.log", Include: `"s":"(F|E|W)"`, Level: "auto"}}},
	{"docker", "Docker", []string{"docker"}, []string{"dockerd"}, []string{"docker", "--version"}, nil},
	{"kubernetes", "Kubernetes node (kubelet)", []string{"kubelet"}, []string{"kubelet"}, []string{"kubelet", "--version"}, nil},
	{"haproxy", "HAProxy", []string{"haproxy"}, []string{"haproxy"}, []string{"haproxy", "-v"}, nil},
	{"bind", "BIND DNS", []string{"named", "bind9"}, []string{"named"}, []string{"named", "-v"}, nil},
	{"samba", "Samba file server", []string{"smbd"}, []string{"smbd"}, []string{"smbd", "--version"}, nil},
	{"openldap", "OpenLDAP", []string{"slapd"}, []string{"slapd"}, nil, nil},
	{"rabbitmq", "RabbitMQ", []string{"rabbitmq-server"}, nil, nil, nil},
	{"elasticsearch", "Elasticsearch", []string{"elasticsearch"}, nil, nil,
		[]LogFile{{Source: "Elasticsearch", Path: "/var/log/elasticsearch/*.log", Include: `\]\[(WARN|ERROR|FATAL)`, Level: "auto"}}},
	{"tomcat", "Apache Tomcat", []string{"tomcat", "tomcat9", "tomcat10"}, nil, nil,
		[]LogFile{{Source: "Tomcat", Path: "/var/log/tomcat*/catalina.out", Include: `(SEVERE|ERROR|WARNING)`, Level: "auto"}}},
}

type unitState struct{ active, startup string }

// systemdUnits maps unit name → state, or nil when systemd isn't running (containers).
func (c *linuxCollector) systemdUnits(ctx context.Context) map[string]*unitState {
	out, err := run(ctx, 15*time.Second, "systemctl", "list-units", "--type=service", "--all", "--no-legend", "--plain")
	if err != nil {
		return nil
	}
	units := map[string]*unitState{}
	for _, l := range lines(out) {
		if f := strings.Fields(l); len(f) >= 3 {
			units[f[0]] = &unitState{active: f[2]}
		}
	}
	if files, err := run(ctx, 15*time.Second, "systemctl", "list-unit-files", "--type=service", "--no-legend", "--plain"); err == nil {
		for _, l := range lines(files) {
			if f := strings.Fields(l); len(f) >= 2 {
				st := units[f[0]]
				if st == nil {
					st = &unitState{active: "inactive"}
					units[f[0]] = st
				}
				st.startup = map[string]string{"enabled": "auto", "disabled": "disabled", "static": "manual", "masked": "disabled"}[f[1]]
			}
		}
	}
	return units
}

func (c *linuxCollector) runningProcesses(ctx context.Context) map[string]bool {
	names := map[string]bool{}
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return names
	}
	for _, p := range procs {
		if n, err := p.NameWithContext(ctx); err == nil {
			names[n] = true
		}
	}
	return names
}

func commandVersion(ctx context.Context, args []string) string {
	if len(args) == 0 {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, args[0], args[1:]...).CombinedOutput()
	if err != nil && len(out) == 0 {
		return ""
	}
	first := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	return truncate(first, 120)
}

func (c *linuxCollector) Discover(ctx context.Context) Discovery {
	var d Discovery
	units := c.systemdUnits(ctx)
	var procs map[string]bool
	if units == nil {
		procs = c.runningProcesses(ctx)
	}

	for _, role := range linuxRoles {
		found := false
		w := Workload{Type: role.typ, Name: role.label, Details: map[string]any{}}
		if units != nil {
			for name, st := range units {
				base := strings.TrimSuffix(name, ".service")
				for _, u := range role.units {
					if base == u || (strings.HasSuffix(u, "@") && strings.HasPrefix(base, u)) {
						// Several instances (postgresql@15-main, @16-main): running wins
						if !found || st.active == "active" {
							w.Status = map[bool]string{true: "running", false: "stopped"}[st.active == "active"]
							w.Startup = st.startup
							w.Details["unit"] = name
						}
						found = true
					}
				}
			}
		} else {
			for _, p := range role.procs {
				if procs[p] {
					found = true
					w.Status = "running"
					w.Details["process"] = p
				}
			}
		}
		if !found {
			continue
		}
		w.Version = commandVersion(ctx, role.version)
		d.Workloads = append(d.Workloads, w)
		d.Logs = append(d.Logs, role.logs...)
	}
	d.Certificates = letsEncryptCertificates()
	return d
}

// letsEncryptCertificates reads the certificates certbot manages.
func letsEncryptCertificates() []Certificate {
	var certs []Certificate
	paths, _ := filepath.Glob("/etc/letsencrypt/live/*/cert.pem")
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		block, _ := pem.Decode(data)
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		certs = append(certs, Certificate{
			Subject: cert.Subject.CommonName, Issuer: cert.Issuer.CommonName, Expires: cert.NotAfter.UTC(),
			DaysLeft: int(time.Until(cert.NotAfter).Hours() / 24), SelfSigned: cert.Subject.String() == cert.Issuer.String(), Location: p,
		})
	}
	return certs
}
