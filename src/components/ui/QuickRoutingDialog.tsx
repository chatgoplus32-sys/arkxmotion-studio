import { useState, useEffect } from 'react'
import { Check, Repeat, X } from 'lucide-react'

const ROUTING_KEY = 'arkxmotion.routing'

function getRouting(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ROUTING_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function setRoutingValue(cap: string, providerId: string) {
  const routing = getRouting()
  routing[cap] = providerId
  localStorage.setItem(ROUTING_KEY, JSON.stringify(routing))
  window.dispatchEvent(new Event('aatools:routing-changed'))
}

function getActiveProviderForCap(cap: string): string {
  const routing = getRouting()
  return routing[cap] || 'weavy'
}

interface ProviderOption {
  id: string
  name: string
  models: Array<{ key: string; label: string; cr: number }>
}

interface QuickRoutingDialogProps {
  cap: string
  providers: ProviderOption[]
  onClose: () => void
  onSelect?: (providerId: string) => void
}

export function QuickRoutingDialog({ cap, providers, onClose, onSelect }: QuickRoutingDialogProps) {
  const [active, setActive] = useState(() => getActiveProviderForCap(cap))

  useEffect(() => {
    const handler = () => {
      const current = getActiveProviderForCap(cap)
      setActive(current)
    }
    window.addEventListener('aatools:routing-changed', handler)
    return () => window.removeEventListener('aatools:routing-changed', handler)
  }, [cap])

  const handleSelect = (providerId: string) => {
    setActive(providerId)
    setRoutingValue(cap, providerId)
    onSelect?.(providerId)
  }

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border/60 bg-card/95 backdrop-blur p-4">
          <div className="h-10 w-10 rounded-xl grid place-items-center text-primary-foreground shrink-0" style={{ background: 'var(--gradient-neon)' }}>
            <Repeat className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Routing Provider</div>
            <div className="font-display text-lg text-foreground">Motion Control</div>
            <div className="text-xs text-muted-foreground mt-0.5">Pilih provider untuk generate motion control</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full border border-border hover:bg-sidebar-accent/30" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2.5">
          {providers.map((provider) => {
            const isActive = active === provider.id
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => handleSelect(provider.id)}
                className={`text-left rounded-xl border p-3 transition ${
                  isActive
                    ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                    : 'border-border bg-card/40 hover:border-primary/50 hover:bg-card/70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="font-display text-sm text-foreground flex-1 truncate">{provider.name}</div>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-primary">
                      <Check className="h-3 w-3" /> aktif
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-0.5">
                  {provider.models.slice(0, 4).map((model) => (
                    <div key={model.key} className="flex items-start gap-2 text-[11px]">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      <span className="text-foreground/80 flex-1 truncate">{model.label}</span>
                      <span className="font-mono text-emerald-300/90 text-[10px] whitespace-nowrap">
                        ~{model.cr} cr
                      </span>
                    </div>
                  ))}
                  {provider.models.length > 4 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">+{provider.models.length - 4} model lainnya</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="sticky bottom-0 border-t border-border/60 bg-card/95 backdrop-blur p-3 flex items-center justify-end">
          <button onClick={onClose} className="rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground" style={{ background: 'var(--gradient-neon)' }}>
            Selesai
          </button>
        </div>
      </div>
    </div>
  )
}

export { getActiveProviderForCap, setRoutingValue }
