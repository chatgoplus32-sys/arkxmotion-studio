import { HTMLAttributes, ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  sub?: string
  right?: ReactNode
}

const Section = forwardRef<HTMLDivElement, SectionProps>(
  ({ className, title, sub, right, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('rounded-2xl border border-border bg-card/50 p-5', className)}
        {...props}
      >
        {(title || right) && (
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              {title && <h3 className="font-display text-base font-semibold">{title}</h3>}
              {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
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
