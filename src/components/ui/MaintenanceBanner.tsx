import { Wrench, AlertTriangle } from 'lucide-react'
import { useProviderManager } from '@/stores/providerManager'

interface MaintenanceBannerProps {
  providerId?: string
  compact?: boolean
}

export function MaintenanceBanner({ providerId, compact = false }: MaintenanceBannerProps) {
  const { isProviderMaintenance, getMaintenanceMessage } = useProviderManager()

  const isMaint = providerId ? isProviderMaintenance(providerId as any) : false
  const message = providerId ? getMaintenanceMessage(providerId as any) : ''

  if (!isMaint) return null

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs text-orange-300">
        <Wrench className="h-3 w-3" />
        <span>Maintenance</span>
      </div>
    )
  }

  return (
    <div className="p-3 rounded-xl border border-orange-500/50 bg-orange-500/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
        <div className="text-sm text-orange-200/80 leading-relaxed">
          <strong>Provider sedang dalam maintenance</strong>
          {message && <span className="block mt-1">{message}</span>}
        </div>
      </div>
    </div>
  )
}
