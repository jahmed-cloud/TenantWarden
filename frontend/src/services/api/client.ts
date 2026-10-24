import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios'
import { msalInstance, tenantWardenApiScopes } from '../auth/msalConfig'
import { useTenantWardenStore } from '../../store/tenantWardenStore'

// ─── Token acquisition ────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  // 1) Local session token (email/password login)
  const local = useTenantWardenStore.getState().accessToken
  if (local) return local

  // 2) Microsoft SSO token
  if (!msalInstance) return null
  const account = msalInstance.getActiveAccount()
  if (!account) return null

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: tenantWardenApiScopes,
      account,
    })
    return result.accessToken
  } catch {
    // Silent failed — trigger redirect
    await msalInstance.acquireTokenRedirect({ scopes: tenantWardenApiScopes })
    return null
  }
}

// ─── Axios instance ───────────────────────────────────────────────────────────

function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Attach bearer token on every request
  client.interceptors.request.use(async (config) => {
    const token = await getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // Global error handling
  client.interceptors.response.use(
    (res) => res,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        const store = useTenantWardenStore.getState()
        if (store.accessToken) {
          store.logout()               // expired local session → back to login
        } else if (msalInstance?.getActiveAccount()) {
          msalInstance.loginRedirect({ scopes: tenantWardenApiScopes })
        }
      }
      return Promise.reject(error)
    },
  )

  return client
}

export const apiClient   = createApiClient(import.meta.env.VITE_API_URL  ?? '/api')
export const authClient  = createApiClient(import.meta.env.VITE_AUTH_URL ?? '/auth')

// ─── Typed request helpers ────────────────────────────────────────────────────

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient.get<T>(url, config)
  return data
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient.post<T>(url, body, config)
  return data
}

export async function put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient.put<T>(url, body, config)
  return data
}

export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient.patch<T>(url, body, config)
  return data
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await apiClient.delete<T>(url, config)
  return data
}
