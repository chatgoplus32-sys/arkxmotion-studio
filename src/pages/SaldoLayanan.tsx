import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { formatRp } from '@/lib/payment'
import { fetchNexabotWallet } from '@/lib/nexabotWallet'
import { fetchSeaviWallet } from '@/lib/seaviWallet'
import { fetchAlrizWallet } from '@/lib/alrizWallet'
import { cn } from '@/lib/utils'
import {
  ArrowUpRight, Bot, Clapperboard, Coins, Loader2, RefreshCw, Zap,
} from 'lucide-react'

type ServiceKey = 'createpulse' | 'nexabot' | 'seavi' | 'alriz'

interface ServiceDef {
  key: ServiceKey
  label: string
  desc: string
  href: string
  icon: ReactNode
  accent: string
}

// Empat saldo ini benar-benar terpisah di server. Jangan pernah menjumlahkannya
// jadi satu angka — nilai Rupiah dan token punya satuan berbeda.
const SERVICES: ServiceDef[] = [
  {
    key: 'createpulse',
    label: 'CreatePulse',
    desc: 'Video, image, dan model CreatePulse.',
    href: '/topup/createpulse',
    icon: <Zap className="h-4 w-4" />,
    accent: 'border-sky-500/25 bg-sky-500/10 text-sky-400',
  },
  {
    key: 'nexabot',
    label: 'NexaBot',
    desc: 'Generate video & audio NexaBot.',
    href: '/topup/nexabot',
    icon: <Bot className="h-4 w-4" />,
    accent: 'border-violet-500/25 bg-violet-500/10 text-violet-400',
  },
  {
    key: 'seavi',
    label: 'Seavi',
    desc: 'Token Seavi — dibeli per paket, dipotong per generate.',
    href: '/topup/seavi',
    icon: <Coins className="h-4 w-4" />,
    accent: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  },
  {
    key: 'alriz',
    label: 'Alriz Motion',
    desc: 'Motion Control Alriz — dipotong per video.',
    href: '/topup/alriz',
    icon: <Clapperboard className="h-4 w-4" />,
    accent: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
  },
]

interface ServiceState {
  amount: number | null
  /** Harga satuan dari server (NexaBot per generate, Seavi per token). */
  unitPrice: number | null
  /** Keterangan tambahan, mis. status Paket Unlimited. */
  note: string | null
}

const EMPTY_STATE: Record<ServiceKey, ServiceState> = {
  createpulse: { amount: null, unitPrice: null, note: null },
  nexabot: { amount: null, unitPrice: null, note: null },
  seavi: { amount: null, unitPrice: null, note: null },
  alriz: { amount: null, unitPrice: null, note: null },
}

async function fetchCreatePulseBalance(token: string): Promise<number | null> {
  try {
    const res = await fetch('/api/createpulse/balance', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.balance === 'number' ? data.balance : null
  } catch {
    return null
  }
}

function amountLabel(key: ServiceKey, state: ServiceState, loading: boolean): string {
  if (loading && state.amount === null) return '…'
  if (state.amount === null) return '—'
  if (key === 'seavi') return `${state.amount} token`
  return formatRp(state.amount)
}

export default function SaldoLayananPage() {
  const { token } = useAuthStore()
  const [services, setServices] = useState(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async (silent = false) => {
    if (!token) {
      setLoading(false)
      return
    }
    const requestId = ++requestRef.current
    if (silent) setRefreshing(true)
    else setLoading(true)

    const [createpulse, nexabot, seavi, alriz] = await Promise.all([
      fetchCreatePulseBalance(token),
      fetchNexabotWallet(token),
      fetchSeaviWallet(token),
      fetchAlrizWallet(token),
    ])
    if (requestId !== requestRef.current) return

    const unlimited = nexabot?.unlimited
    setServices({
      createpulse: { amount: createpulse, unitPrice: null, note: null },
      nexabot: {
        amount: nexabot?.balance ?? null,
        unitPrice: nexabot?.price ?? null,
        note: unlimited?.active
          ? `Paket Unlimited aktif${unlimited.days_left > 0 ? ` · ${unlimited.days_left} hari lagi` : ''}`
          : null,
      },
      seavi: {
        amount: seavi?.tokens ?? null,
        unitPrice: seavi?.token_price ?? 2000,
        note: null,
      },
      alriz: { amount: alriz?.balance ?? null, unitPrice: null, note: null },
    })
    setUpdatedAt(Date.now())
    setLoading(false)
    setRefreshing(false)
  }, [token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!token) return
    const timer = window.setInterval(() => {
      if (!document.hidden) load(true)
    }, 90000)
    const onVisible = () => {
      if (!document.hidden) load(true)
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, token])

  const anyKnown = SERVICES.some((s) => services[s.key].amount !== null)
  const allFailed = !loading && !anyKnown

  return (
    <PageContent>
      <PageHeader
        eyebrow="Akun"
        title="Saldo"
        highlight="Layanan"
        desc="Empat dompet terpisah — saldo tiap layanan tidak digabung."
      />

      <Section
        title="💳 Saldo Layanan"
        sub="Nilai diambil langsung dari server tiap layanan."
        right={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (loading || refreshing) && 'animate-spin')} />
            Muat ulang
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SERVICES.map((service) => {
            const state = services[service.key]
            const unknown = !loading && state.amount === null
            const sub = service.key === 'seavi' && state.amount !== null
              ? `≈ ${formatRp(state.amount * (state.unitPrice ?? 2000))} · ${formatRp(state.unitPrice ?? 2000)}/token`
              : service.key === 'nexabot' && state.unitPrice !== null
                ? `${formatRp(state.unitPrice)}/generate`
                : service.desc

            return (
              <div
                key={service.key}
                className="flex flex-col rounded-2xl border border-border bg-background/40 p-4 transition hover:border-border/80"
              >
                <div className="flex items-center gap-2">
                  <span className={cn('grid h-8 w-8 place-items-center rounded-lg border', service.accent)}>
                    {service.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{service.label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {service.key === 'seavi' ? 'Token' : 'Rupiah'}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  {loading && state.amount === null ? (
                    <div className="flex h-8 items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Memuat…</span>
                    </div>
                  ) : (
                    <div className={cn(
                      'font-mono text-xl font-bold tabular-nums',
                      unknown && 'text-muted-foreground',
                    )}>
                      {amountLabel(service.key, state, loading)}
                    </div>
                  )}
                  <p className={cn('mt-1 text-[11px]', unknown ? 'text-destructive' : 'text-muted-foreground')}>
                    {unknown ? 'Gagal memuat saldo layanan ini' : sub}
                  </p>
                  {state.note && !unknown && (
                    <p className="mt-1 inline-flex rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      {state.note}
                    </p>
                  )}
                </div>

                <Link
                  to={service.href}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-secondary/70 px-2 py-2 text-xs font-medium text-foreground transition hover:bg-secondary"
                >
                  Top Up
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )
          })}
        </div>

        <Link
          to="/topup/manual"
          className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-background/40 px-4 py-3 transition hover:border-primary/40 hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="text-sm font-semibold">Provider lain — Roboneo, Weavy, Framia, dll.</div>
            <p className="text-[11px] text-muted-foreground">
              Belum punya dompet otomatis: ajukan nominal, bayar DANA/QRIS, lalu diverifikasi admin.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
            Top Up Manual
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </Link>

        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saldo CreatePulse, NexaBot, dan Alriz dalam Rupiah; Seavi dalam token.
            Tiap layanan punya dompet sendiri, jadi saldo tidak bisa dipindah atau dijumlahkan.
          </p>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {allFailed
              ? 'Semua saldo gagal dimuat'
              : updatedAt
                ? `Diperbarui ${new Date(updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
          </span>
        </div>

        {allFailed && (
          <button
            type="button"
            onClick={() => load()}
            className="mt-2 text-[11px] text-destructive hover:underline"
          >
            Gagal memuat saldo — coba lagi
          </button>
        )}
      </Section>
    </PageContent>
  )
}
