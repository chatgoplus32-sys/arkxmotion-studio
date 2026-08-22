import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import {
  Bell, Send, Trash2, RefreshCw, Loader2, AlertTriangle,
  CheckCircle, Info, XCircle, Megaphone, Filter, Search,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react'

interface Notification {
  id: number
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error' | 'announcement'
  target: 'all' | 'users' | 'admins'
  user_id: number | null
  user_email?: string
  read: number
  created_at: string
}

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  info: { icon: <Info className="h-4 w-4" />, color: 'text-blue-400', bg: 'bg-blue-400/10' },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  success: { icon: <CheckCircle className="h-4 w-4" />, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  error: { icon: <XCircle className="h-4 w-4" />, color: 'text-red-400', bg: 'bg-red-400/10' },
  announcement: { icon: <Megaphone className="h-4 w-4" />, color: 'text-purple-400', bg: 'bg-purple-400/10' },
}

const TARGET_LABELS: Record<string, string> = {
  all: 'Semua User',
  users: 'User Only',
  admins: 'Admin Only',
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Send form
  const [showSend, setShowSend] = useState(false)
  const [sendMode, setSendMode] = useState<'broadcast' | 'targeted'>('broadcast')
  const [sendTitle, setSendTitle] = useState('')
  const [sendMsg, setSendMsg] = useState('')
  const [sendType, setSendType] = useState<string>('info')
  const [sendTarget, setSendTarget] = useState<string>('all')
  const [sendLoading, setSendLoading] = useState(false)

  const limit = 20

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/notifications?limit=${limit}&offset=${page * limit}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('arkxmotion_token')}` },
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications)
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const handleSend = async () => {
    if (!sendTitle.trim() || !sendMsg.trim()) return
    setSendLoading(true)
    try {
      const url = sendMode === 'broadcast' ? '/api/admin/notifications/broadcast' : '/api/admin/notifications'
      const body = sendMode === 'broadcast'
        ? { title: sendTitle, message: sendMsg, type: sendType }
        : { title: sendTitle, message: sendMsg, type: sendType, target: sendTarget }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('arkxmotion_token')}`,
        },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setShowSend(false)
        setSendTitle('')
        setSendMsg('')
        fetchNotifications()
      }
    } finally {
      setSendLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    await fetch(`/api/admin/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('arkxmotion_token')}` },
    })
    fetchNotifications()
  }

  const handleClearAll = async () => {
    if (!confirm('Hapus semua notifikasi?')) return
    await fetch('/api/admin/notifications/clear-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('arkxmotion_token')}` },
    })
    fetchNotifications()
  }

  const filtered = notifications.filter((n) => {
    if (filterType !== 'all' && n.type !== filterType) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.ceil(total / limit)

  // Stats
  const unreadCount = notifications.filter((n) => !n.read).length
  const todayCount = notifications.filter((n) => {
    const d = new Date(n.created_at)
    const today = new Date()
    return d.toDateString() === today.toDateString()
  }).length

  return (
    <PageContent>
      <PageHeader
        eyebrow="Admin"
        title="Notification"
        highlight="Center"
        desc="Kirim dan manage notifikasi untuk semua user."
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Bell className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{total}</div>
              <div className="text-[11px] text-muted-foreground">Total Notifikasi</div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 animate-fade-in" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Bell className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">{unreadCount}</div>
              <div className="text-[11px] text-muted-foreground">Belum Dibaca</div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Megaphone className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">{todayCount}</div>
              <div className="text-[11px] text-muted-foreground">Hari Ini</div>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowSend(true)}
          className="rounded-xl border border-primary/30 bg-primary/5 p-4 animate-fade-in hover:bg-primary/10 hover:border-primary/50 transition cursor-pointer text-left"
          style={{ animationDelay: '150ms' }}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl gold-gradient flex items-center justify-center">
              <Send className="h-5 w-5 text-black" />
            </div>
            <div>
              <div className="text-lg font-bold gold-text">Kirim</div>
              <div className="text-[11px] text-muted-foreground">Notifikasi Baru</div>
            </div>
          </div>
        </button>
      </div>

      {/* Send Form Modal */}
      {showSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSend(false)}>
          <Card variant="bordered" className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  <span>Kirim Notifikasi</span>
                </div>
                <button onClick={() => setShowSend(false)} className="p-1 hover:bg-accent rounded-lg"><X className="h-4 w-4" /></button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSendMode('broadcast')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition ${sendMode === 'broadcast' ? 'bg-primary/10 border-primary/50 text-primary' : 'border-border hover:bg-accent'}`}
                >
                  <Megaphone className="h-4 w-4 inline mr-1" /> Broadcast All
                </button>
                <button
                  onClick={() => setSendMode('targeted')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition ${sendMode === 'targeted' ? 'bg-primary/10 border-primary/50 text-primary' : 'border-border hover:bg-accent'}`}
                >
                  <Bell className="h-4 w-4 inline mr-1" /> Targeted
                </button>
              </div>

              {/* Type */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipe</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(TYPE_META).map(([key, meta]) => (
                    <button
                      key={key}
                      onClick={() => setSendType(key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition capitalize ${sendType === key ? `${meta.bg} ${meta.color} border-current` : 'border-border hover:bg-accent'}`}
                    >
                      {meta.icon} {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target (if targeted) */}
              {sendMode === 'targeted' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Target</label>
                  <div className="flex gap-2">
                    {Object.entries(TARGET_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setSendTarget(key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${sendTarget === key ? 'bg-primary/10 border-primary/50 text-primary' : 'border-border hover:bg-accent'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Judul</label>
                <input
                  type="text"
                  value={sendTitle}
                  onChange={(e) => setSendTitle(e.target.value)}
                  placeholder="Judul notifikasi..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-primary/50"
                  maxLength={200}
                />
              </div>

              {/* Message */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Pesan</label>
                <textarea
                  value={sendMsg}
                  onChange={(e) => setSendMsg(e.target.value)}
                  placeholder="Isi notifikasi..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-primary/50 resize-none"
                  maxLength={2000}
                />
                <div className="text-[10px] text-muted-foreground text-right mt-1">{sendMsg.length}/2000</div>
              </div>

              {/* Send Button */}
              <button
                onClick={handleSend}
                disabled={sendLoading || !sendTitle.trim() || !sendMsg.trim()}
                className="w-full py-2.5 rounded-lg gold-gradient text-black font-medium text-sm hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendMode === 'broadcast' ? 'Broadcast ke Semua' : 'Kirim Notifikasi'}
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toolbar */}
      <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '200ms' }}>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari notifikasi..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none"
              >
                <option value="all">Semua Tipe</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="announcement">Announcement</option>
              </select>
            </div>

            {/* Actions */}
            <button
              onClick={fetchNotifications}
              className="p-2 rounded-lg border border-border hover:bg-accent transition"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={handleClearAll}
              className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition"
              title="Hapus Semua"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">{total} total</span>
          </div>
        </CardContent>
      </Card>

      {/* Notifications List */}
      <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '250ms' }}>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Tidak ada notifikasi</p>
              <p className="text-xs mt-1">Klik "Kirim" untuk membuat notifikasi baru</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.info
                return (
                  <div key={n.id} className={`flex items-start gap-3 p-4 hover:bg-accent/30 transition group ${!n.read ? 'bg-primary/5' : ''}`}>
                    <div className={`h-8 w-8 rounded-lg ${meta.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                      <span className={meta.color}>{meta.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-medium ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>{n.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${meta.bg} ${meta.color}`}>{n.type}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{TARGET_LABELS[n.target] || n.target}</span>
                        {!n.read && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {n.user_email && (
                          <span className="text-[10px] text-muted-foreground">→ {n.user_email}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(n.id)}
                      className="p-1.5 rounded-lg border border-transparent text-muted-foreground hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100 shrink-0"
                      title="Hapus"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Halaman {page + 1} dari {totalPages}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-30 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-30 transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContent>
  )
}
