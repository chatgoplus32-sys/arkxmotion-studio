import { useState, useRef, useEffect } from 'react'
import { useToastStore, ToastType } from '@/stores/toastStore'
import { Bell, CheckCircle, XCircle, Info, AlertTriangle, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
}

const typeColors: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-destructive',
  info: 'text-primary',
  warning: 'text-yellow-500',
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const {
    notifications,
    preferences,
    clearNotifications,
    toggleNotifications,
    toggleNotificationType
  } = useToastStore()

  const unreadCount = notifications.length

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          isOpen ? 'bg-accent text-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground'
        )}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">Notifications</h3>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <button
                  onClick={clearNotifications}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Notifications</span>
              <button
                onClick={toggleNotifications}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors',
                  preferences.enabled ? 'bg-primary' : 'bg-secondary'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    preferences.enabled && 'translate-x-4'
                  )}
                />
              </button>
            </div>

            {preferences.enabled && (
              <div className="flex flex-wrap gap-2 mt-2">
                {(['success', 'error', 'info', 'warning'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleNotificationType(type)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors border',
                      preferences[type]
                        ? 'border-current opacity-100'
                        : 'border-transparent opacity-40'
                    )}
                  >
                    <span className={typeColors[type]}>{icons[type]}</span>
                    <span className="capitalize">{type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                No notifications
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.slice(0, 20).map((notif) => (
                  <div key={notif.id} className="px-4 py-3 hover:bg-secondary/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <span className={cn('mt-0.5', typeColors[notif.type])}>
                        {icons[notif.type]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{notif.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {timeAgo(notif.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
