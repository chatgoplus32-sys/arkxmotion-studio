import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight, ChevronDown, Crown, Gem, Loader2, RefreshCw, Settings,
  Shield, ShoppingCart, Wallet, X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { formatRp } from '@/lib/payment'
import { cn } from '@/lib/utils'

const WALLET_ROWS = [
  { key: 'createpulse', label: 'CreatePulse', href: '/topup/createpulse' },
  { key: 'nexabot', label: 'NexaBot', href: '/topup/nexabot' },
  { key: 'seavi', label: 'Seavi', href: '/topup/seavi' },
  { key: 'alriz', label: 'Alriz', href: '/topup/alriz' },
] as const

type WalletKey = (typeof WALLET_ROWS)[number]['key']

interface WalletAmounts {
  createpulse: number | null
  nexabot: number | null
  seavi: number | null
  alriz: number | null
  tokenPrice: number
}

const INITIAL_WALLETS: WalletAmounts = {
  createpulse: null,
  nexabot: null,
  seavi: null,
  alriz: null,
  tokenPrice: 2000,
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function getJson(path: string, token: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function compactRp(value: number): string {
  if (value >= 1_000_000) {
    const jt = value / 1_000_000
    return `Rp ${(Number.isInteger(jt) ? jt.toFixed(0) : jt.toFixed(1)).replace('.', ',')}jt`
  }
  if (value >= 1_000) {
    const rb = value / 1_000
    return `Rp ${(Number.isInteger(rb) ? rb.toFixed(0) : rb.toFixed(1)).replace('.', ',')}rb`
  }
  return `Rp ${Math.round(value)}`
}

function formatProSince(value?: string | null): string | null {
  if (!value) return null
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AccountStatus() {
  const { user, token } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [wallets, setWallets] = useState<WalletAmounts>(INITIAL_WALLETS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef(0)
  const lastLoadRef = useRef(0)

  const load = useCallback(async (silent = false) => {
    if (!token) {
      setLoading(false)
      return
    }
    const requestId = ++requestRef.current
    if (silent) setRefreshing(true)
    else setLoading(true)

    const [cp, nb, sv, al] = await Promise.all([
      getJson('/api/createpulse/balance', token),
      getJson('/api/nexabot/balance', token),
      getJson('/api/seavi/balance', token),
      getJson('/api/alriz/balance', token),
    ])
    if (requestId !== requestRef.current) return

    const next: WalletAmounts = {
      createpulse: num(cp?.balance),
      nexabot: num(nb?.balance),
      seavi: num(sv?.tokens) ?? num(sv?.balance),
      alriz: num(al?.balance),
      tokenPrice: num(sv?.token_price) ?? 2000,
    }
    const anyKnown = [next.createpulse, next.nexabot, next.seavi, next.alriz].some((v) => v !== null)
    lastLoadRef.current = Date.now()
    setWallets(next)
    setError(!anyKnown)
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
    const onTasksChanged = () => {
      if (Date.now() - lastLoadRef.current > 20000) load(true)
    }
    window.addEventListener('arkxmotion-tasks-changed', onTasksChanged)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('arkxmotion-tasks-changed', onTasksChanged)
    }
  }, [load, token])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const isAdmin = user?.role === 'admin'
  const isPro = isAdmin || user?.plan === 'pro'
  const planLabel = isAdmin ? 'Admin' : isPro ? 'Pro' : 'Free'
  const proSince = formatProSince(user?.proSince)
  const initial = user?.name?.trim().charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'

  const known = [wallets.createpulse, wallets.nexabot, wallets.seavi, wallets.alriz]
  const allKnown = known.every((v) => v !== null)
  const total = (wallets.createpulse ?? 0) + (wallets.nexabot ?? 0) + (wallets.alriz ?? 0) + (wallets.seavi ?? 0) * wallets.tokenPrice
  const chipAmount = loading ? 'Saldo' : allKnown ? compactRp(total) : '—'

  const toggle = () => {
    if (!open) load(true)
    setOpen((v) => !v)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={`Status akun ${planLabel} dan saldo`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={allKnown ? `${planLabel} · Total saldo ${formatRp(total)}` : `Status akun ${planLabel}`}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors',
          isPro ? 'text-amber-400 hover:bg-amber-400/10' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          open && 'bg-accent',
        )}
      >
        <span className="flex items-center gap-1.5">
          {isAdmin ? <Shield className="h-4 w-4" /> : isPro ? <Crown className="h-4 w-4" /> : <Gem className="h-4 w-4" />}
          <span className="hidden text-xs font-semibold sm:inline">{planLabel}</span>
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <span className="flex items-center gap-1">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="font-mono text-xs font-medium tabular-nums text-foreground">{chipAmount}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Status akun dan saldo"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-fade-in sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px]"
        >
          <div className="relative overflow-hidden border-b border-border p-4">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
            <div className="relative flex items-start gap-3">
              <div className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold',
                isPro ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-black' : 'bg-gradient-to-br from-primary/30 to-primary/10 text-primary',
              )}>
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user?.name || 'Member'}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                    isPro
                      ? 'border-amber-400/25 bg-amber-400/10 text-amber-400'
                      : 'border-border bg-secondary text-muted-foreground',
                  )}>
                    {isAdmin ? <Shield className="h-2.5 w-2.5" /> : isPro ? <Crown className="h-2.5 w-2.5" /> : <Gem className="h-2.5 w-2.5" />}
                    {planLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {isAdmin ? 'Akses admin penuh' : isPro ? (proSince ? `Pro sejak ${proSince}` : 'Semua fitur Pro aktif') : '3 fitur premium terkunci'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); buttonRef.current?.focus() }}
                aria-label="Tutup status akun"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {!isPro && (
              <Link
                to="/upgrade-pro"
                onClick={() => setOpen(false)}
                className="relative mt-3 flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-gradient-to-r from-primary/15 to-primary/5 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/40 hover:bg-primary/15"
              >
                <span className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5" />
                  Buka 3 fitur premium
                </span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Saldo layanan</p>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={loading || refreshing}
                aria-label="Muat ulang saldo"
                title="Muat ulang saldo"
                className="rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', (loading || refreshing) && 'animate-spin')} />
              </button>
            </div>

            <div className="mt-2 space-y-0.5">
              {WALLET_ROWS.map((row) => {
                const value = wallets[row.key as WalletKey]
                const valueLabel = loading && value === null
                  ? '…'
                  : value === null
                    ? '—'
                    : row.key === 'seavi'
                      ? `${value} token`
                      : formatRp(value)
                return (
                  <Link
                    key={row.key}
                    to={row.href}
                    onClick={() => setOpen(false)}
                    title={row.key === 'seavi' && value !== null ? `${value} token ≈ ${formatRp(value * wallets.tokenPrice)}` : row.label}
                    className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-accent/60"
                  >
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs">{row.label}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums">{valueLabel}</span>
                    {!isAdmin && (
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
                    )}
                  </Link>
                )
              })}
            </div>

            <div className="mt-3 rounded-lg bg-secondary/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Total saldo</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {loading ? '…' : allKnown ? formatRp(total) : '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {loading
                  ? 'Memuat saldo…'
                  : allKnown
                    ? `Seavi dihitung ${formatRp(wallets.tokenPrice)}/token`
                    : 'Sebagian saldo belum termuat'}
              </p>
            </div>

            {error && !loading && (
              <button
                type="button"
                onClick={() => load()}
                className="mt-2 w-full text-left text-[11px] text-destructive hover:underline"
              >
                Gagal memuat saldo — coba lagi
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <Link
              to={isAdmin ? '/admin/topup' : '/beli-token'}
              onClick={() => setOpen(false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-2 py-2 text-[11px] font-medium text-primary transition hover:bg-primary/15"
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {isAdmin ? 'Approve Top Up' : 'Beli Token'}
            </Link>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary/70 px-2 py-2 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              Pengaturan
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
