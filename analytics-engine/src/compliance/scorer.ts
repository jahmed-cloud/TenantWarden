import { Pool } from 'pg'

export interface ControlCheck {
  id:           string
  check_type:   string
  check_target: number | null
}

async function runCheck(
  db: Pool, tenantId: string, check: ControlCheck,
): Promise<{ status: string; detail: string; value: number | null }> {
  const target = check.check_target ?? 0

  switch (check.check_type) {
    case 'mfa_enforced': {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ca_policies
         WHERE tenant_id = $1 AND state = 'enabled' AND controls::text ILIKE '%mfa%'`, [tenantId])
      const n = rows[0]?.n ?? 0
      return n > 0
        ? { status: 'pass', detail: `${n} enabled CA policy(ies) enforce MFA`, value: n }
        : { status: 'fail', detail: 'No enabled Conditional Access policy enforces MFA', value: 0 }
    }
    case 'conditional_access': {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ca_policies WHERE tenant_id = $1 AND state = 'enabled'`, [tenantId])
      const n = rows[0]?.n ?? 0
      return n > 0
        ? { status: 'pass', detail: `${n} enabled Conditional Access policy(ies)`, value: n }
        : { status: 'fail', detail: 'No enabled Conditional Access policies found', value: 0 }
    }
    case 'risky_users_low': {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM risky_users
         WHERE tenant_id = $1 AND risk_level IN ('high','medium') AND COALESCE(is_deleted, FALSE) = FALSE`, [tenantId])
      const n = rows[0]?.n ?? 0
      return n <= target
        ? { status: 'pass', detail: `${n} unresolved high/medium risk users (≤ ${target})`, value: n }
        : { status: 'fail', detail: `${n} unresolved high/medium risk users (target ≤ ${target})`, value: n }
    }
    case 'device_inventory': {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM managed_devices WHERE tenant_id = $1`, [tenantId])
      const n = rows[0]?.n ?? 0
      return n > 0
        ? { status: 'pass', detail: `${n} managed devices inventoried`, value: n }
        : { status: 'fail', detail: 'No managed devices inventoried', value: 0 }
    }
    case 'device_encryption': {
      const { rows } = await db.query<{ total: number; enc: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE encryption_state ILIKE 'encrypted')::int AS enc
         FROM managed_devices WHERE tenant_id = $1`, [tenantId])
      const total = rows[0]?.total ?? 0
      const enc   = rows[0]?.enc ?? 0
      if (total === 0) return { status: 'not_applicable', detail: 'No devices to evaluate', value: null }
      const pct = Math.round((enc / total) * 100)
      return pct >= target
        ? { status: 'pass',    detail: `${pct}% of devices encrypted (≥ ${target}%)`, value: pct }
        : { status: 'partial', detail: `${pct}% of devices encrypted (target ${target}%)`, value: pct }
    }
    case 'secure_score': {
      const { rows } = await db.query<{ pct: number }>(
        `SELECT percentage AS pct FROM secure_scores WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [tenantId])
      const pct = rows[0]?.pct ?? null
      if (pct === null) return { status: 'not_applicable', detail: 'No Secure Score collected yet', value: null }
      return pct >= target
        ? { status: 'pass',    detail: `Secure Score ${pct}% (≥ ${target}%)`, value: pct }
        : { status: 'partial', detail: `Secure Score ${pct}% (target ${target}%)`, value: pct }
    }
    case 'risky_signins_monitored': {
      const { rows } = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM risky_signins
         WHERE tenant_id = $1 AND occurred_at >= NOW() - INTERVAL '30 days'`, [tenantId])
      const n = rows[0]?.n ?? 0
      return { status: 'pass', detail: `Sign-in risk monitoring active (${n} risky sign-ins in 30d)`, value: n }
    }
    default:
      return { status: 'not_applicable', detail: `Unknown check type: ${check.check_type}`, value: null }
  }
}

export async function scoreCompliance(db: Pool, tenantId: string): Promise<void> {
  const { rows: controls } = await db.query<ControlCheck>(
    `SELECT id, check_type, check_target FROM compliance_controls`)
  for (const control of controls) {
    const result = await runCheck(db, tenantId, control)
    await db.query(
      `INSERT INTO compliance_assessments (tenant_id, control_id, status, detail, measured_value, assessed_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (tenant_id, control_id) DO UPDATE SET
         status = EXCLUDED.status, detail = EXCLUDED.detail,
         measured_value = EXCLUDED.measured_value, assessed_at = NOW()`,
      [tenantId, control.id, result.status, result.detail, result.value])
  }

  // ── Snapshot per-framework rollup into compliance_history (for trend charts) ──
  await db.query(`
    INSERT INTO compliance_history (tenant_id, framework_id, score, controls_passed, controls_total)
    SELECT
      $1, c.framework_id,
      CASE WHEN COUNT(*) FILTER (WHERE a.status != 'not_applicable') = 0 THEN 0
           ELSE ROUND(
             (COUNT(*) FILTER (WHERE a.status='pass') + COUNT(*) FILTER (WHERE a.status='partial') * 0.5)
             / NULLIF(COUNT(*) FILTER (WHERE a.status != 'not_applicable'),0) * 100)
      END::int,
      COUNT(*) FILTER (WHERE a.status='pass')::int,
      COUNT(*) FILTER (WHERE a.status != 'not_applicable')::int
    FROM compliance_controls c
    JOIN compliance_assessments a ON a.control_id = c.id AND a.tenant_id = $1
    GROUP BY c.framework_id
  `, [tenantId])
}

/** Deletes history rows older than the configured retention window. */
export async function pruneHistory(db: Pool): Promise<void> {
  const { rows } = await db.query<{ key: string; days: number }>(
    'SELECT key, days FROM retention_config WHERE days > 0')
  const tableForKey: Record<string, { table: string; col: string }> = {
    posture_history:    { table: 'posture_history',    col: 'captured_at' },
    compliance_history: { table: 'compliance_history', col: 'captured_at' },
    secure_scores:      { table: 'secure_scores',      col: 'recorded_at' },
    risky_signins:      { table: 'risky_signins',      col: 'occurred_at' },
    audit_logs:         { table: 'audit_logs',         col: 'created_at' },
  }
  for (const { key, days } of rows) {
    const t = tableForKey[key]
    if (!t) continue
    await db.query(`DELETE FROM ${t.table} WHERE ${t.col} < NOW() - INTERVAL '${days} days'`)
  }
}
