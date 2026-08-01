import { ReactNode, useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
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
  PlayCircle,
  Mic,
  ShoppingCart,
  Route,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
  badge?: string
  comingSoon?: boolean
}

const mainNav: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'Command Center', href: '/command', icon: <Sparkles className="h-4 w-4" /> },
]

const generateNav: NavItem[] = [
  { label: 'Motion Control', href: '/generate/motion', icon: <Video className="h-4 w-4" /> },
  { label: 'Image to Video', href: '/generate/image-to-video', icon: <Image className="h-4 w-4" /> },
]

const toolsNavBase: NavItem[] = [
  { label: 'Providers', href: '/providers', icon: <Zap className="h-4 w-4" /> },
  { label: 'Routing Provider', href: '/manage/routing', icon: <Route className="h-4 w-4" /> },
  { label: 'Dubbing', href: '/mixing/dubbing', icon: <Mic className="h-4 w-4" /> },
  { label: 'Top Up CreatePulse', href: '/topup/createpulse', icon: <Wallet className="h-4 w-4" /> },
  { label: 'Settings', href: '/settings', icon: <Settings className="h-4 w-4" /> },
  { label: 'Beli Token', href: '/beli-token', icon: <ShoppingCart className="h-4 w-4" /> },
]

interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, token, logout } = useAuthStore()
  const [pendingCount, setPendingCount] = useState(0)

  const toolsNav = toolsNavBase.filter((item) => {
    if (item.href === '/topup/createpulse' && user?.role === 'admin') return false
    return true
  })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  useEffect(() => {
    if (user?.role === 'admin' && token) {
      fetch('/api/admin/users/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => setPendingCount(data.users?.length || 0))
        .catch(() => {})
    }
  }, [user, token])

  const adminNav: NavItem[] = [
    { label: 'User Management', href: '/admin/users', icon: <Shield className="h-4 w-4" />, badge: pendingCount > 0 ? String(pendingCount) : undefined },
    { label: 'Upload Token', href: '/admin/tokens', icon: <Key className="h-4 w-4" /> },
    { label: 'Order Token', href: '/admin/orders', icon: <ClipboardCheck className="h-4 w-4" /> },
    { label: 'Approval TopUp', href: '/admin/topup', icon: <Wallet className="h-4 w-4" /> },
    { label: 'Server Status', href: '/admin/status', icon: <Activity className="h-4 w-4" /> },
  ]

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/'
    return location.pathname.startsWith(href)
  }

  const renderNavGroup = (items: NavItem[], label?: string) => (
    <div className="space-y-1">
      {label && !collapsed && (
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      {items.map((item) => (
        item.comingSoon ? (
          <div
            key={item.href}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all cursor-not-allowed opacity-50',
              'text-muted-foreground'
            )}
            title={collapsed ? `${item.label} (Coming Soon)` : `${item.label} - Coming Soon`}
          >
            {item.icon}
            {!collapsed && <span className="line-through">{item.label}</span>}
            {!collapsed && (
              <span className="ml-auto text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" /> Soon
              </span>
            )}
          </div>
        ) : (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all hover:bg-accent',
              isActive(item.href)
                ? 'bg-primary/10 text-primary font-medium glow-gold'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
            {item.badge && !collapsed && (
              <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded-full font-medium">
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
        <div className="h-10 w-10 rounded-lg overflow-hidden flex items-center justify-center">
          <img src="/favicon.svg" alt="ARKXMotion" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <div className="font-display text-sm font-bold tracking-tight">
              <span className="silver-text">ARK</span>
              <span className="gold-text">X</span>
              <span className="silver-text">Motion</span>
            </div>
            <div className="text-[10px] gold-text font-semibold tracking-[0.3em]">STUDIO</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {renderNavGroup(mainNav)}
        {renderNavGroup(generateNav, 'Generate')}
        {renderNavGroup(toolsNav, 'Tools')}
        {user?.role === 'admin' && renderNavGroup(adminNav, 'Admin')}
      </nav>

      <div className="p-3 border-t border-border">
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
              <div className="text-[10px] gold-text">{user?.role === 'admin' ? 'Admin' : 'Free Plan'}</div>
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
    </aside>
  )
}
