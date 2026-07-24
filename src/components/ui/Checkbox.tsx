import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    return (
      <label
        htmlFor={id}
        className="flex items-center gap-2.5 cursor-pointer select-none"
      >
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            'h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition',
            className
          )}
        >
          <Check className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" />
        </span>
        {label && <span className="text-sm text-foreground/90">{label}</span>}
      </label>
    )
  }
)

Checkbox.displayName = 'Checkbox'

export { Checkbox }
export type { CheckboxProps }
