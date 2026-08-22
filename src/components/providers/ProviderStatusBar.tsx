import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { HEALTH_PROVIDERS, checkAllProviderHealth, ProviderHealth } from '@/lib/providerHealth'

const PROVIDER_COLORS: Record<string, string> = {
  brain: '#f472b6', weavy: '#22d3ee', wavespeed: '#38bdf8',
  roboneo: '#34d399', runninghub: '#f97316', framia: '#fb923c',
  galleri5: '#e879f9', leonardo: '#facc15', createpulse: '#c084fc',
  oneover: '#a78bfa', firefly: '#FF6A00',
}

interface Props {
  selectedProvider: string
  onSelect: (provider: string) => void
}

export default function ProviderStatusBar({ selectedProvider, onSelect }: Props) {
  const { keys, isProviderMaintenance } = useProviderManager()
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const h = await checkAllProviderHealth()
      setHealth(h)
    } catch { /* silent */ }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 120000)
    return () => clearInterval(interval)
  }, [])

  // Compute status from keys + health
  const providerStatuses = HEALTH_PROVIDERS.map(provider => {
    const h = health[provider]
    const k = keys[provider as ProviderId] || []
    const activeKeys = k.filter(k => k.status === 'active' || k.status === 'unknown').length
    const totalCredits = k.reduce((sum, k) => sum + (k.balance || 0), 0)
    const isMaint = isProviderMaintenance(provider as ProviderId)
    const color = PROVIDER_COLORS[provider] || '#94a3b8'

    let status: 'online' | 'busy' | 'down' | 'maintenance' | 'nokey' = 'nokey'
    if (isMaint) status = 'maintenance'
    else if (h?.status === 'online') status = 'online'
    else if (h?.status === 'busy') status = 'busy'
    else if (h?.status === 'down') status = 'down'
    else if (k.length > 0) status = 'online' // has keys, assume ok

    return { provider, status, color, activeKeys, totalKeys: k.length, totalCredits, latencyMs: h?.latencyMs }
  })

  const online = providerStatuses.filter(p => p.status === 'online').length
  const busy = providerStatuses.filter(p => p.status === 'busy').length
  const down = providerStatuses.filter(p => p.status === 'down' || p.status === 'maintenance').length

  return (
    <div className="mb-4 p-3 rounded-xl border border-border/50 bg-card/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Provider Status</span>
          <button onClick={refresh} className="p-1 rounded-md hover:bg-accent transition" title="Refresh status">
            <RefreshCw className={`h-3 w-3 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /><span className="text-[10px] text-muted-foreground">{online}</span></div>
          <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="text-[10px] text-muted-foreground">{busy}</span></div>
          <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /><span className="text-[10px] text-muted-foreground">{down}</span></div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {providerStatuses.map(({ provider, status, color, activeKeys, totalKeys, totalCredits, latencyMs }) => {
          const isActive = selectedProvider === provider
          const dotColor = status === 'maintenance' ? 'bg-orange-400'
            : status === 'online' ? 'bg-emerald-400'
            : status === 'busy' ? 'bg-amber-400'
            : status === 'down' ? 'bg-red-400'
            : totalKeys > 0 ? 'bg-gray-400' : 'bg-gray-600'
          return (
            <button
              key={provider}
              onClick={() => onSelect(provider)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition border ${isActive ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/50 hover:bg-accent/50 text-muted-foreground hover:text-foreground'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} style={{ boxShadow: `0 0 4px ${color}66` }} />
              <span className="capitalize truncate">{provider}</span>
              {latencyMs != null && <span className="text-[9px] opacity-60">{latencyMs}ms</span>}
              {totalKeys > 0 && <span className="text-[9px] opacity-50">{activeKeys}/{totalKeys}</span>}
              {totalCredits > 0 && <span className="text-[9px] text-emerald-400/70">{totalCredits}cr</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
