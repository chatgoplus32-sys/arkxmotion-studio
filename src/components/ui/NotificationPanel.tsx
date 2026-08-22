import { useState, useRef, useEffect, useCallback } from 'react'
import { useToastStore, ToastType } from '@/stores/toastStore'
import { Bell, CheckCircle, XCircle, Info, AlertTriangle, Trash2, X, Megaphone, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ─── Server notification type ─────────────────────────── */
interface ServerNotification {
  id: number
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error' | 'announcement'
  target: 'all' | 'users' | 'admins'
  read: number
  created_at: string
}

const SERVER_TYPE_ICONS: Record<string, React.ReactNode> = {
  info: <Info className="h-4 w-4 text-blue-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  success: <CheckCircle className="h-4 w-4 text-emerald-400" />,
  error: <XCircle className="h-4 w-4 text-red-400" />,
  announcement: <Megaphone className="h-4 w-4 text-purple-400" />,
}

const SERVER_TYPE_COLORS: Record<string, string> = {
  info: 'bg-blue-400/10',
  warning: 'bg-amber-400/10',
  success: 'bg-emerald-400/10',
  error: 'bg-red-400/10',
  announcement: 'bg-purple-400/10',
}

/* ─── Toast icons (local) ──────────────────────────────── */
const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
}

const TOAST_COLORS: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-destructive',
  info: 'text-primary',
  warning: 'text-yellow-500',
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'baru saja'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}j lalu`
  const days = Math.floor(hours / 24)
  return `${days}h lalu`
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'baru saja'
    if (diffMins < 60) return `${diffMins}m lalu`
    const diffHrs = Math.floor(diffMins / 60)
    if (diffHrs < 24) return `${diffHrs}j lalu`
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

/* ─── Main Component ────────────────────────────────────── */
export function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'server' | 'local'>('server')
  const panelRef = useRef<HTMLDivElement>(null)

  // Server notifications
  const [serverNotifs, setServerNotifs] = useState<ServerNotification[]>([])
  const [serverUnread, setServerUnread] = useState(0)
  const [serverLoading, setServerLoading] = useState(false)

  // Toast store (local)
  const {
    notifications: localNotifs,
    preferences,
    clearNotifications,
    toggleNotifications,
    toggleNotificationType,
  } = useToastStore()

  const token = typeof window !== 'undefined' ? localStorage.getItem('arkxmotion_token') : null

  /* ── Fetch server notifications ── */
  const fetchServerNotifs = useCallback(async () => {
    if (!token) return
    setServerLoading(true)
    try {
      const res = await fetch('/api/admin/notifications/mine?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setServerNotifs(data.notifications || [])
        setServerUnread(data.unread || 0)
      }
    } catch {
      // silent
    } finally {
      setServerLoading(false)
    }
  }, [token])

  // Fetch on mount + every 30s
  useEffect(() => {
    if (token) fetchServerNotifs()
    const interval = setInterval(() => {
      if (token) fetchServerNotifs()
    }, 30000)
    return () => clearInterval(interval)
  }, [token, fetchServerNotifs])

  // Fetch when panel opens
  useEffect(() => {
    if (isOpen && token) fetchServerNotifs()
  }, [isOpen, token, fetchServerNotifs])

  // Mark as read
  const markAsRead = async (id: number) => {
    if (!token) return
    await fetch(`/api/admin/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })
    setServerNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: 1 } : n))
    setServerUnread((prev) => Math.max(0, prev - 1))
  }

  // Click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Badge count: server unread + local toasts
  const totalBadge = serverUnread + localNotifs.length

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          isOpen ? 'bg-accent text-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground'
        )}
      >
        <Bell className="h-4 w-4" />
        {totalBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center px-1">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[360px] bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Notifikasi</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={fetchServerNotifs}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"
                title="Refresh"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', serverLoading && 'animate-spin')} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Tab Toggle */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('server')}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition relative',
                activeTab === 'server' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Server
              {serverUnread > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-destructive text-[9px] font-bold text-white">
                  {serverUnread > 99 ? '99+' : serverUnread}
                </span>
              )}
              {activeTab === 'server' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
            <button
              onClick={() => setActiveTab('local')}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition relative',
                activeTab === 'local' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Aktivitas
              {localNotifs.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                  {localNotifs.length}
                </span>
              )}
              {activeTab === 'local' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          </div>

          {/* Server Notifications Tab */}
          {activeTab === 'server' && (
            <div className="max-h-[400px] overflow-y-auto">
              {serverNotifs.length === 0 ? (
                <div className="px-4 py-10 text-center text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada notifikasi</p>
                  <p className="text-[11px] mt-1">Notifikasi dari admin akan muncul di sini</p>
                </div>
              ) : (
                <div>
                  {serverNotifs.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => !n.read && markAsRead(n.id)}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 border-b border-border/50 transition cursor-pointer hover:bg-accent/30',
                        !n.read && 'bg-primary/5'
                      )}
                    >
                      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', SERVER_TYPE_COLORS[n.type] || 'bg-muted')}>
                        {SERVER_TYPE_ICONS[n.type] || <Info className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={cn('text-xs font-medium truncate', !n.read ? 'text-foreground' : 'text-muted-foreground')}>
                            {n.title}
                          </span>
                          {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">{formatTime(n.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Local Toast Notifications Tab */}
          {activeTab === 'local' && (
            <>
              {/* Preferences */}
              <div className="px-4 py-2.5 border-b border-border/50 bg-accent/20">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">Toast Notifications</span>
                  <button
                    onClick={toggleNotifications}
                    className={cn(
                      'relative w-8 h-4.5 rounded-full transition-colors',
                      preferences.enabled ? 'bg-primary' : 'bg-secondary'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform',
                        preferences.enabled && 'translate-x-3.5'
                      )}
                    />
                  </button>
                </div>
                {preferences.enabled && (
                  <div className="flex gap-1.5">
                    {(['success', 'error', 'info', 'warning'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => toggleNotificationType(type)}
                        className={cn(
                          'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border transition',
                          preferences[type] ? 'border-current opacity-100' : 'border-transparent opacity-40'
                        )}
                      >
                        <span className={TOAST_COLORS[type]}>{TOAST_ICONS[type]}</span>
                        <span className="capitalize">{type}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Local Notifications List */}
              <div className="max-h-[300px] overflow-y-auto">
                {localNotifs.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Tidak ada aktivitas
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-4 py-2">
                      <span className="text-[10px] text-muted-foreground">{localNotifs.length} notifikasi</span>
                      <button onClick={clearNotifications} className="text-[10px] text-destructive hover:underline">
                        Hapus semua
                      </button>
                    </div>
                    {localNotifs.slice(0, 20).map((notif) => (
                      <div key={notif.id} className="px-4 py-2.5 hover:bg-secondary/50 transition border-b border-border/30 last:border-0">
                        <div className="flex items-start gap-2.5">
                          <span className={cn('mt-0.5', TOAST_COLORS[notif.type])}>
                            {TOAST_ICONS[notif.type]}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs">{notif.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {timeAgo(notif.timestamp)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
