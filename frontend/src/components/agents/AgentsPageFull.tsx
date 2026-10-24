import { useState } from 'react'
import { useAgents, useAgentStats } from '@/services/api/hooks'
import { MetricCard, Panel, StatusBadge, Button, PageHeader } from '@/components/shared/ui'
import { AgentCpuBars } from '@/components/dashboard/Charts'
import { Download, Terminal, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'

const PLATFORM_ICONS: Record<string, string> = { windows: '🪟', linux: '🐧', macos: '🍎', docker: '🐳', kubernetes: '⎈' }

const DEPLOY_STEPS = {
  windows: [
    '# Download agent',
    '.\\tenantwarden-agent.exe register --gateway-url wss://your-domain.com:4433 --agent-token TOKEN',
    '.\\tenantwarden-agent.exe start',
  ],
  linux: [
    '# Download + install',
    'curl -fsSL https://your-domain.com/download/agent/linux | sudo bash',
    'tenantwarden-agent register --gateway-url wss://your-domain.com:4433 --agent-token TOKEN',
    'sudo systemctl enable --now tenantwarden-agent',
  ],
  docker: [
    'docker run -d \\',
    '  --name tenantwarden-agent \\',
    '  --restart unless-stopped \\',
    '  -v /var/run/docker.sock:/var/run/docker.sock:ro \\',
    '  -e TENANTWARDEN_GATEWAY_URL=wss://your-domain.com:4433 \\',
    '  -e TENANTWARDEN_AGENT_TOKEN=TOKEN \\',
    '  ghcr.io/tenantwarden/agent:latest start',
  ],
}

export function AgentsPageFull() {
  const { data: agents, isLoading, refetch } = useAgents()
  const { data: stats }                       = useAgentStats()
  const [platform, setPlatform]               = useState<'windows' | 'linux' | 'docker'>('linux')

  const onlineAgents  = agents?.filter(a => a.status === 'online')  ?? []
  const offlineAgents = agents?.filter(a => a.status !== 'online')  ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agents"
        subtitle="TenantWarden agents deployed across your infrastructure"
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => refetch()}>
              <RefreshCw size={12} />Refresh
            </Button>
            <Button variant="primary" size="sm">
              <Download size={12} />Deploy agent
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard label="Total agents"  value={stats?.total   ?? '—'} />
        <MetricCard label="Online"        value={stats?.online  ?? '—'} color="green" />
        <MetricCard label="Offline"       value={(stats?.total ?? 0) - (stats?.online ?? 0)} color="red" />
        <MetricCard label="Windows"       value={stats?.windows ?? '—'} />
        <MetricCard label="Linux"         value={stats?.linux   ?? '—'} />
      </div>

      {/* Live fleet */}
      <Panel title="Agent fleet" action={<span className="text-[10px] text-green-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />Live</span>}>
        {isLoading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />)}</div>}

        {/* Online agents */}
        {onlineAgents.map(agent => (
          <div key={agent.id} className="flex items-center gap-3 py-3 border-b border-gray-200 dark:border-gray-800/60 last:border-0">
            <span className="text-xl flex-shrink-0">{PLATFORM_ICONS[agent.platform] ?? '💻'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{agent.hostname}</span>
                <span className="text-[10px] text-gray-500">{agent.version}</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{agent.osName} · {agent.ipAddress}</div>
            </div>

            {/* Metric bars */}
            <div className="flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
              {[
                { label: 'CPU', val: agent.cpuPercent },
                { label: 'RAM', val: agent.memoryPercent },
              ].map(({ label, val }) => (
                <div key={label} className="flex flex-col items-end gap-0.5 w-16">
                  <div className="flex justify-between w-full">
                    <span className="text-gray-400 dark:text-gray-600">{label}</span>
                    <span className={val > 85 ? 'text-red-600 dark:text-red-400' : val > 70 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}>
                      {val != null ? `${val.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-gray-100 dark:bg-gray-800 rounded-full">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${val ?? 0}%`, background: val > 85 ? '#ef4444' : val > 70 ? '#f59e0b' : '#3b82f6' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <StatusBadge status={agent.status} />
            <Button size="sm" className="text-[11px]"><Terminal size={10} />Shell</Button>
          </div>
        ))}

        {/* Offline agents */}
        {offlineAgents.map(agent => (
          <div key={agent.id} className="flex items-center gap-3 py-3 border-b border-gray-200 dark:border-gray-800/60 last:border-0 opacity-50">
            <span className="text-xl flex-shrink-0">{PLATFORM_ICONS[agent.platform] ?? '💻'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <WifiOff size={12} className="text-gray-400 dark:text-gray-600 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{agent.hostname}</span>
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">{agent.osName} · Last seen {agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toLocaleString() : 'never'}</div>
            </div>
            <StatusBadge status="offline" />
          </div>
        ))}

        {agents?.length === 0 && !isLoading && (
          <div className="py-8 text-center text-xs text-gray-500">
            No agents deployed yet. Use the deploy section below to get started.
          </div>
        )}
      </Panel>

      {/* CPU/Memory overview chart */}
      {(agents?.length ?? 0) > 0 && (
        <Panel title="CPU & memory overview">
          <AgentCpuBars agents={agents?.filter(a => a.status === 'online').map(a => ({
            hostname: a.hostname,
            cpu: a.cpuPercent ?? 0,
            mem: a.memoryPercent ?? 0,
          }))} />
        </Panel>
      )}

      {/* Deploy section */}
      <Panel title="Deploy a new agent">
        <div className="flex gap-2 mb-4">
          {(['windows', 'linux', 'docker'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                platform === p
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {PLATFORM_ICONS[p]} {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
          <pre className="text-xs text-green-600 dark:text-green-400 font-mono whitespace-pre-wrap leading-relaxed">
            {DEPLOY_STEPS[platform].join('\n')}
          </pre>
        </div>

        <div className="flex gap-3 mt-4 flex-wrap">
          <Button variant="primary" size="sm" onClick={() => {
            const file = platform === 'windows' ? 'tenantwarden-agent.exe'
                       : platform === 'linux'   ? 'tenantwarden-agent-linux-amd64'
                       : 'tenantwarden-agent-linux-amd64'   // docker tab → linux binary
            window.open(`/downloads/${file}`, '_blank')
          }}>
            <Download size={12} />Download binary
          </Button>
          <Button size="sm" onClick={() => {
            navigator.clipboard.writeText(DEPLOY_STEPS[platform].join('\n')).catch(() => {})
            toast.success('Deploy commands copied to clipboard')
          }}>
            Copy deploy commands
          </Button>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Binaries are served from <code className="text-gray-500 dark:text-gray-400">/downloads/</code>. If the download 404s, compile them once on the server:{' '}
          <code className="text-gray-500 dark:text-gray-400">docker run --rm -v $PWD/agent:/src -w /src golang:1.22 make all</code>
        </p>
      </Panel>
    </div>
  )
}
