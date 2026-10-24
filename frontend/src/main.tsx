import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MsalProvider } from '@azure/msal-react'
import { Toaster } from 'react-hot-toast'

import App from './App'
import { msalInstance, initializeMsal } from './services/auth/msalConfig'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status
        if (status === 401 || status === 403) return false
        return failureCount < 2
      },
    },
  },
})

// Initialize MSAL, but ALWAYS render — local email/password login works without it
initializeMsal().catch((err) => {
  console.error('MSAL init failed (Microsoft SSO disabled, local login still works):', err)
}).then(() => {
  const inner = (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: 'var(--toast-bg, #1f2937)',
                  color:      'var(--toast-fg, #f9fafb)',
                  fontSize:   '13px',
                },
              }}
            />
      </BrowserRouter>
    </QueryClientProvider>
  )
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {msalInstance ? <MsalProvider instance={msalInstance}>{inner}</MsalProvider> : inner}
    </React.StrictMode>,
  )
})
