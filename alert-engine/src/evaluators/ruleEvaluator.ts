import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import { logger } from '../utils/logger.js'
import { METRIC_BY_NAME, type Operator } from '../catalogue.js'
import { runQuery } from '../query/run.js'

// ─── Rules ────────────────────────────────────────────────────────────────────
// threshold_value / window_minutes are the source of truth; condition holds
// { metric, operator, param?, query? }. Metrics are listed in ../catalogue.ts.

export type ConditionOperator = Operator

export interface AlertRule {
  id:              string
  tenantId:        string
  name:            string
  description:     string
  severity:        string
  source:          string
  metric:          string
  operator:        ConditionOperator
  threshold:       number
  windowMinutes:   number
  cooldownMinutes: number
  param:           number | null
  query:           string | null
}

export interface MetricResult {
  value:    number | null          // null = no data yet (e.g. Secure Score never collected) → rule is skipped
  affected: string[]               // users / devices / hosts / items behind the number
  /** Decided by the metric itself (grouped custom queries compare each group) */
  fired?:   boolean
  summary?: string
}

// ─── Metric computation ──────────────────────────────────────────────────────

const ONLINE = `last_heartbeat_at > NOW() - INTERVAL '2 minutes'`
const arr = (path: string) => `CASE WHEN jsonb_typeof(${path}) = 'array' THEN ${path} ELSE '[]'::jsonb END`
const RISKY_PORTS = '3389|445|23|21|1433|3306|5432|6379|27017|9200'
const OPEN_INCIDENT = `status NOT IN ('resolved', 'redirected')`

export async function computeMetric(db: Pool, rule: AlertRule): Promise<MetricResult> {
  const t = rule.tenantId
  const def = METRIC_BY_NAME.get(rule.metric)
  const param = rule.param ?? def?.param?.default ?? 0
  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0] ?? {}
  const counted = (r: { n?: number; items?: string[] }) => ({ value: r.n ?? 0, affected: (r.items ?? []).slice(0, 50) })

  /** Hosts matching a condition on the agents table */
  const hosts = async (where: string, label = 'hostname', extra: unknown[] = []) => counted(await one(
    `SELECT COUNT(*)::int AS n, COALESCE(array_agg(${label} ORDER BY hostname), '{}') AS items
     FROM agents WHERE tenant_id = $1 AND (${where})`, [t, ...extra]))

  /** Agent events in the rule window */
  const events = async (where: string, extra: unknown[] = []) => counted(await one(
    `SELECT COUNT(*)::int AS n, COALESCE(array_agg(DISTINCT hostname), '{}') AS items
     FROM agent_events WHERE tenant_id = $1 AND occurred_at >= NOW() - make_interval(mins => $2) AND (${where})`,
    [t, rule.windowMinutes, ...extra]))

  /** Failed logins reported as "N failed logins from X" */
  const failures = async (sourceWhere: string) => {
    const r = await one(
      `SELECT COALESCE(SUM(substring(message from '^([0-9]+) failed')::int), 0)::int AS n,
              COALESCE(array_agg(DISTINCT hostname || ': ' || message), '{}') AS items
       FROM agent_events
       WHERE tenant_id = $1 AND occurred_at >= NOW() - make_interval(mins => $2)
         AND message ~ '^[0-9]+ failed' AND (${sourceWhere})`, [t, rule.windowMinutes])
    return counted(r)
  }

  switch (rule.metric) {
    // ── Identity ────────────────────────────────────────────────────────────
    case 'risky_users':
    case 'risky_users_high': {
      const levels = rule.metric === 'risky_users_high' ? ['high'] : ['high', 'medium']
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(user_principal_name ORDER BY risk_level DESC), '{}') AS items
         FROM risky_users WHERE tenant_id = $1 AND NOT COALESCE(is_deleted, FALSE) AND risk_level::text = ANY($2)`, [t, levels]))
    }
    case 'risky_signins':
    case 'risky_signins_high': {
      const levels = rule.metric === 'risky_signins_high' ? ['high'] : ['low', 'medium', 'high']
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(DISTINCT user_principal_name), '{}') AS items
         FROM risky_signins
         WHERE tenant_id = $1 AND risk_level::text = ANY($3) AND occurred_at >= NOW() - make_interval(mins => $2)`,
        [t, rule.windowMinutes, levels]))
    }
    case 'mfa_registration_percent':
    case 'admins_without_mfa': {
      const scope = rule.metric === 'mfa_registration_percent' ? 'all_users' : 'privileged_users'
      const r = await one(
        `SELECT COALESCE(SUM(user_count), 0)::int AS total,
                COALESCE(SUM(user_count) FILTER (WHERE category IN ('phish_resistant', 'phishable')), 0)::int AS registered
         FROM (SELECT DISTINCT ON (method) category, user_count FROM auth_method_summary
               WHERE tenant_id = $1 AND scope = $2 ORDER BY method, captured_at DESC) latest`, [t, scope])
      if (!r.total) return { value: null, affected: [] }
      return rule.metric === 'mfa_registration_percent'
        ? { value: Math.round((r.registered / r.total) * 100), affected: [] }
        : { value: r.total - r.registered, affected: [] }
    }
    case 'ca_policies_enabled':
    case 'ca_policies_not_enabled': {
      const r = await one(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'enabled')::int AS enabled,
                COALESCE(array_agg(name ORDER BY name) FILTER (WHERE state <> 'enabled'), '{}') AS items
         FROM ca_policies WHERE tenant_id = $1`, [t])
      if (!r.total) return { value: null, affected: [] }   // nothing collected (permission missing?) — don't guess
      return rule.metric === 'ca_policies_enabled' ? { value: r.enabled, affected: [] } : { value: r.total - r.enabled, affected: r.items }
    }

    // ── Security ────────────────────────────────────────────────────────────
    case 'secure_score': {
      const r = await one(`SELECT ROUND(percentage)::int AS n FROM secure_scores WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [t])
      return { value: r.n ?? null, affected: [] }
    }
    case 'secure_score_drop': {
      const r = await one(
        `SELECT (SELECT percentage FROM secure_scores WHERE tenant_id = $1 AND recorded_at <= NOW() - INTERVAL '7 days' ORDER BY recorded_at DESC LIMIT 1) AS before,
                (SELECT percentage FROM secure_scores WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1) AS now`, [t])
      if (r.before === null || r.before === undefined || r.now === null || r.now === undefined) return { value: null, affected: [] }
      return { value: Math.round(Number(r.before) - Number(r.now)), affected: [] }
    }
    case 'defender_incidents':
    case 'defender_incidents_high':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(display_name ORDER BY created_at DESC), '{}') AS items
         FROM security_incidents WHERE tenant_id = $1 AND ${OPEN_INCIDENT} ${rule.metric === 'defender_incidents_high' ? `AND severity = 'high'` : ''}`, [t]))
    case 'service_health_issues':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(service || ' (' || status || ')'), '{}') AS items
         FROM (SELECT DISTINCT ON (service) service, status, recorded_at FROM service_health
               WHERE tenant_id = $1 ORDER BY service, recorded_at DESC) latest
         WHERE recorded_at > NOW() - INTERVAL '2 hours'
           AND status NOT IN ('serviceOperational', 'serviceRestored', 'postIncidentReviewPublished', 'falsePositive', 'resolved', 'investigationSuspended')`, [t]))
    case 'active_alerts': {
      const r = await one(
        `SELECT COUNT(*)::int AS n FROM alerts
         WHERE tenant_id = $1 AND status = 'active' AND severity = 'critical' AND COALESCE(external_id, '') <> $2`, [t, `rule:${rule.id}`])
      return { value: r.n ?? 0, affected: [] }
    }

    // ── Devices (Intune) ────────────────────────────────────────────────────
    case 'non_compliant_devices':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(device_name ORDER BY device_name), '{}') AS items
         FROM managed_devices WHERE tenant_id = $1 AND compliance_state <> 'compliant'`, [t]))
    case 'unencrypted_devices':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(device_name ORDER BY device_name), '{}') AS items
         FROM managed_devices WHERE tenant_id = $1 AND COALESCE(encryption_state, '') <> 'encrypted'`, [t]))
    case 'stale_devices':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(device_name ORDER BY device_name), '{}') AS items
         FROM managed_devices WHERE tenant_id = $1 AND last_sync_datetime < NOW() - make_interval(days => $2)`, [t, Math.round(param)]))

    // ── Endpoints ───────────────────────────────────────────────────────────
    case 'agents_offline':
      return hosts(`last_heartbeat_at < NOW() - INTERVAL '5 minutes'`)
    case 'hosts_cpu_above':
      return hosts(`${ONLINE} AND cpu_percent > $2`, `hostname || ' (' || round(cpu_percent) || '%)'`, [param])
    case 'hosts_memory_above':
      return hosts(`${ONLINE} AND memory_percent > $2`, `hostname || ' (' || round(memory_percent) || '%)'`, [param])
    case 'hosts_disk_above':
      return hosts(`disk_percent > $2`, `hostname || ' (' || round(disk_percent) || '%)'`, [param])
    case 'hosts_network_above':
      return hosts(`${ONLINE} AND (COALESCE(net_rx_bps, 0) + COALESCE(net_tx_bps, 0)) * 8 / 1e6 > $2`,
        `hostname || ' (' || round((COALESCE(net_rx_bps, 0) + COALESCE(net_tx_bps, 0)) * 8 / 1e6) || ' Mbit/s)'`, [param])
    case 'hosts_pending_security_updates':
      return hosts(`inventory->>'pending_security_updates' ~ '^[0-9]+$' AND (inventory->>'pending_security_updates')::int > 0`,
        `hostname || ' (' || (inventory->>'pending_security_updates') || ')'`)
    case 'hosts_reboot_required':
      return hosts(`inventory->>'reboot_required' = 'true'`)
    case 'hosts_firewall_off':
      return hosts(`EXISTS (SELECT 1 FROM jsonb_array_elements(${arr(`inventory->'firewall'`)}) f WHERE f->>'enabled' = 'false')
                    OR (jsonb_typeof(inventory->'firewall') = 'string' AND inventory->>'firewall' ~* '(inactive|not running|none found)')`)
    case 'hosts_antivirus_off':
      return hosts(`inventory->'defender' IS NOT NULL
                    AND (inventory#>>'{defender,realtime_protection}' = 'false' OR inventory#>>'{defender,antivirus_enabled}' = 'false')`)
    case 'hosts_unencrypted':
      return hosts(`EXISTS (SELECT 1 FROM jsonb_array_elements(${arr(`inventory->'bitlocker'`)}) b WHERE b->>'protection' NOT IN ('On', '1'))
                    OR inventory->>'disk_encryption' = 'false'
                    OR (jsonb_typeof(inventory->'disk_encryption') = 'string' AND inventory->>'disk_encryption' ~* 'is off')`)
    case 'hosts_failed_services':
      return hosts(`jsonb_array_length(${arr(`inventory->'services_failed'`)}) > 0`,
        `hostname || ' (' || (SELECT string_agg(s, ', ') FROM jsonb_array_elements_text(${arr(`inventory->'services_failed'`)}) s) || ')'`)
    case 'hosts_exposed_ports': {
      const pattern = `^\\S+ (0\\.0\\.0\\.0|\\*|\\[::\\]|::):(${RISKY_PORTS})$`
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(hostname || ' (' || ports || ')' ORDER BY hostname), '{}') AS items
         FROM (SELECT a.hostname, string_agg(DISTINCT substring(p from ':([0-9]+)$'), ', ') AS ports
               FROM agents a, jsonb_array_elements_text(${arr(`a.inventory->'listening_ports'`)}) p
               WHERE a.tenant_id = $1 AND p ~ $2 GROUP BY a.hostname) exposed`, [t, pattern]))
    }
    case 'certificates_expiring':
      return counted(await one(
        `SELECT COUNT(*)::int AS n,
                COALESCE(array_agg(a.hostname || ': ' || (c->>'subject') || ' (' || (c->>'days_left') || ' days)' ORDER BY (c->>'days_left')::int), '{}') AS items
         FROM agents a, jsonb_array_elements(${arr(`a.inventory->'certificates'`)}) c
         WHERE a.tenant_id = $1 AND c->>'days_left' ~ '^-?[0-9]+$' AND (c->>'days_left')::int <= $2`, [t, Math.round(param)]))
    case 'agent_errors':
      return events(`level IN ('error', 'critical')`)
    case 'failed_logins':
      return failures('TRUE')
    case 'new_local_admins':
      return events(`level = 'critical' AND message ILIKE '%added to local group%'`)
    case 'audit_log_cleared':
      return events(`message ILIKE '%audit log was cleared%'`)

    // ── Network ─────────────────────────────────────────────────────────────
    case 'endpoint_checks_down':
      return counted(await one(
        `SELECT COUNT(*)::int AS n,
                COALESCE(array_agg(name || ' from ' || hostname || ': ' || COALESCE(error, 'failed') ORDER BY name), '{}') AS items
         FROM endpoint_checks WHERE tenant_id = $1 AND NOT ok AND checked_at > NOW() - INTERVAL '15 minutes'`, [t]))
    case 'endpoint_latency_above':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(name || ' from ' || hostname || ' (' || latency_ms || ' ms)'), '{}') AS items
         FROM endpoint_checks WHERE tenant_id = $1 AND ok AND latency_ms > $2 AND checked_at > NOW() - INTERVAL '15 minutes'`, [t, param]))

    // ── Workloads ───────────────────────────────────────────────────────────
    case 'sql_services_down':
    case 'workloads_stopped':
      return counted(await one(
        `SELECT COUNT(*)::int AS n, COALESCE(array_agg(a.hostname || ' — ' || COALESCE(w->>'name', w->>'type') ORDER BY a.hostname), '{}') AS items
         FROM agents a, jsonb_array_elements(${arr(`a.inventory->'workloads'`)}) w
         WHERE a.tenant_id = $1 AND a.${ONLINE} AND w->>'status' = 'stopped' AND COALESCE(w->>'startup', 'auto') = 'auto'
           ${rule.metric === 'sql_services_down' ? `AND w->>'type' = 'sqlserver'` : ''}`, [t]))
    case 'sql_failed_logins':
      return failures(`source = 'SQL Server'`)
    case 'sql_errors':
      return events(`source = 'SQL Server' AND level IN ('error', 'critical') AND message !~ '^[0-9]+ failed'`)

    // ── Custom query ────────────────────────────────────────────────────────
    case 'custom_query': {
      if (!rule.query) return { value: null, affected: [] }
      const r = await runQuery(db, t, rule.query, { windowMinutes: rule.windowMinutes, limit: 1000 })
      if (r.summarized && r.groupBy.length && r.aggregates.length) {
        // One comparison per group: "count_ > 10 by hostname" fires for each host over 10
        const agg = r.aggregates[0]
        const matches = r.rows.filter((row) => typeof row[agg] === 'number' && compare(row[agg] as number, rule.operator, rule.threshold))
        return {
          value: matches.length, fired: matches.length > 0,
          affected: matches.slice(0, 50).map((row) => `${r.groupBy.map((g) => String(row[g] ?? '—')).join(' / ')} (${row[agg]})`),
          summary: `${matches.length} of ${r.rows.length} groups have ${agg} ${OP_TEXT[rule.operator]} ${rule.threshold}`,
        }
      }
      if (r.summarized && r.aggregates.length) {
        const v = r.rows[0]?.[r.aggregates[0]]
        return { value: typeof v === 'number' ? v : null, affected: [] }
      }
      const first = r.columns[0]?.name
      return { value: r.rows.length, affected: first ? r.rows.slice(0, 50).map((row) => String(row[first] ?? '—')) : [] }
    }

    default:
      logger.warn({ ruleId: rule.id, metric: rule.metric }, 'unknown metric in rule — skipped')
      return { value: null, affected: [] }
  }
}

export function compare(value: number, op: ConditionOperator, threshold: number): boolean {
  switch (op) {
    case 'gt':  return value >  threshold
    case 'gte': return value >= threshold
    case 'lt':  return value <  threshold
    case 'lte': return value <= threshold
    case 'eq':  return value === threshold
    case 'neq': return value !== threshold
    default:    return false
  }
}

const OP_TEXT: Record<ConditionOperator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' }

export function describe(rule: AlertRule, m: MetricResult): string {
  const def = METRIC_BY_NAME.get(rule.metric)
  const label = def?.label ?? rule.metric.replace(/_/g, ' ')
  const param = def?.param ? ` (${rule.param ?? def.param.default}${def.param.unit === '%' ? '%' : ` ${def.param.unit ?? ''}`.trimEnd()})` : ''
  const window = def?.windowed ? ` in the last ${rule.windowMinutes} min` : ''
  const lead = m.summary ?? `${label}${param}: ${m.value}${def?.unit ?? ''}${window} (rule: ${OP_TEXT[rule.operator]} ${rule.threshold}).`
  const items = m.affected.length ? ` Affected: ${m.affected.slice(0, 10).join(', ')}${m.affected.length > 10 ? ` and ${m.affected.length - 10} more` : ''}.` : ''
  return `${rule.description ? rule.description + ' ' : ''}${lead}${items}`
}

// ─── Evaluation cycle ────────────────────────────────────────────────────────

const OPEN = `('active', 'acknowledged', 'investigating')`

export async function runEvaluationCycle(db: Pool, redis: Redis): Promise<void> {
  const { rows: rules } = await db.query<AlertRule>(
    `SELECT r.id, r.tenant_id AS "tenantId", r.name, r.description, r.severity::text AS severity, r.source::text AS source,
            r.condition->>'metric' AS metric, COALESCE(r.condition->>'operator', 'gt') AS operator,
            CASE WHEN r.condition->>'param' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (r.condition->>'param')::float8 END AS param,
            r.condition->>'query' AS query,
            r.threshold_value AS threshold, r.window_minutes AS "windowMinutes", r.cooldown_minutes AS "cooldownMinutes"
     FROM alert_rules r JOIN tenants t ON t.id = r.tenant_id
     WHERE r.is_enabled AND t.status <> 'paused'`)

  let raised = 0, cleared = 0
  for (const rule of rules) {
    try {
      const m = await computeMetric(db, rule)
      if (m.value === null) continue
      const externalId = `rule:${rule.id}`
      const fired = m.fired ?? compare(m.value, rule.operator, rule.threshold)

      if (!fired) {
        // Condition cleared → close the rule's open alert so the list reflects reality
        const res = await db.query(
          `UPDATE alerts SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
                  resolution = 'Resolved automatically — the rule condition is no longer met'
           WHERE tenant_id = $1 AND external_id = $2 AND status IN ${OPEN}`, [rule.tenantId, externalId])
        cleared += res.rowCount ?? 0
        continue
      }

      // One open alert per rule; the cooldown stops a resolved alert re-opening immediately
      const open = await db.query(
        `SELECT 1 FROM alerts WHERE tenant_id = $1 AND external_id = $2 AND status IN ${OPEN} LIMIT 1`, [rule.tenantId, externalId])
      if (open.rowCount) continue
      const armed = await redis.set(`alert_rule_cooldown:${rule.id}`, '1', 'EX', Math.max(rule.cooldownMinutes, 1) * 60, 'NX')
      if (!armed) continue

      const def = METRIC_BY_NAME.get(rule.metric)
      const users = def?.affects === 'users'
      const { rows } = await db.query(
        `INSERT INTO alerts (tenant_id, title, description, severity, status, source, category,
                             affected_users, affected_devices, recommended_action, external_id, metadata)
         VALUES ($1, $2, $3, $4::alert_severity, 'active', $5::alert_source, 'rule', $6, $7, $8, $9, $10::jsonb)
         RETURNING id, tenant_id AS "tenantId", title, description, severity::text AS severity, status::text AS status,
                   source::text AS source, category, affected_users AS "affectedUsers",
                   recommended_action AS "recommendedAction", created_at AS "createdAt"`,
        [rule.tenantId, rule.name, describe(rule, m), rule.severity, rule.source,
         users ? m.affected : [], users ? [] : m.affected,
         def?.recommended ?? null, externalId,
         JSON.stringify({ ruleId: rule.id, metric: rule.metric, value: m.value, threshold: rule.threshold, operator: rule.operator, param: rule.param })])
      await db.query(`UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1`, [rule.id])

      // notification-service dispatches to the tenant's channels
      await redis.publish('tenantwarden:alerts', JSON.stringify({ tenantId: rule.tenantId, alert: rows[0] }))
      raised++
      logger.info({ ruleId: rule.id, tenantId: rule.tenantId, metric: rule.metric, value: m.value }, 'alert raised')
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'rule evaluation failed')
    }
  }
  logger.info({ rules: rules.length, raised, cleared }, 'evaluation cycle complete')
}
