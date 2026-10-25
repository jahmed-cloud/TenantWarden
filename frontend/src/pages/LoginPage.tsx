import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { authClient, errorMessage } from '@/services/api/client'
import { useTenantWardenStore, type CurrentUser } from '@/store/tenantWardenStore'
import { Logo } from '@/components/AppShell'
import { Banner, Button, TextField } from '@/components/ui'

interface LoginResponse { accessToken?: string; user?: CurrentUser; requiresMfa?: boolean }

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
    <div className="min-h-screen flex items-center justify-center bg-surface-container-low px-4">
      <div className="w-full max-w-[400px]">
        <div className="bg-surface-container-lowest rounded-3xl shadow-e2 px-8 py-10">
          <div className="flex flex-col items-center text-center mb-8">
            <Logo size={48} />
            <h1 className="text-2xl font-normal text-on-surface mt-4">Sign in to TenantWarden</h1>
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
        <p className="text-center text-xs text-on-surface-variant mt-6">
          <a href="https://tenantwarden.org" target="_blank" rel="noreferrer" className="hover:text-primary">tenantwarden.org</a>
          {' · '}Self-hosted · MIT licensed
        </p>
      </div>
    </div>
  )
}
