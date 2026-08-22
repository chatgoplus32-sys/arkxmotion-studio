import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  Activity,
  RefreshCw,
  Server,
  Cpu,
  HardDrive,
  Database,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  MemoryStick,
} from 'lucide-react'

interface HealthData {
  server: {
    uptime: number
    uptimeFormatted: string
    pid: number
    nodeVersion: string
    platform: string
    arch: string
  }
  memory: {
    total: number
    used: number
    free: number
    percentUsed: number
    totalFormatted: string
    usedFormatted: string
  }
  cpu: {
    model: string
    cores: number
    loadAvg: number[]
  }
  database: {
    size: number
    sizeFormatted: string
    totalUsers: number
    totalTokens: number
    totalLogs: number
    recentLogs24h: number
  }
  queue: {
    pendingPayments: number
    pendingUsers: number
    maintenanceProviders: string[]
  }
}

function ProgressBar({ percent, color = 'primary' }: { percent: number; color?: string }) {
  const colors: Record<string, string> = {
    primary: 'bg-primary',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  }
  const bgColor = percent > 80 ? 'bg-red-500' : percent > 60 ? 'bg-yellow-500' : colors[color] || 'bg-primary'
  return (
    <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
      <div className={`h-full rounded-full transition-all ${bgColor}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  )
}

export default function AdminSystemHealth() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/health', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const d = await res.json()
        setData(d)
        setLastRefresh(new Date().toLocaleTimeString('id-ID'))
      }
    } catch {
      addToast('Failed to fetch health data', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading || !data) {
    return (
      <div>
        <PageHeader title="System Health" desc="Monitor server health and system resources" />
        <PageContent>
          <div className="text-center py-8 text-muted-foreground">Loading health data...</div>
        </PageContent>
      </div>
    )
  }

  const { server, memory, cpu, database, queue } = data
  const memColor = memory.percentUsed > 80 ? 'red' : memory.percentUsed > 60 ? 'yellow' : 'green'
  const loadColor = cpu.loadAvg[0] > cpu.cores ? 'red' : cpu.loadAvg[0] > cpu.cores * 0.7 ? 'yellow' : 'green'

  return (
    <div>
      <PageHeader
        title="System Health"
        desc="Monitor server health and system resources in real-time"
      />
      <PageContent>
        {/* Status Banner */}
        <div className={`mb-6 p-3 rounded-xl flex items-center gap-2 ${
          queue.maintenanceProviders.length > 0 || memory.percentUsed > 80
            ? 'bg-yellow-500/10 border border-yellow-500/20'
            : 'bg-green-500/10 border border-green-500/20'
        }`}>
          {queue.maintenanceProviders.length > 0 || memory.percentUsed > 80 ? (
            <><AlertTriangle className="h-4 w-4 text-yellow-500" /><span className="text-sm text-yellow-500 font-medium">Issues detected</span></>
          ) : (
            <><CheckCircle className="h-4 w-4 text-green-500" /><span className="text-sm text-green-500 font-medium">All systems operational</span></>
          )}
          {lastRefresh && <span className="ml-auto text-[10px] text-muted-foreground">Last: {lastRefresh}</span>}
        </div>

        {/* Server Info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Server className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Uptime</span>
            </div>
            <div className="text-lg font-bold">{server.uptimeFormatted}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">PID</span>
            </div>
            <div className="text-lg font-bold">{server.pid}</div>
            <div className="text-[10px] text-muted-foreground">{server.nodeVersion} · {server.platform}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">CPU Cores</span>
            </div>
            <div className="text-lg font-bold">{cpu.cores}</div>
            <div className="text-[10px] text-muted-foreground truncate">{cpu.model}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">DB Size</span>
            </div>
            <div className="text-lg font-bold">{database.sizeFormatted}</div>
          </div>
        </div>

        {/* Memory & CPU */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Memory */}
          <Section title="Memory Usage" sub={`${memory.usedFormatted} / ${memory.totalFormatted}`}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span className="font-medium">{memory.percentUsed}%</span>
              </div>
              <ProgressBar percent={memory.percentUsed} color={memColor} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Used: {memory.usedFormatted}</span>
                <span>Free: {Math.round(memory.free / 1024 / 1024)} MB</span>
              </div>
            </div>
          </Section>

          {/* CPU Load */}
          <Section title="CPU Load Average" sub={`${cpu.loadAvg[0]} / ${cpu.loadAvg[1]} / ${cpu.loadAvg[2]}`}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">1 min</span>
                <span className="font-medium">{cpu.loadAvg[0]} / {cpu.cores} cores</span>
              </div>
              <ProgressBar percent={Math.round((cpu.loadAvg[0] / cpu.cores) * 100)} color={loadColor} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>5 min: {cpu.loadAvg[1]}</span>
                <span>15 min: {cpu.loadAvg[2]}</span>
              </div>
            </div>
          </Section>
        </div>

        {/* Database Stats */}
        <Section title="Database Statistics">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{database.totalUsers}</div>
              <div className="text-xs text-muted-foreground">Total Users</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{database.totalTokens}</div>
              <div className="text-xs text-muted-foreground">API Tokens</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-500">{database.totalLogs}</div>
              <div className="text-xs text-muted-foreground">Total Generations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-500">{database.recentLogs24h}</div>
              <div className="text-xs text-muted-foreground">Last 24 Hours</div>
            </div>
          </div>
        </Section>

        {/* Queue / Pending Items */}
        <Section title="Pending Items">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`rounded-xl border p-4 ${queue.pendingUsers > 0 ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border bg-card'}`}>
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Pending Users</span>
              </div>
              <div className="text-2xl font-bold">{queue.pendingUsers}</div>
            </div>
            <div className={`rounded-xl border p-4 ${queue.pendingPayments > 0 ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border bg-card'}`}>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Pending Payments</span>
              </div>
              <div className="text-2xl font-bold">{queue.pendingPayments}</div>
            </div>
            <div className={`rounded-xl border p-4 ${queue.maintenanceProviders.length > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-card'}`}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Maintenance</span>
              </div>
              <div className="text-2xl font-bold">{queue.maintenanceProviders.length}</div>
              {queue.maintenanceProviders.length > 0 && (
                <div className="text-[10px] text-red-500 mt-1">{queue.maintenanceProviders.join(', ')}</div>
              )}
            </div>
          </div>
        </Section>

        {/* Refresh Button */}
        <div className="flex items-center gap-3 mt-6">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <span className="text-xs text-muted-foreground">Auto-refresh setiap 5 detik</span>
        </div>
      </PageContent>
    </div>
  )
}
