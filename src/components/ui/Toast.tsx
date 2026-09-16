import { useEffect, useRef, useState } from 'react'
import { useToastStore } from '@/stores/toastStore'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const icons = {
  success: <CheckCircle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
}

const styles = {
  success: 'bg-green-500/10 border-green-500/30 text-green-500',
  error: 'bg-destructive/10 border-destructive/30 text-destructive',
  info: 'bg-primary/10 border-primary/30 text-primary',
  warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500',
}

function ToastItem({ toast, onRemove }: { toast: { id: string; type: keyof typeof icons; message: string }; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onRemove(toast.id), 300)
    }, 5000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, onRemove])

  const handleRemove = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExiting(true)
    setTimeout(() => onRemove(toast.id), 300)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm duration-300',
        exiting ? 'animate-slide-out opacity-0' : 'animate-in slide-in-from-right-full',
        styles[toast.type]
      )}
    >
      {icons[toast.type]}
      <span className="text-sm font-medium flex-1">{toast.message}</span>
      <button
        onClick={handleRemove}
        className="p-0.5 rounded hover:bg-white/10 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  )
}
