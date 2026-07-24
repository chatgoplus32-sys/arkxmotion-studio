import { HTMLAttributes, ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string
  title: string
  highlight?: string
  desc?: string
}

const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, eyebrow, title, highlight, desc, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('mb-6', className)} {...props}>
        {eyebrow && (
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl md:text-3xl font-display font-bold">
          {title}
          {highlight && <span className="text-primary ml-2">{highlight}</span>}
        </h1>
        {desc && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{desc}</p>}
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
        className={cn('space-y-5', className)}
        {...props}
      />
    )
  }
)

PageContent.displayName = 'PageContent'

export { PageHeader, PageContent }
export type { PageHeaderProps, PageContentProps }
