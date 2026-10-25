// Tables the query language can read. Every dataset is filtered to one tenant ($1) before any
// user condition, and only the fields listed here exist — the compiler never emits SQL from user text.

export type FieldType = 'text' | 'number' | 'time' | 'bool' | 'json'

export interface Dataset {
  name:        string
  description: string
  from:        string
  /** Tenant filter; $1 is the tenant id */
  tenant:      string
  /** Column the time range (rule window / explorer range) applies to */
  time?:       string
  fields:      Record<string, { sql: string; type: FieldType; description?: string }>
}

const online = `CASE WHEN a.last_heartbeat_at > NOW() - INTERVAL '2 minutes' THEN 'online' ELSE 'offline' END`

export const DATASETS: Dataset[] = [
  {
    name: 'AgentEvents', description: 'Events from agents: Windows Event Log, systemd journal, workload logs (source "SQL Server", "nginx" …) and custom log files (source "log:<name>")',
    from: 'agent_events e', tenant: 'e.tenant_id = $1', time: 'e.occurred_at',
    fields: {
      occurred_at: { sql: 'e.occurred_at', type: 'time' },
      hostname:    { sql: 'e.hostname', type: 'text' },
      level:       { sql: 'e.level', type: 'text', description: 'critical | error | warning | info' },
      source:      { sql: 'e.source', type: 'text' },
      message:     { sql: 'e.message', type: 'text' },
      agent_id:    { sql: 'e.agent_id::text', type: 'text' },
    },
  },
  {
    name: 'Agents', description: 'One row per host with its latest readings; inventory.<key> reads the security inventory',
    from: 'agents a', tenant: 'a.tenant_id = $1',
    fields: {
      hostname:    { sql: 'a.hostname', type: 'text' },
      status:      { sql: online, type: 'text', description: 'online | offline' },
      platform:    { sql: 'a.platform::text', type: 'text' },
      os:          { sql: 'a.os_name', type: 'text' },
      os_version:  { sql: 'a.os_version', type: 'text' },
      version:     { sql: 'a.version', type: 'text', description: 'agent version' },
      ip:          { sql: 'host(a.ip_address)', type: 'text' },
      tags:        { sql: `array_to_string(a.tags, ',')`, type: 'text' },
      cpu:         { sql: 'a.cpu_percent::float8', type: 'number', description: '%' },
      memory:      { sql: 'a.memory_percent::float8', type: 'number', description: '%' },
      disk:        { sql: 'a.disk_percent::float8', type: 'number', description: 'fullest disk, %' },
      net_mbps:    { sql: '((COALESCE(a.net_rx_bps, 0) + COALESCE(a.net_tx_bps, 0)) * 8 / 1e6)::float8', type: 'number', description: 'in + out, Mbit/s' },
      uptime_hours:{ sql: '(a.uptime_seconds / 3600.0)::float8', type: 'number' },
      last_report: { sql: 'a.last_heartbeat_at', type: 'time' },
      inventory:   { sql: 'a.inventory', type: 'json', description: 'e.g. inventory.pending_updates, inventory.defender.realtime_protection' },
    },
  },
  {
    name: 'Workloads', description: 'Server roles the agents discovered (SQL Server, IIS, AD DS, DNS, nginx, MySQL, PostgreSQL …)',
    from: `agents a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.inventory->'workloads') = 'array' THEN a.inventory->'workloads' ELSE '[]'::jsonb END) w`,
    tenant: 'a.tenant_id = $1',
    fields: {
      hostname: { sql: 'a.hostname', type: 'text' },
      type:     { sql: `w->>'type'`, type: 'text', description: 'sqlserver | iis | adds | dns | dhcp | hyperv | fileserver | nginx | apache | mysql | postgresql | redis | mongodb | docker …' },
      name:     { sql: `w->>'name'`, type: 'text' },
      status:   { sql: `w->>'status'`, type: 'text', description: 'running | stopped' },
      version:  { sql: `w->>'version'`, type: 'text' },
      details:  { sql: `w->'details'`, type: 'json' },
    },
  },
  {
    name: 'Checks', description: 'Latest result of every endpoint check (TCP, HTTP, DNS) per agent',
    from: 'endpoint_checks c', tenant: 'c.tenant_id = $1',
    fields: {
      hostname:       { sql: 'c.hostname', type: 'text', description: 'agent running the check' },
      name:           { sql: 'c.name', type: 'text' },
      type:           { sql: 'c.type', type: 'text' },
      target:         { sql: 'c.target', type: 'text' },
      ok:             { sql: 'c.ok', type: 'bool' },
      latency_ms:     { sql: 'c.latency_ms::float8', type: 'number' },
      status_code:    { sql: 'c.status_code::float8', type: 'number' },
      error:          { sql: 'c.error', type: 'text' },
      cert_days_left: { sql: 'c.cert_days_left::float8', type: 'number' },
      checked_at:     { sql: 'c.checked_at', type: 'time' },
      failing_since:  { sql: 'c.failing_since', type: 'time' },
    },
  },
  {
    name: 'CheckHistory', description: 'Every endpoint check result (kept 14 days)',
    from: 'endpoint_check_results r', tenant: 'r.tenant_id = $1', time: 'r.checked_at',
    fields: {
      checked_at: { sql: 'r.checked_at', type: 'time' },
      name:       { sql: 'r.name', type: 'text' },
      ok:         { sql: 'r.ok', type: 'bool' },
      latency_ms: { sql: 'r.latency_ms::float8', type: 'number' },
      agent_id:   { sql: 'r.agent_id::text', type: 'text' },
    },
  },
  {
    name: 'Alerts', description: 'Alerts raised in this portal',
    from: 'alerts al', tenant: 'al.tenant_id = $1', time: 'al.created_at',
    fields: {
      created_at:  { sql: 'al.created_at', type: 'time' },
      title:       { sql: 'al.title', type: 'text' },
      severity:    { sql: 'al.severity::text', type: 'text' },
      status:      { sql: 'al.status::text', type: 'text' },
      source:      { sql: 'al.source::text', type: 'text' },
      category:    { sql: 'al.category', type: 'text' },
      assigned_to: { sql: 'al.assigned_to', type: 'text' },
      affected:    { sql: `array_to_string(al.affected_users || al.affected_devices, ', ')`, type: 'text' },
      resolved_at: { sql: 'al.resolved_at', type: 'time' },
    },
  },
  {
    name: 'SignIns', description: 'Risky sign-ins from Entra ID Identity Protection',
    from: 'risky_signins s', tenant: 's.tenant_id = $1', time: 's.occurred_at',
    fields: {
      occurred_at: { sql: 's.occurred_at', type: 'time' },
      user:        { sql: 's.user_principal_name', type: 'text' },
      risk_level:  { sql: 's.risk_level::text', type: 'text' },
      risk_detail: { sql: 's.risk_detail', type: 'text' },
      ip:          { sql: 'host(s.ip_address)', type: 'text' },
      country:     { sql: 's.country_code', type: 'text' },
      city:        { sql: 's.city', type: 'text' },
      app:         { sql: 's.app_display_name', type: 'text' },
    },
  },
  {
    name: 'RiskyUsers', description: 'Users Identity Protection currently rates at risk',
    from: 'risky_users u', tenant: 'u.tenant_id = $1 AND NOT COALESCE(u.is_deleted, FALSE)',
    fields: {
      user:         { sql: 'u.user_principal_name', type: 'text' },
      display_name: { sql: 'u.display_name', type: 'text' },
      risk_level:   { sql: 'u.risk_level::text', type: 'text' },
      risk_detail:  { sql: 'u.risk_detail', type: 'text' },
      country:      { sql: 'u.country_code', type: 'text' },
      updated:      { sql: 'u.risk_last_updated_at', type: 'time' },
    },
  },
  {
    name: 'Devices', description: 'Intune managed devices',
    from: 'managed_devices d', tenant: 'd.tenant_id = $1',
    fields: {
      device:     { sql: 'd.device_name', type: 'text' },
      os:         { sql: 'd.operating_system', type: 'text' },
      os_version: { sql: 'd.os_version', type: 'text' },
      compliance: { sql: 'd.compliance_state', type: 'text' },
      encryption: { sql: 'd.encryption_state', type: 'text' },
      user:       { sql: 'd.user_principal_name', type: 'text' },
      owner:      { sql: 'd.owner_type', type: 'text' },
      last_sync:  { sql: 'd.last_sync_datetime', type: 'time' },
    },
  },
  {
    name: 'Incidents', description: 'Defender XDR incidents',
    from: 'security_incidents i', tenant: 'i.tenant_id = $1', time: 'i.created_at',
    fields: {
      created_at:     { sql: 'i.created_at', type: 'time' },
      title:          { sql: 'i.display_name', type: 'text' },
      severity:       { sql: 'i.severity', type: 'text' },
      status:         { sql: 'i.status', type: 'text' },
      classification: { sql: 'i.classification', type: 'text' },
      assigned_to:    { sql: 'i.assigned_to', type: 'text' },
      alert_count:    { sql: 'i.alert_count::float8', type: 'number' },
      updated:        { sql: 'i.last_update_at', type: 'time' },
    },
  },
  {
    name: 'AuditLog', description: 'Sign-ins and changes made in this portal',
    from: 'audit_logs l', tenant: 'l.tenant_id = $1', time: 'l.created_at',
    fields: {
      created_at: { sql: 'l.created_at', type: 'time' },
      user:       { sql: 'l.user_email', type: 'text' },
      action:     { sql: 'l.action', type: 'text' },
      resource:   { sql: 'l.resource', type: 'text' },
      success:    { sql: 'l.success', type: 'bool' },
      ip:         { sql: 'host(l.ip_address)', type: 'text' },
    },
  },
]

export const DATASET_BY_NAME = new Map(DATASETS.map((d) => [d.name.toLowerCase(), d]))
