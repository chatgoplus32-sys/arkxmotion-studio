import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { formatRp } from '@/lib/payment'
import { fetchNexabotWallet, nexabotRemainingLabel, type NexabotUnlimited } from '@/lib/nexabotWallet'
import { fetchSeaviWallet } from '@/lib/seaviWallet'
import { fetchPosbotWallet } from '@/lib/posbotWallet'
import { cn } from '@/lib/utils'
import {
  ArrowUpRight, Bot, Coins, Loader2, RefreshCw, Wallet, Zap,
} from 'lucide-react'

type ServiceKey = 'createpulse' | 'nexabot' | 'seavi' | 'posbot'

interface ServiceDef {
  key: ServiceKey
  label: string
  desc: string
  href: string
  icon: ReactNode
  accent: string
}

// Saldo ini benar-benar terpisah di server. Jangan pernah menjumlahkannya
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
    key: 'posbot',
    label: 'PosBot',
    desc: 'Saldo Rupiah PosBot — dipotong per generate sesuai tarif model.',
    href: '/topup/posbot',
    icon: <Wallet className="h-4 w-4" />,
    accent: 'border-teal-500/25 bg-teal-500/10 text-teal-400',
  },
]

type Satuan = 'Rp' | 'token' | 'kredit'

interface ServiceState {
  amount: number | null
  /** Satuan angka di kartu. PosBot & CreatePulse Rupiah, Seavi token, NexaBot kredit. */
  unit: Satuan
  /** Harga satuan dari server (NexaBot per generate, Seavi per token). */
  unitPrice: number | null
  /** Keterangan tambahan, mis. status Paket Unlimited. */
  note: string | null
  /** Baris harga langganan (NexaBot), mis. "Unlimited Mingguan Rp 30.000/7 hari". */
  subExtra?: string | null
  /** true = angka berasal dari penyedia, bukan dompet internal kita. */
  provider?: boolean
  /** Baris penjelas sumber angka. */
  detail?: string | null
  /** Angka tidak tersedia, dengan alasan yang ditampilkan netral (bukan error). */
  unavailable?: string | null
}

const EMPTY_STATE: Record<ServiceKey, ServiceState> = {
  createpulse: { amount: null, unit: 'Rp', unitPrice: null, note: null },
  nexabot: { amount: null, unit: 'Rp', unitPrice: null, note: null },
  seavi: { amount: null, unit: 'token', unitPrice: null, note: null },
  posbot: { amount: null, unit: 'Rp', unitPrice: null, note: null },
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

interface ProviderBalance {
  seavi?: { tokens: number | null; used: number | null; status: number | null; error: string | null }
  nexabot?: { credits: number | null; plan: string | null; unlimited: boolean; status: number | null; error: string | null }
  posbot?: { rupiah: number | null; source: 'upstream' | 'manual'; status: number | null; error: string | null }
  createpulse?: { error: string | null }
}

/**
 * Saldo asli penyedia untuk akun admin. Admin tidak menagih dirinya sendiri,
 * jadi dompet internal (yang selalu 0 karena tidak pernah dipotong) tidak
 * berarti apa-apa untuknya — yang relevan adalah sisa kredit di akun penyedia.
 */
async function fetchProviderBalance(token: string): Promise<ProviderBalance | null> {
  try {
    const res = await fetch('/api/provider-balance', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as ProviderBalance) : null
  } catch {
    return null
  }
}

function amountLabel(state: ServiceState, loading: boolean): string {
  if (loading && state.amount === null) return '…'
  if (state.amount === null) return '—'
  if (state.unit === 'token') return `${state.amount} token`
  if (state.unit === 'kredit') {
    return `${state.amount.toLocaleString('id-ID', { maximumFractionDigits: 2 })} kredit`
  }
  return formatRp(state.amount)
}

function unitLabel(unit: Satuan): string {
  return unit === 'token' ? 'Token' : unit === 'kredit' ? 'Kredit' : 'Rupiah'
}

export default function SaldoLayananPage() {
  const { token, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
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

    // Admin: baca saldo asli penyedia. Member: dompet internal seperti biasa.
    if (isAdmin) {
      const saldo = await fetchProviderBalance(token)
      if (requestId !== requestRef.current) return
      const gagal = 'Gagal menghubungi penyedia — coba Muat ulang'
      const sv = saldo?.seavi
      const nb = saldo?.nexabot
      const pb = saldo?.posbot
      setServices({
        createpulse: {
          amount: null,
          unit: 'Rp',
          unitPrice: null,
          note: null,
          provider: true,
          unavailable: saldo?.createpulse?.error ?? gagal,
        },
        nexabot: {
          amount: nb?.credits ?? null,
          unit: 'kredit',
          unitPrice: null,
          note: nb?.unlimited ? 'Paket Unlimited aktif' : null,
          provider: true,
          detail: nb?.plan
            ? `Paket ${nb.plan} · endpoint /api/v1/credits`
            : 'Sisa kredit akun NexaBot · endpoint /api/v1/credits',
          unavailable: nb?.error ?? gagal,
        },
        seavi: {
          amount: sv?.tokens ?? null,
          unit: 'token',
          unitPrice: null,
          note: null,
          provider: true,
          detail: sv?.used != null
            ? `Token terpakai ${sv.used} · endpoint /v1/balance`
            : 'Sisa token akun Seavi Labs · endpoint /v1/balance',
          unavailable: sv?.error ?? gagal,
        },
        posbot: {
          amount: pb?.rupiah ?? null,
          unit: 'Rp',
          unitPrice: null,
          note: null,
          provider: true,
          detail: pb?.source === 'upstream'
            ? 'Dibaca dari /balance PosBot memakai kunci induk server'
            : 'Angka dari dashboard PosBot — kunci induk PosBot belum diatur di panel admin',
          unavailable: pb?.error ?? gagal,
        },
      })
      setUpdatedAt(Date.now())
      setLoading(false)
      setRefreshing(false)
      return
    }

    const [createpulse, nexabot, seavi, posbot] = await Promise.all([
      fetchCreatePulseBalance(token),
      fetchNexabotWallet(token),
      fetchSeaviWallet(token),
      fetchPosbotWallet(token),
    ])
    if (requestId !== requestRef.current) return

    const unlimited = nexabot?.unlimited
    const boosterPass = nexabot?.booster_unlimited
    const sisa = (u: NexabotUnlimited) => {
      const label = nexabotRemainingLabel(u)
      return label ? ` · ${label}` : ''
    }
    // Varian utama (packages[0]) = paket pertama — tampilkan harga langganan
    // yang berjalan supaya admin melihat efek perubahan di System Settings.
    const utama = nexabot?.packages?.[0] ?? null
    const subExtraNexabot = utama
      ? `Unlimited ${utama.label} ${formatRp(utama.price)}/${utama.days} hari`
      : null
    setServices({
      createpulse: { amount: createpulse, unit: 'Rp', unitPrice: null, note: null },
      nexabot: {
        amount: nexabot?.balance ?? null,
        unit: 'Rp',
        unitPrice: nexabot?.price ?? null,
        subExtra: subExtraNexabot,
        // Booster hanya menggratiskan Seedance/Omni/GPT Image, jadi disebut apa
        // adanya — jangan tampil sebagai "Unlimited" untuk saldo yang tetap terpotong.
        note: unlimited?.active
          ? `Paket Unlimited aktif${sisa(unlimited)}`
          : boosterPass?.active
            ? `Premium Booster aktif${sisa(boosterPass)} · music/tts per generate`
            : null,
      },
      seavi: {
        amount: seavi?.tokens ?? null,
        unit: 'token',
        unitPrice: seavi?.token_price ?? 2000,
        note: null,
      },
      posbot: {
        amount: posbot?.balance ?? null,
        unit: 'Rp',
        unitPrice: null,
        note: null,
      },
    })
    setUpdatedAt(Date.now())
    setLoading(false)
    setRefreshing(false)
  }, [token, isAdmin])

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
        desc={isAdmin
          ? 'Akun admin — angka dibaca langsung dari penyedia, bukan dari dompet internal.'
          : 'Empat dompet terpisah — saldo tiap layanan tidak digabung.'}
      />

      <Section
        title="💳 Saldo Layanan"
        sub={isAdmin
          ? 'Diambil dari penyedia tiap halaman dibuka (Seavi /v1/balance, NexaBot /api/v1/credits).'
          : 'Nilai diambil langsung dari server tiap layanan.'}
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
            // `unknown` = gagal memuat. Angka yang memang tidak tersedia dari
            // penyedia diberi alasan sendiri lewat `unavailable`, bukan error.
            const unknown = !loading && state.amount === null && !state.unavailable
            const sub = state.detail
              ? state.detail
              : state.unit === 'token' && state.amount !== null
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
                      {unitLabel(state.unit)}
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
                      (unknown || state.unavailable) && 'text-muted-foreground',
                    )}>
                      {amountLabel(state, loading)}
                    </div>
                  )}
                  <p className={cn('mt-1 text-[11px]', unknown ? 'text-destructive' : 'text-muted-foreground')}>
                    {unknown
                      ? 'Gagal memuat saldo layanan ini'
                      : state.amount === null && state.unavailable
                        ? state.unavailable
                        : sub}
                  </p>
                  {state.subExtra && !unknown && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{state.subExtra}</p>
                  )}
                  {state.note && !unknown && (
                    <p className="mt-1 inline-flex rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      {state.note}
                    </p>
                  )}
                </div>

                {!state.provider && (
                  <Link
                    to={service.href}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-secondary/70 px-2 py-2 text-xs font-medium text-foreground transition hover:bg-secondary"
                  >
                    Top Up
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>

        {!isAdmin && (
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
        )}

        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {isAdmin
              ? 'Akun admin: Seavi dan NexaBot dibaca langsung dari penyedia; PosBot dibaca dari /balance bila kunci induknya sudah diatur (Sistem → Kunci Server PosBot), dan selama belum diatur memakai angka dari dashboard Anda; CreatePulse belum punya endpoint saldo di integrasi kita. Dompet member tidak berubah.'
              : 'Saldo CreatePulse, NexaBot, dan PosBot dalam Rupiah; Seavi dalam token. Tiap layanan punya dompet sendiri, jadi saldo tidak bisa dipindah atau dijumlahkan.'}
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
