import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'tenantwarden-analytics' },
})

// ─── Statistical helpers ──────────────────────────────────────────────────────

export function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m   = mean(values)
  const sq  = values.map(v => (v - m) ** 2)
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / (values.length - 1))
}

export function zScore(value: number, values: number[]): number {
  const sd = stddev(values)
  if (sd === 0) return 0
  return (value - mean(values)) / sd
}

// ─── Anomaly detector ────────────────────────────────────────────────────────

export interface AnomalyResult {
  isAnomaly:    boolean
  score:        number       // z-score magnitude
  direction:    'spike' | 'drop' | 'normal'
  currentValue: number
  baselineMean: number
  baselineStd:  number
  message:      string
}

export function detectAnomaly(
  current: number,
  baseline: number[],
  threshold = 2.5,
): AnomalyResult {
  const bMean  = mean(baseline)
  const bStd   = stddev(baseline)
  const score  = zScore(current, baseline)
  const absScore = Math.abs(score)
  const isAnomaly = absScore >= threshold

  return {
    isAnomaly,
    score:        Math.round(score * 100) / 100,
    direction:    score > 0 ? 'spike' : score < 0 ? 'drop' : 'normal',
    currentValue: current,
    baselineMean: Math.round(bMean * 100) / 100,
    baselineStd:  Math.round(bStd * 100) / 100,
    message: isAnomaly
      ? `Anomaly detected: value ${current} is ${absScore.toFixed(1)}σ from baseline mean ${bMean.toFixed(1)}`
      : 'Within normal range',
  }
}

// ─── Trend analyzer ──────────────────────────────────────────────────────────

export interface TrendResult {
  direction:    'increasing' | 'decreasing' | 'stable'
  slope:        number        // change per time unit
  percentChange: number
  forecast7d:   number        // linear forecast 7 days out
}

export function analyzeTrend(values: number[]): TrendResult {
  if (values.length < 2) return { direction: 'stable', slope: 0, percentChange: 0, forecast7d: values[0] ?? 0 }

  // Simple linear regression
  const n    = values.length
  const xBar = (n - 1) / 2
  const yBar = mean(values)

  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xBar) * (values[i] - yBar)
    den += (i - xBar) ** 2
  }

  const slope       = den === 0 ? 0 : num / den
  const first       = values[0]
  const last        = values[n - 1]
  const pctChange   = first === 0 ? 0 : ((last - first) / first) * 100
  const forecast7d  = Math.max(0, last + slope * 7)

  const direction = Math.abs(slope) < 0.1 ? 'stable'
    : slope > 0 ? 'increasing' : 'decreasing'

  return {
    direction,
    slope:         Math.round(slope * 100) / 100,
    percentChange: Math.round(pctChange * 10) / 10,
    forecast7d:    Math.round(forecast7d),
  }
}

// ─── AI insight generator ────────────────────────────────────────────────────

export interface SecurityInsight {
  title:              string
  severity:           'critical' | 'high' | 'medium' | 'low'
  description:        string
  affectedCountries?: string[]
  recommendedActions: string[]
  estimatedImpact:    string
}

export function generateInsight(
  metric: string,
  current: number,
  baseline: number,
  anomaly: AnomalyResult,
  extraContext?: Record<string, unknown>,
): SecurityInsight | null {
  if (!anomaly.isAnomaly) return null

  const pctIncrease = baseline > 0 ? Math.round(((current - baseline) / baseline) * 100) : 100

  const insights: Record<string, SecurityInsight> = {
    risky_users: {
      title:    `Risky users increased ${pctIncrease}%`,
      severity: current > 20 ? 'critical' : current > 10 ? 'high' : 'medium',
      description: `${current} users flagged by Entra ID Identity Protection — a ${pctIncrease}% spike vs baseline of ${baseline}. Pattern suggests possible ${pctIncrease > 200 ? 'credential stuffing' : 'targeted account takeover'} campaign.`,
      affectedCountries: (extraContext?.countries as string[]) ?? [],
      recommendedActions: [
        'Enable Conditional Access policy for suspicious countries',
        'Force MFA re-registration for high-risk users',
        'Review and block source IP ranges',
        'Rotate credentials for affected accounts',
      ],
      estimatedImpact: current > 20 ? 'High — production systems at risk' : 'Medium — monitor closely',
    },
    failed_signins: {
      title:    `Failed sign-in rate elevated ${pctIncrease}%`,
      severity: 'high',
      description: `Unusual sign-in failure volume detected. This pattern is consistent with ${pctIncrease > 300 ? 'a password spray attack' : 'brute-force attempts'} against your tenant.`,
      recommendedActions: [
        'Enable Smart Lockout in Entra ID',
        'Review Conditional Access sign-in frequency',
        'Check for legacy authentication protocols',
      ],
      estimatedImpact: 'High — authentication infrastructure under stress',
    },
  }

  return insights[metric] ?? {
    title:              `Anomaly detected: ${metric}`,
    severity:           'medium',
    description:        anomaly.message,
    recommendedActions: ['Investigate the affected systems', 'Review recent changes'],
    estimatedImpact:    'Unknown — manual investigation required',
  }
}
