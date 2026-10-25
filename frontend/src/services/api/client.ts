import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { useTenantWardenStore } from '@/store/tenantWardenStore'

// nginx serves the API under /api and auth-service under /auth (prefix stripped), so the
// auth endpoints are /auth/auth/... from the browser's point of view.
const API_BASE  = '/api'
const AUTH_BASE = '/auth'

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean }

let refreshing: Promise<string | null> | null = null

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent 401s share one
 * refresh; the refresh token rotates on every call.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<{ accessToken: string }>(`${AUTH_BASE}/auth/refresh`, null, { withCredentials: true })
    .then((r) => {
      useTenantWardenStore.getState().setAccessToken(r.data.accessToken)
      return r.data.accessToken
    })
    .catch(() => null)
    .finally(() => { refreshing = null })
  return refreshing
}

function createClient(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL, timeout: 30_000, withCredentials: true })

  client.interceptors.request.use((config) => {
    const token = useTenantWardenStore.getState().accessToken
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined
      const url = config?.url ?? ''
      const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')
      if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
        config._retried = true
        const token = await refreshAccessToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
          return client(config)
        }
        useTenantWardenStore.getState().clearSession() // back to the sign-in page
      }
      return Promise.reject(error)
    },
  )
  return client
}

export const apiClient  = createClient(API_BASE)
export const authClient = createClient(AUTH_BASE)

/** The API's own error text ({ error }), a validation summary, or the HTTP status. */
export function errorMessage(err: unknown, fallback = 'Request failed'): string {
  const e = err as AxiosError<{ error?: string; title?: string; errors?: Record<string, string[]> }>
  const data = e?.response?.data
  if (data?.error) return data.error
  if (data?.errors) return Object.values(data.errors).flat().join(' ')
  if (data?.title) return data.title
  if (e?.response?.status === 403) return 'Your role is not allowed to do this'
  return e?.response ? `${fallback} (HTTP ${e.response.status})` : e?.message ?? fallback
}

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await apiClient.get<T>(url, config)).data
}
export async function post<T>(url: string, body?: unknown): Promise<T> {
  return (await apiClient.post<T>(url, body)).data
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  return (await apiClient.put<T>(url, body)).data
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  return (await apiClient.patch<T>(url, body)).data
}
export async function del<T>(url: string): Promise<T> {
  return (await apiClient.delete<T>(url)).data
}
