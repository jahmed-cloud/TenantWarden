import { useState } from 'react'
import { AlertCircle, Bell, Cpu, SearchCode, ShieldCheck } from 'lucide-react'
import { authClient, errorMessage } from '@/services/api/client'
import { useTenantWardenStore, type CurrentUser } from '@/store/tenantWardenStore'
import { Logo, REPOSITORY, WEBSITE } from '@/components/Brand'
import { Banner, Button, TextField } from '@/components/ui'

interface LoginResponse { accessToken?: string; user?: CurrentUser; requiresMfa?: boolean }

const POINTS = [
  { icon: ShieldCheck, text: 'Identity, Secure Score, Defender incidents and Conditional Access from Microsoft Graph' },
  { icon: Cpu, text: 'Windows and Linux agents: health, security inventory, server roles, logs and network checks' },
  { icon: Bell, text: '40 alert metrics and custom query rules, sent to Teams, Slack, email or PagerDuty' },
  { icon: SearchCode, text: 'A KQL-style query language across everything it collects' },
]

export function LoginPage() {
  const setSession = useTenantWardenStore((s) => s.setSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn() {
    if (!email || !password) return setError('Enter your email and password')
    setBusy(true); setError('')
    try {
      const { data } = await authClient.post<LoginResponse>('/auth/login', { email, password, totpCode: code || undefined })
      if (data.requiresMfa) { setNeedsCode(true); return }
      if (data.accessToken) setSession(data.accessToken, data.user ?? null)
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-surface">
      {/* Brand panel: the website's navy, grid and mint glow, in both themes */}
      <aside className="hidden lg:flex relative overflow-hidden tw-backdrop text-brand-ink flex-col justify-between p-12">
        <div className="absolute inset-0 tw-grid pointer-events-none" />
        <a href={WEBSITE} target="_blank" rel="noreferrer" className="relative flex items-center gap-3 w-fit">
          <Logo size={40} />
          <span className="font-display text-xl font-semibold tracking-tight">TenantWarden</span>
        </a>

        <div className="relative max-w-lg">
          <div className="animate-float w-fit mb-8"><Logo size={88} className="drop-shadow-[0_0_28px_rgba(124,230,197,0.35)]" /></div>
          <h2 className="font-display text-4xl leading-tight font-semibold tracking-tight">
            Watch every tenant.<br /><span className="text-brand-mint">Miss nothing.</span>
          </h2>
          <p className="text-brand-muted mt-4 text-base">Self-hosted security monitoring for Microsoft 365 and the servers behind it.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p, i) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-brand-ink/90 animate-fade-up" style={{ animationDelay: `${150 + i * 90}ms` }}>
                <span className="w-8 h-8 rounded-lg bg-brand-panel2 border border-brand-line text-brand-mint flex items-center justify-center shrink-0"><p.icon size={16} /></span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-muted">
          <a href={WEBSITE} target="_blank" rel="noreferrer" className="text-brand-mint hover:underline">tenantwarden.org</a>
          {' · '}<a href={REPOSITORY} target="_blank" rel="noreferrer" className="hover:text-brand-ink">GitHub</a>{' · '}MIT licensed
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] animate-fade-up">
          <div className="bg-surface-container-lowest rounded-3xl shadow-e2 px-8 py-10">
            <div className="flex flex-col items-center text-center mb-8">
              <Logo size={52} />
              <h1 className="font-display text-2xl font-medium tracking-tight text-on-surface mt-4">Sign in to TenantWarden</h1>
              <p className="text-sm text-on-surface-variant mt-1">Security monitoring for Microsoft 365</p>
            </div>
            <div className="space-y-4">
              <TextField label="Email" type="email" value={email} onChange={setEmail} autoFocus onEnter={signIn} />
              <TextField label="Password" type="password" value={password} onChange={setPassword} onEnter={signIn} />
              {needsCode && (
                <TextField label="Code from your authenticator app" value={code} mono autoFocus onEnter={signIn}
                  onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} />
              )}
              {error && <Banner tone="error" icon={AlertCircle}>{error}</Banner>}
              <Button className="w-full" onClick={signIn} loading={busy}>Sign in</Button>
            </div>
          </div>
          <p className="text-center text-xs text-on-surface-variant mt-6 lg:hidden">
            <a href={WEBSITE} target="_blank" rel="noreferrer" className="hover:text-primary">tenantwarden.org</a>
            {' · '}Self-hosted · MIT licensed
          </p>
        </div>
      </main>
    </div>
  )
}
