import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pLimit from 'p-limit'
import { logger } from './utils/logger.js'
import { runCollectionCycle } from './graph/collector.js'
import type { TenantConfig } from './types/index.js'
import { decryptSecret } from './utils/decrypt.js'
import { METHOD_CATEGORY, type AuthMethodUser } from './graph/collector.js'

interface SchedulerOptions {
  intervalSeconds: number
  batchSize:       number
}

export class CollectorScheduler {
  private timer:   ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    private readonly db:   Pool,
    private readonly redis: Redis,
    private readonly opts: SchedulerOptions,
  ) {}

  async start() {
    logger.info({ intervalSeconds: this.opts.intervalSeconds }, 'Collector scheduler starting')

    // Run immediately on start
    await this.runCycle()

    this.timer = setInterval(async () => {
      if (this.running) {
        logger.warn('Previous cycle still running — skipping this tick')
        return
      }
      await this.runCycle()
    }, this.opts.intervalSeconds * 1000)
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    logger.info('Collector scheduler stopped')
  }

  /** Public on-demand trigger (POST /collect) */
  async runNow(): Promise<{ started: boolean }> {
    if (this.running) return { started: false }
    void this.runCycle()
    return { started: true }
  }

  private async runCycle() {
    this.running = true
    const start  = Date.now()
    logger.info('Starting collection cycle')

    try {
      const tenants = await this.loadActiveTenants()
      if (tenants.length === 0) {
        logger.info('No active tenants to collect')
        return
      }

      // Max 3 tenants concurrently to avoid Graph API throttling
      const limit = pLimit(3)

      const results = await Promise.allSettled(
        tenants.map(tenant =>
          limit(async () => {
            const lockKey = `collector_lock:${tenant.id}`
            const locked  = await this.redis.set(lockKey, '1', 'EX', this.opts.intervalSeconds, 'NX')
            if (!locked) {
              logger.info({ tenantId: tenant.id }, 'Tenant already being collected — skipping')
              return
            }

            try {
              logger.info({ tenantId: tenant.id, name: tenant.displayName }, 'Collecting tenant')
              const data = await runCollectionCycle(tenant)
              await this.persistResults(tenant, data)
              logger.info({ tenantId: tenant.id }, 'Tenant collection complete')
            } catch (err) {
              logger.error({ err, tenantId: tenant.id }, 'Tenant collection failed')
              await this.markTenantError(tenant.id, String(err))
            } finally {
              await this.redis.del(lockKey)
            }
          })
        ),
      )

      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed    = results.filter(r => r.status === 'rejected').length
      logger.info({ succeeded, failed, ms: Date.now() - start }, 'Collection cycle complete')
    } catch (err) {
      logger.error({ err }, 'Collection cycle error')
    } finally {
      this.running = false
    }
  }

  private async loadActiveTenants(): Promise<TenantConfig[]> {
    const { rows } = await this.db.query<TenantConfig>(`
      SELECT
        id,
        display_name    AS "displayName",
        azure_tenant_id AS "azureTenantId",
        client_id       AS "clientId",
        encrypted_client_secret AS "encryptedClientSecret",
        encrypted_client_secret AS "clientSecret",
        enabled_modules AS "enabledModules"
      FROM tenants
      -- Include 'error' tenants so they auto-recover once credentials/permissions
      -- are fixed. Errored tenants are retried at most every 30 minutes.
      WHERE status = 'active'
         OR (status = 'error' AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '30 minutes'))
      ORDER BY display_name
    `)
    return rows.map(t => ({ ...t, clientSecret: decryptSecret(t.encryptedClientSecret) }))
  }

  private async persistResults(tenant: TenantConfig, data: Awaited<ReturnType<typeof runCollectionCycle>>) {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')

      // Upsert risky users
      for (const u of data.riskyUsers) {
        await client.query(`
          INSERT INTO risky_users
            (tenant_id, azure_object_id, user_principal_name, display_name, risk_level,
             risk_detail, risk_last_updated_at)
          VALUES ($1,$2,$3,$4,$5::user_risk_level,$6,$7)
          ON CONFLICT (tenant_id, azure_object_id) DO UPDATE SET
            risk_level           = EXCLUDED.risk_level,
            risk_detail          = EXCLUDED.risk_detail,
            risk_last_updated_at = EXCLUDED.risk_last_updated_at,
            updated_at           = NOW()`,
          [tenant.id, u.id, u.userPrincipalName, u.displayName,
           u.riskLevel?.toLowerCase() ?? 'none', u.riskDetail, u.riskLastUpdatedDateTime])
      }

      // ── Devices (Intune managed devices) ────────────────────────────────
      for (const d of (data.devices as any[])) {
        await client.query(`
          INSERT INTO managed_devices
            (tenant_id, azure_device_id, device_name, operating_system, os_version,
             compliance_state, user_principal_name, encryption_state, last_sync_datetime, owner_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (tenant_id, azure_device_id) DO UPDATE SET
            device_name         = EXCLUDED.device_name,
            operating_system    = EXCLUDED.operating_system,
            os_version          = EXCLUDED.os_version,
            compliance_state    = EXCLUDED.compliance_state,
            user_principal_name = EXCLUDED.user_principal_name,
            encryption_state    = EXCLUDED.encryption_state,
            last_sync_datetime  = EXCLUDED.last_sync_datetime,
            owner_type          = EXCLUDED.owner_type,
            synced_at           = NOW()`,
          [tenant.id, d.id, d.deviceName ?? 'Unknown', d.operatingSystem ?? null,
           d.osVersion ?? null, d.complianceState ?? null, d.userPrincipalName ?? null,
           d.isEncrypted === true ? 'encrypted' : d.isEncrypted === false ? 'notEncrypted' : null,
           d.lastSyncDateTime ?? null, d.ownerType ?? null])
      }

      // ── Conditional Access policies ─────────────────────────────────────
      for (const pol of (data.caPolicies as any[])) {
        await client.query(`
          INSERT INTO ca_policies
            (tenant_id, policy_id, name, state, conditions, controls)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (tenant_id, policy_id) DO UPDATE SET
            name       = EXCLUDED.name,
            state      = EXCLUDED.state,
            conditions = EXCLUDED.conditions,
            controls   = EXCLUDED.controls,
            synced_at  = NOW()`,
          [tenant.id, pol.id, pol.displayName ?? 'Unnamed policy', pol.state ?? 'disabled',
           JSON.stringify(pol.conditions ?? {}), JSON.stringify(pol.grantControls ?? {})])
      }

      // ── Service health (one row per service, latest snapshot) ───────────
      for (const svc of (data.serviceHealth as any[])) {
        await client.query(`
          INSERT INTO service_health (tenant_id, service, status, detail)
          VALUES ($1,$2,$3,$4)`,
          [tenant.id, svc.service ?? svc.id ?? 'Unknown',
           svc.status ?? 'unknown',
           Array.isArray(svc.issues) ? `${svc.issues.length} active issue(s)` : null])
      }

      // ── Risky sign-ins ──────────────────────────────────────────────────
      for (const s of (data.riskySignIns as any[])) {
        await client.query(`
          INSERT INTO risky_signins
            (tenant_id, azure_signin_id, user_principal_name, ip_address, country_code,
             city, risk_level, risk_detail, app_display_name, device_id, occurred_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::user_risk_level,$8,$9,$10,$11)
          ON CONFLICT (tenant_id, azure_signin_id) DO NOTHING`,
          [tenant.id, s.id, s.userPrincipalName ?? 'unknown',
           s.ipAddress ?? null,
           (s.location?.countryOrRegion ?? '').slice(0, 2) || null,
           s.location?.city ?? null,
           (s.riskLevelAggregated ?? 'none').toLowerCase(),
           s.riskState ?? null, s.appDisplayName ?? null,
           s.deviceDetail?.deviceId ?? null,
           s.createdDateTime ?? new Date().toISOString()])
      }

      // ── Auth method registration summary (feeds the auth-method Sankey) ──
      const authUsers = (data.authMethods as AuthMethodUser[]) ?? []
      const aggregate = (users: AuthMethodUser[], scope: string) => {
        const counts = new Map<string, number>()
        for (const u of users) counts.set(u.strongestMethod, (counts.get(u.strongestMethod) ?? 0) + 1)
        return Array.from(counts.entries()).map(([method, userCount]) => ({
          method, category: METHOD_CATEGORY[method] ?? 'single_factor', userCount, scope,
        }))
      }
      const rows = [
        ...aggregate(authUsers, 'all_users'),
        ...aggregate(authUsers.filter(u => u.isAdmin), 'privileged_users'),
      ]
      for (const r of rows) {
        await client.query(`
          INSERT INTO auth_method_summary (tenant_id, scope, method, category, user_count)
          VALUES ($1,$2,$3,$4,$5)`,
          [tenant.id, r.scope, r.method, r.category, r.userCount])
      }

      // ── Secure Score (one snapshot per cycle) ───────────────────────────
      if (data.secureScore) {
        const ss: any = data.secureScore
        await client.query(`
          INSERT INTO secure_scores
            (tenant_id, current_score, max_score, percentage,
             active_user_count, licensed_user_count, recorded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (tenant_id, recorded_at) DO NOTHING`,
          [tenant.id,
           ss.currentScore ?? 0, ss.maxScore ?? 0,
           ss.maxScore ? Math.round((ss.currentScore / ss.maxScore) * 100) : null,
           ss.activeUserCount ?? null, ss.licensedUserCount ?? null,
           ss.createdDateTime ?? new Date().toISOString()])
      }

      // ── Update tenant counts + sync status ──────────────────────────────
      await client.query(`
        UPDATE tenants SET
          user_count   = $2,
          device_count = $3,
          last_sync_at = NOW(),
          last_sync_error = NULL,
          status       = 'active',
          updated_at   = NOW()
        WHERE id = $1`,
        [tenant.id, data.riskyUsers.length, (data.devices as any[]).length])

      // ── Historical snapshot for trend charts ────────────────────────────
      await client.query(`
        INSERT INTO posture_history
          (tenant_id, risky_users_high, risky_users_medium, devices_total,
           devices_noncompliant, ca_policies_enabled, secure_score, risky_signins_24h)
        SELECT
          $1,
          (SELECT COUNT(*) FROM risky_users     WHERE tenant_id=$1 AND risk_level='high'   AND COALESCE(is_deleted,FALSE)=FALSE),
          (SELECT COUNT(*) FROM risky_users     WHERE tenant_id=$1 AND risk_level='medium' AND COALESCE(is_deleted,FALSE)=FALSE),
          (SELECT COUNT(*) FROM managed_devices WHERE tenant_id=$1),
          (SELECT COUNT(*) FROM managed_devices WHERE tenant_id=$1 AND compliance_state NOT IN ('compliant')),
          (SELECT COUNT(*) FROM ca_policies     WHERE tenant_id=$1 AND state='enabled'),
          (SELECT percentage FROM secure_scores WHERE tenant_id=$1 ORDER BY recorded_at DESC LIMIT 1),
          (SELECT COUNT(*) FROM risky_signins   WHERE tenant_id=$1 AND occurred_at >= NOW() - INTERVAL '24 hours')
      `, [tenant.id])

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  private async markTenantError(tenantId: string, error: string) {
    await this.db.query(
      `UPDATE tenants
          SET status = 'error',
              last_sync_error = $2,
              last_sync_at    = NOW(),   -- drives the 30-min retry backoff
              updated_at      = NOW()
        WHERE id = $1
          AND status <> 'paused'`,
      [tenantId, error.slice(0, 500)],
    )
  }
}
