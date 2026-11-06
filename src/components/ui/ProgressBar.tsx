import { cn } from '@/lib/utils'

interface ProgressBarProps {
  /** 0–100. Nilai null/undefined menampilkan mode indeterminate. */
  value?: number | null
  label?: string
  hint?: string
  className?: string
}

/**
 * Progress bar seragam untuk proses generate/bersih-bersih.
 * Tanpa `value` bar berjalan (indeterminate) dengan shimmer.
 */
function ProgressBar({ value, label, hint, className }: ProgressBarProps) {
  const indeterminate = value === null || value === undefined
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value))

  return (
    <div className={cn('w-full', className)}>
      {(label || hint || !indeterminate) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-medium text-muted-foreground">{label}</span>
          {!indeterminate && <span className="font-mono text-primary">{pct}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {indeterminate ? (
          <div className="h-full w-1/3 animate-generation-sweep rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary shadow-[0_0_10px_rgba(0,168,255,0.5)] transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export { ProgressBar }
export type { ProgressBarProps }
