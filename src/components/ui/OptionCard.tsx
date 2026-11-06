import { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OptionCardProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
  /** Ikon kanan, menimpa centang bawaan saat selected. */
  trailing?: ReactNode
}

/**
 * Kartu pilihan (radio-like) — dipakai untuk pilih jenis edit, sumber data,
 * kategori, dan pilihan serupa di halaman Tools.
 */
function OptionCard({
  title,
  description,
  icon,
  selected = false,
  disabled = false,
  onClick,
  className,
  trailing,
}: OptionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl border p-3 text-left transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'border-primary/50 bg-primary/5 shadow-[0_0_20px_rgba(0,168,255,0.12)]'
          : 'border-border hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/40 hover:shadow-[0_6px_18px_rgba(0,0,0,0.25)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {icon && (
            <span
              className={cn(
                'shrink-0 transition-colors',
                selected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className={cn('block text-sm font-medium', selected && 'text-primary')}>
              {title}
            </span>
            {description && (
              <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
            )}
          </span>
        </div>
        {trailing ?? (selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />)}
      </div>
    </button>
  )
}

export { OptionCard }
export type { OptionCardProps }
