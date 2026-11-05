import { ReactNode } from 'react'
import { PanelLeftClose, PanelLeft, Search } from 'lucide-react'
import { Button } from '@/components/ui'
import { NotificationPanel } from '@/components/ui/NotificationPanel'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { GenerationIndicator } from './GenerationIndicator'
import { AccountStatus } from './AccountStatus'

interface HeaderProps {
  title?: string
  subtitle?: string
  actions?: ReactNode
  collapsed?: boolean
  onToggleSidebar?: () => void
}

export function Header({ title, subtitle, actions, collapsed, onToggleSidebar }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full w-full max-w-[1520px] items-center gap-2 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          onClick={onToggleSidebar}
          aria-label={collapsed ? 'Buka menu' : 'Tutup menu'}
        >
          {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </Button>

        {title && (
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{title}</h1>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        )}

        {!title && <div className="flex-1" />}

        <div className="flex items-center gap-1.5 sm:gap-2">
          {actions}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('arkx:open-palette'))}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/40 transition hover:border-cyan-400/30 hover:text-cyan-300"
            aria-label="Buka command palette (Ctrl K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Cari tools…</span>
            <kbd className="hidden rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] md:inline">⌘K</kbd>
          </button>
          <ThemeToggle />
          <NotificationPanel />
          <div className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-secondary/25 p-0.5">
            <GenerationIndicator />
            <span className="mx-0.5 h-4 w-px bg-border/80" aria-hidden />
            <AccountStatus />
          </div>
        </div>
      </div>
    </header>
  )
}
