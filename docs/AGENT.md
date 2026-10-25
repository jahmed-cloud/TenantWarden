# TenantWarden agent

The agent is one static Go binary for Windows, Linux (amd64/arm64) and macOS. It keeps a WebSocket
connection to the agent gateway and sends:

| Message | How often | What |
| --- | --- | --- |
| `registration` | every (re)connect | hostname, OS name and version, kernel, architecture, the IP it uses to reach the portal, tags |
| `heartbeat` | 30 s | marks the agent online (Redis key with a 2-minute TTL) |
| `metrics` | 60 s | CPU, memory, swap, every disk, **network throughput** (per interface) and **TCP connection counts**, uptime |
| `event` | 5 min / 1 min | OS events since the last read (5 min) and new lines from log files (1 min) |
| `inventory` | at start, every 6 h | security posture of the host; server roles and certificates are refreshed every 5 min |
| `check` | per check | results of the TCP / HTTP / DNS endpoint checks in the monitoring profile |

The gateway sends the tenant's **monitoring profile** (`config` message) when the agent connects and again
whenever someone saves it in the portal; it takes effect within seconds.

The portal shows it all: **Agents** (fleet, per-host sheet with resource and network history, security
checks, server roles, certificates, software, events), **Workloads** (server roles across hosts with their
own logs and charts), **Network** (throughput, connections, risky open ports, endpoint checks) and **Query**.

## Install

Create a token under **Agents → Add agent** and run the command the dialog shows. By hand:

```bash
# Linux (amd64; use -linux-arm64 on ARM)
curl -fsSLo tenantwarden-agent https://<portal>/downloads/tenantwarden-agent-linux-amd64
chmod +x tenantwarden-agent
sudo ./tenantwarden-agent register --gateway-url wss://<portal>/agent --agent-token <token> --tags web,prod --install
```

```powershell
# Windows, elevated PowerShell
Invoke-WebRequest -Uri "https://<portal>/downloads/tenantwarden-agent.exe" -OutFile tenantwarden-agent.exe
.\tenantwarden-agent.exe register --gateway-url "wss://<portal>/agent" --agent-token "<token>" --tags sql,prod --install
```

```bash
# macOS (no service installer yet: run it from launchd or a terminal)
curl -fsSLo tenantwarden-agent https://<portal>/downloads/tenantwarden-agent-darwin-arm64   # or -darwin-amd64
chmod +x tenantwarden-agent
sudo ./tenantwarden-agent register --gateway-url wss://<portal>/agent --agent-token <token>
sudo ./tenantwarden-agent start
```

Verify a download against `https://<portal>/downloads/SHA256SUMS`.

`register`:

1. decodes the token and stops early if it is expired or not an agent token,
2. opens a test connection to the gateway (a wrong URL, certificate or token fails here, not later),
3. writes `agent.yaml`, readable by root/SYSTEM and Administrators only,
4. with `--install`, copies the binary to `/usr/local/bin` or `C:\Program Files\TenantWarden` and installs
   the `tenantwarden-agent` systemd unit or the `TenantWardenAgent` Windows service (automatic start,
   restart on failure).

`--tags` labels the host; monitoring-profile items can target tags (and host-name patterns).

### Gateway URL

- Through the portal gateway: `wss://<portal>/agent` (or `ws://<host>:8090/agent` on a LAN without TLS).
- Straight to the agent gateway: `wss://<host>:4433`.

`/ws` is appended unless the URL already ends with it, and `http(s)://` is accepted too. With the development
certificates from `make certs`, pass `--ca-file ca.crt`; the portal serves the dev CA at `/downloads/ca.crt`.

## Custom log monitoring

Define log files to watch under **Agents → Monitoring profile → Custom log files** (pushed to every agent of the
tenant), or in the host's `agent.yaml`:

```yaml
monitoring:
  logs:
    - name: myapp                    # events arrive with source "log:myapp"
      path: /var/log/myapp/*.log     # a file or glob; Windows: 'C:\App\logs\*.log'
      include: "ERROR|FATAL"         # regular expression, case-insensitive; only matching lines are sent
      exclude: "healthcheck"         # optional
      level: auto                    # auto (from the line: fatal/panic → critical, error → error, warn → warning) or a fixed level
      platform: linux                # optional: windows | linux | macos
      hosts: ["web-*"]               # optional host-name patterns
      tags: ["prod"]                 # optional tags (from register --tags)
      from_start: false              # true reads an existing file from the beginning once
```

How it behaves:

- New files start at their end, so the agent doesn't replay history; offsets survive restarts
  (`log-offsets.json`), and rotation or truncation is detected (the file's first bytes change or it shrinks).
- Up to 200 matching lines per source per read are sent; any more are summarised in one event.
- UTF-16 files (SQL Server's ERRORLOG) are decoded. Symlinks to `/dev/*` (container images that log to stdout) are skipped.
- A pattern Go can't compile, or a path that matches nothing, produces one warning event so you notice.
- A `critical` line raises an alert. For anything else, add a rule: the rule library has **Errors in a custom log**
  (`AgentEvents | where source startswith "log:" and level in ("error", "critical") | summarize count() by hostname, source`).

Extra event sources:

- **Windows event channels** (`event_channels`): any Event Log channel, optionally limited to event IDs. Without IDs only
  critical, error and warning entries are read. Example: `Microsoft-Windows-PowerShell/Operational` ID 4104 (script blocks).
- **Linux journal units** (`journal_units`): a systemd unit's journal at the chosen level (`info` reads everything).

## Server roles (workloads)

Every 5 minutes the agent looks for server roles and reports their status (running / stopped), start mode and version.

| Platform | Roles |
| --- | --- |
| Windows | SQL Server (instances from the registry: edition, version, TCP port, SQL Agent state), IIS (site count), Active Directory Domain Services, DNS, DHCP, Hyper-V (VM count), AD Certificate Services, WSUS, Exchange, Reporting / Integration Services, Docker, MySQL, PostgreSQL, MongoDB, Redis, Tomcat; on servers also File Server (shared folders), Print Spooler and Remote Desktop |
| Linux | nginx, Apache, MySQL / MariaDB, PostgreSQL, SQL Server on Linux, Redis, MongoDB, Docker, Kubernetes (kubelet), HAProxy, BIND, Samba, OpenLDAP, RabbitMQ, Elasticsearch, Tomcat — from systemd, or from running processes in containers |

Their logs are collected automatically:

- **SQL Server on Windows**: the instance's Application-log entries. Failed logins (error 18456) are counted per client
  address and become `N failed logins from <client>` events (critical at 10 or more per read); storage I/O errors
  (823/824/825), a full log (9002), a full filegroup (1105) and scheduler hangs are critical; other errors and warnings
  keep their level. Source `SQL Server`.
- **Active Directory / DNS / Hyper-V / Certificate Services**: errors and warnings from their own event channels.
- **Linux**: the error logs of nginx, Apache, MySQL, PostgreSQL, Redis, MongoDB, Elasticsearch, Tomcat and SQL Server
  (`/var/opt/mssql/log/errorlog`, with failed-login folding), filtered to warnings and errors.

Certificates are collected too: the Windows `LocalMachine\My` store and Let's Encrypt on Linux, with days to expiry.

Rules for workloads: **SQL Server service stopped**, **Server role stopped** (only for roles set to start automatically),
**SQL Server login failures**, **SQL Server errors**, **Certificates expiring soon**, plus query templates such as
**SQL Server deadlocks** and **Web server 5xx bursts**.

## Network monitoring

- **Throughput**: bytes per second in and out since the previous sample, per interface and in total. Loopback and
  container/VM bridges (`veth*`, `docker*`, `br-*`, `virbr*`, `cni*`, …) are left out so traffic isn't counted twice.
- **Connections**: TCP sockets by state (established, listening, time-wait, close-wait).
- **Listening ports**: from the inventory; the Network page flags risky services (RDP, SMB, Telnet, FTP, SQL Server,
  MySQL, PostgreSQL, Redis, MongoDB, Elasticsearch) listening on all interfaces.
- **Endpoint checks**: synthetic tests run from inside your network, defined in the monitoring profile:

  ```yaml
  monitoring:
    checks:
      - name: sql01-port
        type: tcp                   # host:port answers
        target: sql01.corp.local:1433
      - name: intranet
        type: http                  # status < 400 (or expect_status), optional body text; reports TLS certificate days left
        target: https://intranet.corp.local/health
        interval_seconds: 60
        contains: "OK"
      - name: dc-dns
        type: dns                   # resolves (optionally to a given address)
        target: corp.local
  ```

  Results show on the Network page with latency history; **Endpoint check failing** and **Slow endpoint** are default /
  library rules.

## Commands

| Command | |
| --- | --- |
| `register --gateway-url … --agent-token … [--ca-file …] [--tags a,b] [--install] [--reset-id]` | check and save the configuration |
| `install` / `uninstall` | add or remove the service (the configuration stays) |
| `status` | configuration, service state, token expiry and a live connection test |
| `start [--collect-interval 60] [--events-interval 300] [--logs-interval 60] [--discovery-interval 300] [--inventory-interval 21600]` | run in the foreground (this is also what the service runs) |
| `version` | build information |

`--reset-id` gives the host a new agent ID. An ID is bound to the first tenant it connects with, so moving a host
to another tenant needs a new one.

## Files

| | Linux | Windows |
| --- | --- | --- |
| Configuration | `/etc/tenantwarden/agent.yaml` | `C:\ProgramData\TenantWarden\agent.yaml` |
| Agent ID | `/etc/tenantwarden/agent-id` | `C:\ProgramData\TenantWarden\agent-id` |
| Event bookmark | `/etc/tenantwarden/events-since` | `C:\ProgramData\TenantWarden\events-since` |
| Log-file offsets | `/etc/tenantwarden/log-offsets.json` | `C:\ProgramData\TenantWarden\log-offsets.json` |
| Logs | `journalctl -u tenantwarden-agent` | `C:\ProgramData\TenantWarden\agent.log` |

Every key can also come from the environment, e.g. `TENANTWARDEN_GATEWAY_URL`, `TENANTWARDEN_AGENT_TOKEN`,
`TENANTWARDEN_TLS_CA_FILE`, `TENANTWARDEN_AGENT_EVENTS_INTERVAL`. See [agent.yaml.example](../agent/agent.yaml.example).

## Built-in events

**Linux:** systemd journal entries at warning level or worse (priority 0–2 → critical, 3 → error, 4 → warning), and
failed SSH logins counted per source address.

**Windows:** System and Application errors and critical events; Security log 1102 (audit log cleared, critical), 4720
(user created), 4732 (added to a local group; critical for Administrators), 4740 (account locked out); Defender
detections and real-time protection being turned off (critical); failed logons (4625) counted per source. The
Security log needs the agent to run as SYSTEM, which the service does.

Ten or more failed logins from one source in one read become a **critical** brute-force event. Every critical event
raises an alert (one open alert per host and event source). The agent remembers where it stopped reading, so a
restart neither repeats nor skips events.

## Inventory

**Windows:** OS edition and build, last patch, last boot, domain, Defender (antivirus, real-time and tamper
protection, signature age), firewall profiles, BitLocker per volume, UAC, Remote Desktop, local administrators,
running services, listening TCP ports, installed programs, pending Windows updates.

**Linux:** kernel, package count, pending updates (security updates on apt and dnf), reboot required, running and
failed systemd services, listening ports, firewall (ufw / firewalld / nftables), LUKS encryption, SSH root and
password login, accounts with a login shell, sudo/wheel members, Docker containers.

**macOS:** kernel, application firewall and FileVault state.

Both also carry the server roles and certificates described above.

## Revoking

- **Agents → Enrollment tokens → revoke**: every agent using that token is refused on its next connection.
- **Remove agent** in the host sheet deletes its history, events and check results; uninstall it on the host first
  (`tenantwarden-agent uninstall`) or it registers again.

## Building

```bash
make build-agent        # from the repository root; uses Docker when Go isn't installed
cd agent && make all    # with a local Go 1.22 toolchain: vet + all platforms + SHA256SUMS
```
