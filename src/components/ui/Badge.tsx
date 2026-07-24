import { HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
          {
            'bg-primary/10 text-primary': variant === 'default',
            'bg-secondary text-secondary-foreground': variant === 'secondary',
            'border border-border': variant === 'outline',
            'bg-destructive/10 text-destructive': variant === 'destructive',
            'bg-emerald-500/10 text-emerald-600': variant === 'success',
            'bg-amber-500/10 text-amber-600': variant === 'warning',
          },
          className
        )}
        {...props}
      />
    )
  }
)

Badge.displayName = 'Badge'

export { Badge }
export type { BadgeProps }
