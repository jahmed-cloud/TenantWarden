import { useState } from 'react'
import toast from 'react-hot-toast'
import { authClient, errorMessage } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import { Banner, Button, CodeBlock, Dialog, TextField } from '@/components/ui'

export function ChangePasswordDialog({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (next.length < 12) return toast.error('Use at least 12 characters')
    if (next !== confirm) return toast.error('The new passwords do not match')
    setBusy(true)
    try {
      await authClient.post('/auth/change-password', { currentPassword: current, newPassword: next })
      const user = useTenantWardenStore.getState().currentUser
      if (user) useTenantWardenStore.getState().setCurrentUser({ ...user, mustChangePassword: false })
      toast.success('Password changed')
      setCurrent(''); setNext(''); setConfirm('')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={forced ? () => undefined : onClose} title={forced ? 'Choose a new password' : 'Change password'}
      actions={<>
        {!forced && <Button variant="text" onClick={onClose}>Cancel</Button>}
        <Button onClick={submit} loading={busy}>Change password</Button>
      </>}>
      <div className="space-y-4 pb-2">
        {forced && <Banner tone="warning">This account still uses a temporary password. Choose your own to continue.</Banner>}
        <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoFocus />
        <TextField label="New password" type="password" value={next} onChange={setNext} hint="At least 12 characters" />
        <TextField label="Confirm new password" type="password" value={confirm} onChange={setConfirm} onEnter={submit} />
      </div>
    </Dialog>
  )
}

export function MfaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useTenantWardenStore((s) => s.currentUser)
  const [setup, setSetup] = useState<{ secret: string; qrUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try { setSetup((await authClient.post('/auth/mfa/setup')).data) }
    catch (err) { toast.error(errorMessage(err)) }
    finally { setBusy(false) }
  }

  async function verify() {
    if (!setup) return
    setBusy(true)
    try {
      await authClient.post('/auth/mfa/verify', { secret: setup.secret, code })
      if (user) useTenantWardenStore.getState().setCurrentUser({ ...user, mfaEnabled: true })
      toast.success('Two-step sign-in is on')
      setSetup(null); setCode('')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, 'That code did not match'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Two-step sign-in"
      actions={user?.mfaEnabled ? <Button onClick={onClose}>Close</Button> : setup
        ? <><Button variant="text" onClick={() => setSetup(null)}>Back</Button><Button onClick={verify} loading={busy} disabled={code.length !== 6}>Verify and turn on</Button></>
        : <><Button variant="text" onClick={onClose}>Cancel</Button><Button onClick={start} loading={busy}>Set up</Button></>}>
      <div className="space-y-4 pb-2">
        {user?.mfaEnabled ? (
          <Banner tone="success">Two-step sign-in is on. Every sign-in asks for a code from your authenticator app.</Banner>
        ) : !setup ? (
          <p>Protect this account with a 6-digit code from an authenticator app (Microsoft Authenticator, 1Password, Google Authenticator).</p>
        ) : (
          <>
            <p>Add an account in your authenticator app with this setup key, or open the link on the device that has the app.</p>
            <CodeBlock label="Setup key" code={setup.secret} />
            <a href={setup.qrUri} className="text-primary text-sm underline break-all">Open in authenticator app</a>
            <TextField label="6-digit code" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} mono onEnter={verify} autoFocus />
          </>
        )}
      </div>
    </Dialog>
  )
}
