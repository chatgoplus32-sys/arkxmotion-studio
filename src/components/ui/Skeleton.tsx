import { HTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('animate-pulse rounded-xl bg-muted', className)}
        {...props}
      />
    )
  }
)

Skeleton.displayName = 'Skeleton'

function SkeletonCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl bg-card border border-border p-5 space-y-3', className)} {...props}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-32 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  )
}

function SkeletonList({ count = 3, className, ...props }: HTMLAttributes<HTMLDivElement> & { count?: number }) {
  return (
    <div className={cn('space-y-3', className)} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonList }
