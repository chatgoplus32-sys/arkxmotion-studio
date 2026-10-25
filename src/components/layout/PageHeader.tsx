import { HTMLAttributes, ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string
  title: string
  highlight?: string
  desc?: string
  actions?: ReactNode
}

const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, eyebrow, title, highlight, desc, actions, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)} {...props}>
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-[26px] font-bold leading-[1.15] tracking-tight md:text-[32px]">
            {title}
            {highlight && <span className="ml-2 text-primary">{highlight}</span>}
          </h1>
          {desc && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground md:text-sm">{desc}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )
  }
)

PageHeader.displayName = 'PageHeader'

interface PageContentProps extends HTMLAttributes<HTMLDivElement> {}

const PageContent = forwardRef<HTMLDivElement, PageContentProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('space-y-6', className)}
        {...props}
      />
    )
  }
)

PageContent.displayName = 'PageContent'

export { PageHeader, PageContent }
export type { PageHeaderProps, PageContentProps }
