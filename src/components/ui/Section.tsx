import { HTMLAttributes, ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  sub?: string
  right?: ReactNode
  /** Ikon lucide di depan judul — pakai ini, bukan emoji, agar konsisten. */
  icon?: ReactNode
  /** Delay entrance dalam ms (stagger antar section). */
  delay?: number
}

const Section = forwardRef<HTMLDivElement, SectionProps>(
  ({ className, title, sub, right, icon, delay, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'animate-fade-in rounded-2xl border border-border bg-card/50 p-5',
          className
        )}
        style={delay ? { animationDelay: `${delay}ms`, animationFillMode: 'both' } : undefined}
        {...props}
      >
        {(title || sub || right || icon) && (
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              {(title || icon) && (
                <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                  {icon && <span className="text-primary">{icon}</span>}
                  {title}
                </h3>
              )}
              {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
          </div>
        )}
        {children}
      </div>
    )
  }
)

Section.displayName = 'Section'

export { Section }
export type { SectionProps }
