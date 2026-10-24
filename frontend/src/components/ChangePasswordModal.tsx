import { useState } from 'react'
import { authClient } from '@/services/api/client'
import { useTenantWardenStore } from '@/store/tenantWardenStore'
import toast from 'react-hot-toast'

export function ChangePasswordModal({ forced, onClose }: { forced?: boolean; onClose?: () => void }) {
  const setMustChange = useTenantWardenStore((s) => s.setMustChangePassword)
  const [cur, setCur]   = useState('')
  const [next, setNext] = useState('')
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (next.length < 8)   { toast.error('New password must be at least 8 characters'); return }
    if (next !== conf)     { toast.error('Passwords do not match'); return }
    setBusy(true)
    try {
      await authClient.post('/auth/change-password', { currentPassword: cur, newPassword: next })
      toast.success('Password changed')
      setMustChange(false)
      const cu = useTenantWardenStore.getState().currentUser
      if (cu) useTenantWardenStore.getState().setCurrentUser({ ...cu, mustChangePassword: false } as any)
      onClose?.()
    } catch (e: any) {
      const status = e?.response?.status
      const msg = e?.response?.data?.error
        ?? (status === 404 ? 'Endpoint not found — auth-service needs rebuild' : `Failed to change password (${status ?? 'network'})`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-[92vw] max-w-sm space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          {forced ? 'Set a new password' : 'Change password'}
        </h3>
        {forced && <p className="text-xs text-amber-600">For security, please change the default password before continuing.</p>}
        {[['Current password', cur, setCur], ['New password', next, setNext], ['Confirm new password', conf, setConf]].map(
          ([ph, val, set]: any) => (
            <input key={ph} type="password" placeholder={ph} value={val}
              onChange={(e) => set(e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500" />
          ))}
        <div className="flex justify-end gap-2 pt-1">
          {!forced && <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700">Cancel</button>}
          <button onClick={submit} disabled={busy}
            className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </div>
    </div>
  )
}
