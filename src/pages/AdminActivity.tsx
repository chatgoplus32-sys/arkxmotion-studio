import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, EmptyState } from '@/components/ui'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useAuthStore } from '@/stores/authStore'
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
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
  gemini: '💎', openai: '🟢', riverside: '🎙️',
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
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [searchEmail, setSearchEmail] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const LIMIT = 20

  const fetchActivity = useCallback(async (pageNum = 1) => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(LIMIT))
      params.set('offset', String((pageNum - 1) * LIMIT))
      if (filterProvider) params.set('provider', filterProvider)
      if (filterStatus) params.set('status', filterStatus)

      const res = await fetch(`/api/admin/activity?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const json = await res.json()
        setLogs(json.logs || [])
        if (typeof json.total === 'number') setTotal(json.total)
        setLastFetch(new Date().toLocaleTimeString('id-ID'))
      } else {
        setError(`Gagal memuat (HTTP ${res.status})`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat aktivitas')
    } finally {
      setLoading(false)
    }
  }, [token, filterProvider, filterStatus])

  useEffect(() => { void fetchActivity(1) }, [fetchActivity])

  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / LIMIT)) : 1

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
        <Button onClick={() => { setPage(1); void fetchActivity(1) }} disabled={loading} variant="outline" className="gap-2" aria-label="Refresh aktivitas">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button onClick={() => window.open(`/api/admin/export/activity${filterProvider ? `?provider=${filterProvider}` : ''}`, '_blank')} variant="outline" className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
        {lastFetch && <span className="text-[12px] text-muted-foreground">Terakhir: {lastFetch}</span>}

        <select
          value={filterProvider}
          onChange={(e) => { setFilterProvider(e.target.value); setPage(1) }}
          aria-label="Filter provider"
          className="ml-auto rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
        >
          <option value="">Semua Provider</option>
          {providers.map(p => <option key={p} value={p}>{PROVIDER_ICONS[p] || ''} {p}</option>)}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
          aria-label="Filter status"
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
            aria-label="Cari email aktivitas"
            className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs w-48"
          />
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-green-400">{logs.filter(l => l.status === 'completed').length}</div>
          <div className="text-[12px] text-muted-foreground">Completed</div>
        </div>
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-red-400">{logs.filter(l => l.status === 'failed').length}</div>
          <div className="text-[12px] text-muted-foreground">Failed</div>
        </div>
        <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
          <div className="text-lg font-bold text-yellow-400">{logs.filter(l => l.status === 'pending').length}</div>
          <div className="text-[12px] text-muted-foreground">Pending</div>
        </div>
      </div>

      {/* Activity list */}
      <Section title={`📋 Activity (${total || filteredLogs.length})`}>
        {loading && logs.length === 0 ? (
          <SkeletonList count={5} />
        ) : error && logs.length === 0 ? (
          <EmptyState
            icon={<XCircle className="h-8 w-8" />}
            title="Gagal memuat aktivitas"
            description={error}
            action={<Button size="sm" variant="outline" onClick={() => void fetchActivity(page)}>Coba lagi</Button>}
          />
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Belum ada activity"
            description="Coba ubah filter atau kata kunci pencarian"
          />
        ) : (
          <>
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
                      <span className="text-[12px] text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate">{log.model}</span>
                    </div>

                    {log.prompt && (
                      <p className="text-[11px] text-muted-foreground truncate mb-1">"{log.prompt.slice(0, 80)}{log.prompt.length > 80 ? '...' : ''}"</p>
                    )}

                    <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                      <span>👤 {log.user_name || log.user_email || `User #${log.user_id}`}</span>
                      {log.credits > 0 && <span>⚡ {log.credits} cr</span>}
                      {log.duration_ms && <span>⏱ {log.duration_ms > 60000 ? `${Math.round(log.duration_ms / 60000)}m` : `${Math.round(log.duration_ms / 1000)}s`}</span>}
                      {log.error && <span className="text-red-400 truncate max-w-[200px]">❌ {log.error.slice(0, 60)}</span>}
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-right shrink-0">
                    <div className="text-[12px] text-muted-foreground">{timeAgo(log.created_at)}</div>
                    <div className="text-[11px] text-muted-foreground/50">{log.created_at?.slice(11, 19)}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Halaman {page} dari {totalPages}{total ? ` · ${total} total` : ''}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => { const p = Math.max(1, page - 1); setPage(p); void fetchActivity(p) }}
                aria-label="Halaman sebelumnya"
              >
                ← Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || (total > 0 && page >= totalPages) || filteredLogs.length < LIMIT}
                onClick={() => { const p = page + 1; setPage(p); void fetchActivity(p) }}
                aria-label="Halaman berikutnya"
              >
                Next →
              </Button>
            </div>
          </div>
          </>
        )}
      </Section>
    </PageContent>
  )
}
