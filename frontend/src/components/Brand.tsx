import { Heart } from 'lucide-react'
import { cx } from '@/components/ui'

export const WEBSITE = 'https://tenantwarden.org'
export const REPOSITORY = 'https://github.com/jahmed-cloud/TenantWarden'

/**
 * The maintainer's links, used by the sidebar, the page footer and the About page.
 * This is the only place they are written: change a link here and it changes everywhere.
 */
export const MAINTAINER = {
  name: 'Junaid Ahmed',
  website: 'https://jahmed.cloud',
  github: 'https://github.com/jahmed-cloud',
  sponsor: 'https://github.com/sponsors/jahmed-cloud',
  email: 'iam@jahmed.cloud',
  // PLACEHOLDER (bio): a one-line bio for the About page. Empty on purpose; nothing is shown until it is filled in.
  bio: '',
}

/** Attributes for links that leave the app: new tab, no window.opener, no referrer. */
export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const

/** "https://jahmed.cloud/" → "jahmed.cloud" */
export const linkText = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** "♥ Sponsor" pill linking to GitHub Sponsors. `compact` shows the heart alone (collapsed sidebar). */
export function SponsorLink({ compact, size = 'sm', className }: { compact?: boolean; size?: 'sm' | 'md'; className?: string }) {
  return (
    <a href={MAINTAINER.sponsor} {...NEW_TAB} title="Sponsor TenantWarden on GitHub" aria-label={compact ? 'Sponsor TenantWarden on GitHub' : undefined}
      className={cx('state-layer inline-flex items-center justify-center gap-1.5 rounded-full border border-outline-variant font-medium',
        'text-on-surface-variant hover:text-on-surface whitespace-nowrap shrink-0',
        compact ? 'w-10 h-10' : size === 'md' ? 'h-10 px-5 text-sm' : 'h-8 px-3 text-xs', className)}>
      <Heart size={compact || size === 'md' ? 16 : 14} fill="currentColor" className="text-error" aria-hidden />
      {!compact && 'Sponsor'}
    </a>
  )
}

/**
 * The TenantWarden mark from tenantwarden.org: three tenant signals meeting at a watch point
 * inside a shield, on the navy tile. Drawn inline so it can animate: the shield traces itself
 * on mount and the watch point pulses (both off under prefers-reduced-motion).
 */
export function Logo({ size = 36, animated = true, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="TenantWarden" className={cx('shrink-0', className)}>
      <rect width="64" height="64" rx="14" fill="#0B1220" />
      <path d="M32 6 52 14v17c0 13-8 22-20 27C20 53 12 44 12 31V14L32 6Z" fill="none" stroke="#79E2C3" strokeWidth="3"
        strokeLinejoin="round" pathLength={1} className={animated ? 'tw-draw' : undefined} />
      <path d="m21 23 11 9 11-9M32 38v7" fill="none" stroke="#79E2C3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} className={animated ? 'tw-draw tw-draw-late' : undefined} />
      <circle cx="21" cy="23" r="3" fill="#79E2C3" />
      <circle cx="43" cy="23" r="3" fill="#79E2C3" />
      <circle cx="32" cy="45" r="3" fill="#79E2C3" />
      {animated && <circle cx="32" cy="32" r="6" fill="none" stroke="#79E2C3" strokeWidth="2" className="tw-ping" />}
      <circle cx="32" cy="32" r="6" fill="#0B1220" stroke="#EAF9F5" strokeWidth="3" />
      <circle cx="32" cy="32" r="2" fill="#79E2C3" />
    </svg>
  )
}

/** Logo plus the name, as on the website. */
export function Wordmark({ compact, subtitle = 'for Microsoft 365' }: { compact?: boolean; subtitle?: string }) {
  return (
    <span className="flex items-center gap-3 min-w-0">
      <Logo size={36} />
      {!compact && (
        <span className="leading-tight min-w-0">
          <span className="block font-display text-[17px] font-semibold tracking-tight text-on-surface">TenantWarden</span>
          <span className="block text-[11px] text-on-surface-variant">{subtitle}</span>
        </span>
      )}
    </span>
  )
}
