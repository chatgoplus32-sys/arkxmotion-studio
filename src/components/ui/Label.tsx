import { LabelHTMLAttributes, forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  hint?: ReactNode
}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, hint, children, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        <label
          ref={ref}
          className={cn(
            'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
            className
          )}
          {...props}
        >
          {children}
        </label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    )
  }
)

Label.displayName = 'Label'

export { Label }
export type { LabelProps }
