import { ReactNode, useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { useTokenSyncStore } from '@/stores/tokenSyncStore'
import { sendNotification } from '@/lib/notify'
import {
  LayoutDashboard,
  Video,
  Image,
  Settings,
  Zap,
  Sparkles,
  LogOut,
  Shield,
  Key,
  ClipboardCheck,
  Activity,
  Lock,
  Wallet,
  Wand2,
  BarChart3,
  Coins,
  SlidersHorizontal,
  Bell,
  ImagePlus,
  ExternalLink,
  Globe,
  ShoppingCart,
  Puzzle,
  Mic,
  Eraser,
  ArrowUpFromLine,
  Music,
  Volume2,
  Shirt,
  Crown,
  X,
  ArrowRight,
  Disc3,
  AudioLines,
  Gem,
  FileCog,
  Images,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
  badge?: string
  comingSoon?: boolean
  pro?: boolean
}

const mainNav: NavItem[] = [
  { label: 'Mulai', href: '/quick-start', icon: <Sparkles className="h-4 w-4" /> },
  { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'Hasil', href: '/hasil', icon: <Images className="h-4 w-4" /> },
]

const createNav: NavItem[] = [
  { label: 'Motion Control', href: '/generate/motion', icon: <Video className="h-4 w-4" /> },
  { label: 'Image to Video', href: '/generate/image-to-video', icon: <Image className="h-4 w-4" /> },
  { label: 'Edit Image', href: '/generate/edit-image', icon: <ImagePlus className="h-4 w-4" /> },
  { label: 'Virtual Try-On', href: '/generate/virtual-tryon', icon: <Shirt className="h-4 w-4" /> },
  { label: 'Travel Photo', href: '/generate/travel-photo', icon: <Globe className="h-4 w-4" /> },
  { label: 'Talking Photo', href: '/generate/talking-photo', icon: <Mic className="h-4 w-4" /> },
]

const audioNav: NavItem[] = [
  { label: 'AI Song Cover', href: '/generate/song-cover', icon: <Disc3 className="h-4 w-4" />, pro: true },
  { label: 'H3 Music Avatar', href: '/generate/h3-music-avatar', icon: <AudioLines className="h-4 w-4" />, pro: true },
  { label: 'Voice Over', href: '/generate/voice-over', icon: <Volume2 className="h-4 w-4" /> },
  { label: 'Music Generator', href: '/generate/music-generator', icon: <Music className="h-4 w-4" /> },
]

const enhanceNav: NavItem[] = [
  { label: 'Watermark Remover', href: '/generate/watermark-remover', icon: <Eraser className="h-4 w-4" /> },
  { label: 'Video Upscaler', href: '/generate/video-upscaler', icon: <ArrowUpFromLine className="h-4 w-4" /> },
  { label: 'AI Upscaler', href: '/generate/upscaler', icon: <Wand2 className="h-4 w-4" /> },
  { label: 'Gemini Tools', href: '/tools/gemini-tools', icon: <Gem className="h-4 w-4" />, pro: true },
  { label: 'Metadata Cleaner', href: '/tools/metadata-cleaner', icon: <FileCog className="h-4 w-4" /> },
]

// Top up per layanan diakses dari panel saldo di header, halaman Saldo
// Layanan, dan halaman Beli Token.
const toolsNavBase: NavItem[] = [
  { label: 'Providers', href: '/providers', icon: <Zap className="h-4 w-4" /> },
  { label: 'Saldo Layanan', href: '/saldo', icon: <Wallet className="h-4 w-4" /> },
  // Token Bank belum dipakai: top up per layanan sudah punya halaman sendiri.
  // Menu dikunci dulu supaya member tidak masuk ke alur yang belum aktif.
  { label: 'Beli Token', href: '/beli-token', icon: <ShoppingCart className="h-4 w-4" />, comingSoon: true },
  { label: 'Settings', href: '/settings', icon: <Settings className="h-4 w-4" /> },
  { label: 'Plugins', href: '/plugins', icon: <Puzzle className="h-4 w-4" /> },
]

interface SidebarProps {
  collapsed?: boolean
  onClose?: () => void
}

export function Sidebar({ collapsed = false, onClose }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, token, logout } = useAuthStore()
  const addToast = useToastStore((state) => state.addToast)
  const syncUnread = useTokenSyncStore((s) => s.unread)
  const [pendingCount, setPendingCount] = useState(0)
  const prevPendingRef = useRef<number | null>(null)
  const lastNotifiedRef = useRef(0)

  const isPro = user?.role === 'admin' || user?.plan === 'pro'

  const toolsNav = toolsNavBase.map((item) => {
    // Badge unread auto-sync token (Providers) — realtime, hilang saat dibuka
    if (item.href === '/providers' && syncUnread > 0) {
      return { ...item, badge: syncUnread > 99 ? '99+' : String(syncUnread) }
    }
    return item
  })

  const handleLogout = () => {
    logout()
    navigate('/', { replace: true })
    setTimeout(() => { if (window.location.pathname !== '/') window.location.replace('/') }, 100)
  }

  useEffect(() => {
    if (user?.role !== 'admin' || !token) return

    const fetchPending = () => {
      fetch('/api/admin/users/pending', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then(data => {
          const count = data.users?.length || 0
          const prev = prevPendingRef.current
          prevPendingRef.current = count
          setPendingCount(count)

          // Pendaftaran baru terdeteksi → toast + notifikasi browser (maks 1×/60 detik)
          const now = Date.now()
          if (prev !== null && count > prev && now - lastNotifiedRef.current > 60000) {
            lastNotifiedRef.current = now
            const n = count - prev
            addToast(`👤 ${n} pendaftaran baru menunggu persetujuan (${count} pending)`, 'warning')
            sendNotification('👤 Pendaftaran Member Baru', {
              body: `${n} pendaftaran baru menunggu persetujuan admin. Total ${count} pending.`,
            })
          }
        })
        .catch((e) => { if (import.meta.env.DEV) console.warn('[sidebar] fetchPending failed:', e) })
    }

    fetchPending()
    const interval = setInterval(fetchPending, 30000)
    return () => clearInterval(interval)
  }, [user, token, addToast])

  const adminNav: NavItem[] = [
    { label: 'User Management', href: '/admin/users', icon: <Shield className="h-4 w-4" />, badge: pendingCount > 0 ? String(pendingCount) : undefined },
    { label: 'Membership', href: '/admin/membership', icon: <Wallet className="h-4 w-4" /> },
    { label: 'Upload Token', href: '/admin/tokens', icon: <Key className="h-4 w-4" /> },
    { label: 'Order Token', href: '/admin/orders', icon: <ClipboardCheck className="h-4 w-4" /> },
    { label: 'Approval TopUp', href: '/admin/topup', icon: <Wallet className="h-4 w-4" /> },
    { label: 'Usage Analytics', href: '/admin/analytics', icon: <BarChart3 className="h-4 w-4" /> },
    { label: 'Activity Feed', href: '/admin/activity', icon: <Activity className="h-4 w-4" /> },
    { label: 'Credit Management', href: '/admin/credits', icon: <Coins className="h-4 w-4" /> },
    { label: 'System Settings', href: '/admin/settings', icon: <SlidersHorizontal className="h-4 w-4" /> },
    { label: 'System Health', href: '/admin/health', icon: <Activity className="h-4 w-4" /> },
    { label: 'Notifications', href: '/admin/notifications', icon: <Bell className="h-4 w-4" /> },
  ]

  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(href + '/')

  const renderNavGroup = (items: NavItem[], label?: string) => (
    <div className="space-y-0.5">
      {label && !collapsed && (
        <div className="flex items-center gap-2 px-3 pb-1.5 pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">{label}</span>
          <span className="h-px flex-1 bg-border/50" aria-hidden />
        </div>
      )}
      {items.map((item) => (
        item.comingSoon ? (
          <div
            key={item.href}
            className={cn(
              'flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] opacity-50',
              'text-muted-foreground'
            )}
            title={collapsed ? `${item.label} (Coming Soon)` : `${item.label} - Coming Soon`}
          >
            {item.icon}
            {!collapsed && <span className="line-through">{item.label}</span>}
            {!collapsed && (
              <span className="ml-auto flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Lock className="h-2.5 w-2.5" /> Soon
              </span>
            )}
          </div>
        ) : item.href.startsWith('http') ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-accent/60',
              'text-muted-foreground hover:text-foreground'
            )}
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
            {!collapsed && (
              <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-50" />
            )}
          </a>
        ) : (
          <Link
            key={item.href}
            to={item.href}
            onClick={onClose}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors',
              isActive(item.href)
                ? 'bg-primary/[0.08] font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
            title={collapsed ? `${item.label}${item.pro && !isPro ? ' (Pro)' : ''}` : undefined}
          >
            {isActive(item.href) && (
              <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />
            )}
            <span className="relative shrink-0">
              {item.icon}
              {collapsed && item.pro && !isPro && (
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
              )}
            </span>
            {!collapsed && <span>{item.label}</span>}
            {item.pro && !isPro && !collapsed && (
              <span className="ml-auto rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold tracking-wide text-amber-400/90">
                PRO
              </span>
            )}
            {item.badge && !collapsed && (
              <span className="ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                {item.badge}
              </span>
            )}
          </Link>
        )
      ))}
    </div>
  )

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-card h-screen sticky top-0 transition-all',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 h-14 px-4 border-b border-border">
        {collapsed ? (
          <img src="/arkx-dashboard-icon.svg" alt="ARKXMotion" className="w-8 h-8" />
        ) : (
          <img src="/arkx-sidebar-logo.svg" alt="ARKXMotion Studio" className="sidebar-brand-logo h-10 min-w-0" />
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
            title="Tutup menu"
            aria-label="Tutup menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {renderNavGroup(mainNav)}
        {renderNavGroup(createNav, 'Buat')}
        {renderNavGroup(audioNav, 'Audio')}
        {renderNavGroup(enhanceNav, 'Sempurnakan')}
        {renderNavGroup(toolsNav, 'Lainnya')}
        {user?.role === 'admin' && renderNavGroup(adminNav, 'Admin')}
      </nav>

      <div className="border-t border-border">
        {!isPro && (
          <div className="p-3 pb-0">
            <Link
              to="/upgrade-pro"
              onClick={onClose}
              title={collapsed ? 'Upgrade Pro' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2.5 text-foreground transition-colors hover:border-primary/25 hover:bg-secondary/60',
                collapsed && 'justify-center px-2'
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Crown className="h-3.5 w-3.5" />
              </span>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-tight">Upgrade Pro</div>
                    <div className="text-[11px] leading-tight text-muted-foreground">Buka 3 fitur premium</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
            </Link>
          </div>
        )}
        <div className="p-3">
          <div className={cn(
            'flex items-center gap-2 rounded-xl bg-secondary/50 p-2.5',
            collapsed && 'justify-center'
          )}>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center text-xs font-bold text-black">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user?.name || 'User'}</div>
                <div className="text-[12px] brand-text flex items-center gap-1">
                  {user?.role === 'admin' ? 'Admin' : user?.plan === 'pro' ? (<><Crown className="h-3 w-3" /> Pro</>) : 'Free Plan'}
                </div>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
