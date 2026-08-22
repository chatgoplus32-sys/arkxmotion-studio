import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import {
  Activity,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Filter,
  Search,
  Download,
} from 'lucide-react'

interface ActivityLog {
  id: number
  user_id: number
  user_name: string | null
  user_email: string | null
  page: string
  provider: string
  model: string
  prompt: string
  credits: number
  status: string
  result_url: string | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

const PROVIDER_ICONS: Record<string, string> = {
  weavy: '🌊', wavespeed: '⚡', magnific: '✨', roboneo: '🤖', createpulse: '💜',
  framia: '🎬', galleri5: '🎬', leonardo: '🎨', oneover: '🔮', firefly: '🔥',
  gemini: '💎', openai: '🟢',
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  completed: { icon: <CheckCircle className="h-3.5 w-3.5" />, color: 'text-green-400 bg-green-500/10 border-green-500/30', label: 'Completed' },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, color: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Failed' },
  pending: { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', label: 'Pending' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Baru saja'
  if (mins < 60) return `${mins}m lalu`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}j lalu`
  const days = Math.floor(hours / 24)
  return `${days}d lalu`
}

export default function AdminActivityPage() {
  const { token } = useAuthStore()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(false)
  const [lastFetch, setLastFetch] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [searchEmail, setSearchEmail] = useState('')

  const fetchActivity = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (filterProvider) params.set('provider', filterProvider)
      if (filterStatus) params.set('status', filterStatus)

      const res = await fetch(`/api/admin/activity?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setLogs(json.logs || [])
        setLastFetch(new Date().toLocaleTimeString('id-ID'))
      }
    } catch (err) {
      console.error('Failed to fetch activity:', err)
    } finally {
      setLoading(false)
    }
  }, [token, filterProvider, filterStatus])

  useEffect(() => { fetchActivity() }, [fetchActivity])

  const filteredLogs = searchEmail
    ? logs.filter(l => l.user_email?.toLowerCase().includes(searchEmail.toLowerCase()) || l.user_name?.toLowerCase().includes(searchEmail.toLowerCase()))
    : logs

  const providers = [...new Set(logs.map(l => l.provider))].sort()

  return (
    <PageContent>
      <PageHeader
        eyebrow="Admin"
        title="User Activity"
        highlight="Feed"
        desc="Lihat aktivitas generate terbaru semua user secara real-time."
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button onClick={fetchActivity} disabled={loading} variant="outline" className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button onClick={() => window.open(`/api/admin/export/activity${filterProvider ? `?provider=${filterProvider}` : ''}`, '_blank')} variant="outline" className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
        {lastFetch && <span className="text-[10px] text-muted-foreground">Terakhir: {lastFetch}</span>}

        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="ml-auto rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
        >
          <option value="">Semua Provider</option>
          {providers.map(p => <option key={p} value={p}>{PROVIDER_ICONS[p] || ''} {p}</option>)}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
        >
          <option value="">Semua Status</option>
          <option value="completed">✅ Completed</option>
          <option value="failed">❌ Failed</option>
          <option value="pending">⏳ Pending</option>
        </select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="Cari email..."
            className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs w-48"
          />
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-green-400">{logs.filter(l => l.status === 'completed').length}</div>
          <div className="text-[10px] text-muted-foreground">Completed</div>
        </div>
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-red-400">{logs.filter(l => l.status === 'failed').length}</div>
          <div className="text-[10px] text-muted-foreground">Failed</div>
        </div>
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-yellow-400">{logs.filter(l => l.status === 'pending').length}</div>
          <div className="text-[10px] text-muted-foreground">Pending</div>
        </div>
      </div>

      {/* Activity list */}
      <Section title={`📋 Activity (${filteredLogs.length})`}>
        {filteredLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada activity</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredLogs.map((log) => {
              const st = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending
              return (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card/30 hover:bg-card/50 transition-colors">
                  {/* Status icon */}
                  <div className={`mt-0.5 p-1.5 rounded-lg border ${st.color}`}>
                    {st.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{PROVIDER_ICONS[log.provider] || '🔹'}</span>
                      <span className="text-xs font-medium capitalize">{log.provider}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate">{log.model}</span>
                    </div>

                    {log.prompt && (
                      <p className="text-[11px] text-muted-foreground truncate mb-1">"{log.prompt.slice(0, 80)}{log.prompt.length > 80 ? '...' : ''}"</p>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>👤 {log.user_name || log.user_email || `User #${log.user_id}`}</span>
                      {log.credits > 0 && <span>⚡ {log.credits} cr</span>}
                      {log.duration_ms && <span>⏱ {log.duration_ms > 60000 ? `${Math.round(log.duration_ms / 60000)}m` : `${Math.round(log.duration_ms / 1000)}s`}</span>}
                      {log.error && <span className="text-red-400 truncate max-w-[200px]">❌ {log.error.slice(0, 60)}</span>}
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground">{timeAgo(log.created_at)}</div>
                    <div className="text-[9px] text-muted-foreground/50">{log.created_at?.slice(11, 19)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
