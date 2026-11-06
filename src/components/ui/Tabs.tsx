import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TabItem<T extends string = string> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
}

/**
 * Pill tabs — satu sumber gaya untuk pemilih mode/kerja di halaman Tools.
 * Active state pakai glow halus supaya terlihat "hidup" tanpa mengganggu.
 */
function Tabs<T extends string>({ items, value, onChange, className, ariaLabel }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium',
              'transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active
                ? 'border-primary/40 bg-primary/10 text-primary shadow-[0_0_18px_rgba(0,168,255,0.18)]'
                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export { Tabs }
export type { TabsProps, TabItem }
