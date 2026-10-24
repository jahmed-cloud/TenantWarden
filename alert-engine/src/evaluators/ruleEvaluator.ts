import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import { logger } from '../utils/logger.js'

// ─── Rule Condition DSL ───────────────────────────────────────────────────────

export type ConditionOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

export interface RuleCondition {
  metric:    string           // e.g. "risky_users", "failed_signins", "non_compliant_devices"
  operator:  ConditionOperator
  threshold: number
  window:    number           // minutes
  groupBy?:  string           // e.g. "country_code"
}

export interface AlertRule {
  id:              string
  tenantId:        string
  name:            string
  severity:        string
  source:          string
  condition:       RuleCondition
  cooldownMinutes: number
  channelIds:      string[]
  isEnabled:       boolean
}

export interface EvaluationResult {
  triggered:     boolean
  currentValue:  number
  threshold:     number
  message:       string
  affectedItems: string[]
}

// ─── Rule evaluator ───────────────────────────────────────────────────────────

export class RuleEvaluator {
  constructor(
    private readonly db:    Pool,
    private readonly redis: Redis,
  ) {}

  async evaluate(rule: AlertRule): Promise<EvaluationResult> {
    const key = `alert_rule_cooldown:${rule.id}`

    // Check cooldown — skip if rule fired recently
    const inCooldown = await this.redis.get(key)
    if (inCooldown) {
      return { triggered: false, currentValue: 0, threshold: rule.condition.threshold, message: 'in cooldown', affectedItems: [] }
    }

    const result = await this.computeMetric(rule)

    if (compare(result.currentValue, rule.condition.operator, rule.condition.threshold)) {
      // Set cooldown
      await this.redis.set(key, '1', 'EX', rule.cooldownMinutes * 60)

      logger.info({
        ruleId:   rule.id,
        tenantId: rule.tenantId,
        metric:   rule.condition.metric,
        value:    result.currentValue,
        threshold: rule.condition.threshold,
      }, 'alert rule triggered')

      return { ...result, triggered: true, message: buildMessage(rule, result.currentValue) }
    }

    return { ...result, triggered: false, message: '' }
  }

  private async computeMetric(rule: AlertRule): Promise<Omit<EvaluationResult, 'triggered' | 'message'>> {
    const windowStart = new Date(Date.now() - rule.condition.window * 60_000)

    switch (rule.condition.metric) {
      case 'risky_users': {
        const { rows } = await this.db.query<{ count: string; upns: string[] }>(
          `SELECT COUNT(*)::int AS count, ARRAY_AGG(user_principal_name) AS upns
           FROM risky_users
           WHERE tenant_id = $1
             AND risk_level IN ('high', 'medium')
             AND updated_at >= $2
             AND is_deleted = FALSE`,
          [rule.tenantId, windowStart],
        )
        const count = rows[0]?.count ?? '0'
        return {
          currentValue:  parseInt(count),
          threshold:     rule.condition.threshold,
          affectedItems: rows[0]?.upns ?? [],
        }
      }

      case 'active_alerts': {
        const { rows } = await this.db.query<{ count: string }>(
          `SELECT COUNT(*)::int AS count
           FROM alerts
           WHERE tenant_id = $1 AND status = 'active' AND severity = 'critical'`,
          [rule.tenantId],
        )
        return {
          currentValue:  parseInt(rows[0]?.count ?? '0'),
          threshold:     rule.condition.threshold,
          affectedItems: [],
        }
      }

      case 'non_compliant_devices': {
        const { rows } = await this.db.query<{ count: string }>(
          // This metric is updated by the collector; we check cached value
          `SELECT device_count FROM tenants WHERE id = $1`,
          [rule.tenantId],
        )
        // For now return 0 — real implementation reads from collector cache
        return { currentValue: 0, threshold: rule.condition.threshold, affectedItems: [] }
      }

      default:
        logger.warn({ metric: rule.condition.metric }, 'unknown metric in rule')
        return { currentValue: 0, threshold: rule.condition.threshold, affectedItems: [] }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compare(value: number, op: ConditionOperator, threshold: number): boolean {
  switch (op) {
    case 'gt':  return value >  threshold
    case 'gte': return value >= threshold
    case 'lt':  return value <  threshold
    case 'lte': return value <= threshold
    case 'eq':  return value === threshold
    case 'neq': return value !== threshold
  }
}

function buildMessage(rule: AlertRule, value: number): string {
  return `Rule "${rule.name}" triggered: ${rule.condition.metric} = ${value} (threshold: ${rule.condition.threshold})`
}

// ─── Batch evaluation loop ────────────────────────────────────────────────────

export async function runEvaluationCycle(db: Pool, redis: Redis): Promise<void> {
  const evaluator = new RuleEvaluator(db, redis)

  const { rows: rules } = await db.query<AlertRule>(
    `SELECT id, tenant_id, name, severity, source,
            condition, cooldown_minutes, channel_ids, is_enabled
     FROM alert_rules
     WHERE is_enabled = TRUE`,
  )

  logger.info({ count: rules.length }, 'evaluating alert rules')

  const results = await Promise.allSettled(
    rules.map((rule) =>
      evaluator.evaluate(rule).then((result) => ({ rule, result })),
    ),
  )

  const triggered = results
    .filter((r): r is PromiseFulfilledResult<{ rule: AlertRule; result: EvaluationResult }> =>
      r.status === 'fulfilled' && r.value.result.triggered)
    .map((r) => r.value)

  if (triggered.length > 0) {
    logger.info({ triggeredCount: triggered.length }, 'rules triggered — creating alerts')
    // Alerts will be inserted by the calling service after this function returns
  }

  for (const { rule, result } of triggered) {
    await db.query(
      `INSERT INTO alerts
         (tenant_id, title, description, severity, status, source, category, affected_users)
       VALUES ($1, $2, $3, $4::alert_severity, 'active', $5::alert_source, 'automated_rule', $6)
       ON CONFLICT DO NOTHING`,
      [
        rule.tenantId,
        rule.name,
        result.message,
        rule.severity,
        rule.source,
        result.affectedItems,
      ],
    )
  }
}
