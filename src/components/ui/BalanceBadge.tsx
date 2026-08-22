import { useState, useEffect } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useProviderManager } from '@/stores/providerManager'
import { refreshProviderBalance } from '@/lib/balancePrecheck'

// Provider yang punya saldo credits tersimpan (bisa ditampilkan di badge)
const BALANCE_PROVIDERS = new Set(['roboneo', 'weavy', 'galleri5', 'firefly'])

function readBalance(provider: string): { balance: number | null; keyCount: number } {
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return { balance: null, keyCount: 0 }
    const parsed = JSON.parse(raw)
    const keys =
      (Array.isArray(parsed?.[provider]) ? parsed[provider] : parsed?.state?.keys?.[provider]) || []
    const valid = keys.filter(
      (k: any) => k && k.status !== 'invalid' && k.status !== 'expired' && k.status !== 'empty'
    )
    let best: number | null = null
    for (const k of valid) {
      if (typeof k.balance === 'number' && (best === null || k.balance > best)) best = k.balance
    }
    return { balance: best, keyCount: valid.length }
  } catch {
    return { balance: null, keyCount: 0 }
  }
}

/**
 * Badge saldo provider (credits) — baca dari localStorage arkxmotion.providers.
 * Klik untuk refresh saldo langsung dari API provider (meng-update localStorage).
 * Props `required` (estimasi biaya) membuat badge menyala hijau/merah:
 * cukup vs kurang. Tidak render apa pun untuk provider tanpa balance.
 */
export function BalanceBadge({ provider, required }: { provider: string; required?: number }) {
  const store = useProviderManager()
  const [info, setInfo] = useState(() => readBalance(provider))
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => {
      setInfo(readBalance(provider))
      setRefreshError(null)
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('aatools:keys-changed', sync)
    window.addEventListener('aatools:routing-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('aatools:keys-changed', sync)
      window.removeEventListener('aatools:routing-changed', sync)
    }
  }, [provider, store])

  if (!BALANCE_PROVIDERS.has(provider)) return null
  if (info.balance === null || info.balance === undefined) return null

  const enough = required === undefined || info.balance >= required
  const remaining = required !== undefined ? info.balance - required : info.balance

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const res = await refreshProviderBalance(provider)
      if (res.ok) {
        setInfo((prev) => ({ ...prev, balance: res.balance ?? prev.balance }))
      } else {
        setRefreshError(res.error || 'Gagal refresh saldo')
      }
    } catch (err: any) {
      setRefreshError(err.message || 'Gagal refresh saldo')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      title={
        refreshError
          ? refreshError
          : `Saldo ${provider} — klik untuk refresh dari API${required !== undefined ? ` · estimasi biaya ${required} cr` : ''}`
      }
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition hover:brightness-125 active:scale-95 disabled:opacity-70 ${
        enough
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/70'
          : 'border-red-500/40 bg-red-500/10 text-red-400 hover:border-red-500/70'
      } ${refreshing ? 'cursor-wait' : 'cursor-pointer'}`}
    >
      {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      {refreshError ? '! gagal' : `${info.balance} cr`}
      {!refreshError && required !== undefined && (
        <span className={enough ? 'text-emerald-500/80' : 'text-red-500/80'}>
          {enough ? `→ sisa ${remaining}` : `(kurang ${-remaining})`}
        </span>
      )}
    </button>
  )
}
