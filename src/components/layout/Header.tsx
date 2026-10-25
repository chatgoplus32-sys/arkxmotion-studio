import { ReactNode } from 'react'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-4 lg:px-6">
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
        <ThemeToggle />
        <NotificationPanel />
        <div className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-secondary/25 p-0.5">
          <GenerationIndicator />
          <span className="mx-0.5 h-4 w-px bg-border/80" aria-hidden />
          <AccountStatus />
        </div>
      </div>
    </header>
  )
}
