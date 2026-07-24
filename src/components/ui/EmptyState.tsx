import { HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  description?: string
}

const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center justify-center py-12 text-center',
          className
        )}
        {...props}
      >
        {icon && <div className="mb-3 text-muted-foreground opacity-50">{icon}</div>}
        <h3 className="text-sm font-medium text-foreground/80">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">{description}</p>
        )}
      </div>
    )
  }
)

EmptyState.displayName = 'EmptyState'

interface LoadingSpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg'
}

const LoadingSpinner = forwardRef<HTMLDivElement, LoadingSpinnerProps>(
  ({ className, size = 'md', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-center', className)}
        {...props}
      >
        <Loader2
          className={cn('animate-spin text-muted-foreground', {
            'h-4 w-4': size === 'sm',
            'h-6 w-6': size === 'md',
            'h-8 w-8': size === 'lg',
          })}
        />
      </div>
    )
  }
)

LoadingSpinner.displayName = 'LoadingSpinner'

export { EmptyState, LoadingSpinner }
export type { EmptyStateProps, LoadingSpinnerProps }
