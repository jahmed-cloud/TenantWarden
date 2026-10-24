import { useEffect, useRef, useCallback } from 'react'
import { useTenantWardenStore } from '../store/tenantWardenStore'
import { msalInstance, tenantWardenApiScopes } from '../services/auth/msalConfig'

type WsMessageType =
  | 'live_stats'
  | 'alert_created'
  | 'alert_updated'
  | 'agent_status'
  | 'service_health'
  | 'risky_user'
  | 'incident'

interface WsMessage<T = unknown> {
  type: WsMessageType
  tenantId: string
  payload: T
  timestamp: string
}

interface UseWebSocketOptions {
  onAlert?: (alert: unknown) => void
  onAgentStatus?: (agent: unknown) => void
  onServiceHealth?: (health: unknown) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const wsRef       = useRef<WebSocket | null>(null)
  const reconnectTm = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts    = useRef(0)
  const maxAttempts = 10

  const { updateLiveStats, setWsConnected, activeTenant } = useTenantWardenStore()

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Acquire token for WebSocket auth
    let token = ''
    try {
      const localToken = useTenantWardenStore.getState().accessToken
      if (localToken) return localToken
      if (!msalInstance) return null
      const account = msalInstance.getActiveAccount()
      if (account) {
        const result = await msalInstance.acquireTokenSilent({
          scopes: tenantWardenApiScopes,
          account,
        })
        token = result.accessToken
      }
    } catch { /* will reconnect */ }

    const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost/ws'
    const tenantParam = activeTenant?.id ? `&tenantId=${activeTenant.id}` : ''
    const ws = new WebSocket(`${wsUrl}/hub?token=${token}${tenantParam}`)
    wsRef.current = ws

    ws.onopen = () => {
      attempts.current = 0
      setWsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        switch (msg.type) {
          case 'live_stats':
            updateLiveStats(msg.payload as Parameters<typeof updateLiveStats>[0])
            break
          case 'alert_created':
          case 'alert_updated':
            options.onAlert?.(msg.payload)
            break
          case 'agent_status':
            options.onAgentStatus?.(msg.payload)
            break
          case 'service_health':
            options.onServiceHealth?.(msg.payload)
            break
        }
      } catch { /* malformed message */ }
    }

    ws.onerror = () => {
      setWsConnected(false)
    }

    ws.onclose = () => {
      setWsConnected(false)
      wsRef.current = null

      if (attempts.current < maxAttempts) {
        const delay = Math.min(1000 * 2 ** attempts.current, 30_000)
        attempts.current++
        reconnectTm.current = setTimeout(connect, delay)
      }
    }
  }, [activeTenant?.id, updateLiveStats, setWsConnected, options])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTm.current) clearTimeout(reconnectTm.current)
      wsRef.current?.close()
    }
  }, [connect])
}
