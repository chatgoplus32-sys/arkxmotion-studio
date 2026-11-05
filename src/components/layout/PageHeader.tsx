import { HTMLAttributes, ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Sparkles } from 'lucide-react'

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
      <div
        ref={ref}
        className={cn(
          'relative mb-7 overflow-hidden rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-[#0B1526] via-[#0A1128] to-[#120A2A] p-5 sm:p-6 sm:flex sm:items-center sm:justify-between sm:gap-4',
          className,
        )}
        {...props}
      >
        {/* Dekorasi gradient blob */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#00A8FF]/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-32 w-32 rounded-full bg-[#8B5CF6]/10 blur-3xl" />

        <div className="relative min-w-0">
          {eyebrow && (
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-cyan-300/80">
              <Sparkles className="h-3 w-3" />
              {eyebrow}
            </div>
          )}
          <h1 className="font-display text-[24px] font-black italic leading-[1.1] tracking-tight md:text-[30px]">
            <span className="bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent">
              {title}
            </span>
            {highlight && (
              <span className="ml-2 bg-gradient-to-r from-[#00A8FF] to-[#8B5CF6] bg-clip-text text-transparent">
                {highlight}
              </span>
            )}
          </h1>
          {desc && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/55 md:text-sm">{desc}</p>}
        </div>

        {actions && <div className="relative mt-4 flex shrink-0 flex-wrap items-center gap-2 sm:mt-0">{actions}</div>}
      </div>
    )
  },
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
