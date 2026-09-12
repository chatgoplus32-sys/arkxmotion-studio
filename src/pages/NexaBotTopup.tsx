import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Copy, Sparkles, Zap } from 'lucide-react'
import { DANA_NUMBER, DANA_NAME, adminWhatsappLink, formatRp } from '@/lib/payment'
import {
  fetchNexabotWallet,
  nexabotPackageName,
  NEXABOT_PACKAGE_FALLBACKS,
  type NexabotWallet,
} from '@/lib/nexabotWallet'

const NOMINALS = [10000, 15000, 20000, 25000, 50000, 100000]

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  kind: 'balance' | 'unlimited'
  days: number
  /** Varian paket yang dibeli (mist. unlimited_monthly) — kosong di data lama. */
  package_slug?: string
  expires_at: string | null
  proof_note: string
  admin_note: string
  created_at: string
}

export default function NexaBotTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [wallet, setWallet] = useState<NexabotWallet | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number>(10000)
  const [customAmount, setCustomAmount] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [mode, setMode] = useState<'balance' | 'package'>('balance')
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')
  // Varian paket yang sedang dipilih user (Mingguan/Bulanan/Tahunan).
  const [selectedSlug, setSelectedSlug] = useState<string>(NEXABOT_PACKAGE_FALLBACKS[0].slug)

  const API = '/api/nexabot'
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const packages = wallet?.packages?.length ? wallet.packages : NEXABOT_PACKAGE_FALLBACKS
  const pkg = packages.find((p) => p.slug === selectedSlug) || packages[0]
  const unlimited = wallet?.unlimited
  const amount = mode === 'package' ? pkg.price : customAmount ? parseInt(customAmount, 10) || 0 : selectedAmount
  const pendingPackage = topups.some((t) => t.kind === 'unlimited' && t.status === 'pending')

  const fetchBalance = useCallback(async () => {
    if (!token) return
    const data = await fetchNexabotWallet(token)
    if (data) {
      setWallet(data)
      // Varian pilihan bisa hilang kalau admin mengganti katalog paket.
      setSelectedSlug((prev) => (data.packages.some((p) => p.slug === prev) ? prev : data.packages[0]?.slug || prev))
    }
  }, [token])

  const fetchTopups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch (e) { console.warn('[NexaBotTopup] Failed to fetch topups:', e) }
  }, [headers])

  useEffect(() => {
    fetchBalance()
    fetchTopups()
  }, [fetchBalance, fetchTopups])

  const submit = async (endpoint: 'topup' | 'package') => {
    if (endpoint === 'topup' && amount < (wallet?.min_topup ?? 10000)) {
      addToast(`Minimal topup ${formatRp(wallet?.min_topup ?? 10000)}`, 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/${endpoint}`, {
        method: 'POST',
        headers,
        // Nominal paket ditentukan server, jadi klien tidak mengirim `amount`.
        // Nominal paket ditentukan server dari varian (slug) yang dipilih.
        body: JSON.stringify(
          endpoint === 'package'
            ? { slug: pkg.slug, proof_note: proofNote }
            : { amount, proof_note: proofNote },
        ),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(
          endpoint === 'package'
            ? `Paket ${pkg.label} ${pkg.days} hari diajukan — ${formatRp(pkg.price)}`
            : `Topup ${formatRp(amount)} diajukan`,
          'success',
        )
        setStep('confirm')
        fetchTopups()
        fetchBalance()
      } else {
        addToast(data.error || 'Gagal', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setLoading(false)
  }

  const startPackage = (slug: string) => {
    setSelectedSlug(slug)
    setMode('package')
    setProofNote('')
    setStep('pay')
  }

  const copyNumber = () => {
    navigator.clipboard.writeText(DANA_NUMBER)
    addToast('Nomor DANA disalin', 'info')
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" /> Disetujui</Badge>
      case 'rejected': return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Ditolak</Badge>
      default: return <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
    }
  }

  const formatDate = (value: string | null) => {
    if (!value) return '-'
    const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return value
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
  }

  const waLink = adminWhatsappLink(
    mode === 'package'
      ? `Halo admin, saya ingin beli Paket Unlimited NexaBot ${pkg.label} ${pkg.days} hari (${formatRp(pkg.price)})`
      : `Halo admin, saya ingin top up saldo NexaBot ${formatRp(amount)}`,
  )

  return (
    <PageContent>
      <PageHeader
        eyebrow="NexaBot"
        title="Top Up &"
        highlight="Paket"
        desc={`Saldo ${formatRp(wallet?.price ?? 250)}/generate, atau Paket Unlimited mulai ${formatRp(packages[0].price)}`}
      />

      {/* Saldo + status paket */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo NexaBot</div>
            <div className="text-2xl font-bold">{formatRp(wallet?.balance ?? 0)}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Semua mode (t2v, sfv, i2v, r2v, img, tts): <b className="text-foreground">{formatRp(wallet?.price ?? 250)}/generate</b></span>
          {unlimited?.active && (
            <Badge variant="success">
              <Zap className="h-3 w-3 mr-1" />
              Unlimited aktif · sisa {unlimited.days_left} hari
            </Badge>
          )}
        </div>
        {unlimited?.active && (
          <div className="mt-2 text-[11px] text-emerald-500">
            Paket Unlimited berlaku sampai {formatDate(unlimited.expires_at)} — generate tidak memotong saldo sampai waktu itu.
          </div>
        )}
      </div>

      {/* Paket Unlimited — semua varian dari server, bisa dipilih user */}
      <Section title="Paket Unlimited" sub="Pilih masa berlaku — makin panjang, makin murah per harinya">
        <div className="grid sm:grid-cols-3 gap-3">
          {packages.map((p) => {
            const selected = p.slug === pkg.slug
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => setSelectedSlug(p.slug)}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{p.label}</span>
                  <span className="text-[11px] text-muted-foreground">{p.days} hari</span>
                </div>
                <div className="mt-2 text-2xl font-bold text-primary">{formatRp(p.price)}</div>
                <div className="text-[11px] text-muted-foreground">
                  ≈ {formatRp(Math.round(p.price / Math.max(1, p.days)))}/hari
                </div>
                <div className={`mt-2 text-[11px] font-medium ${selected ? 'text-primary' : 'text-transparent'}`}>
                  ✓ Dipilih
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-3 rounded-xl border-2 border-primary/40 bg-card/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="font-bold text-lg">Unlimited {pkg.label} · {pkg.days} Hari</span>
              </div>
              <div className="text-3xl font-bold text-primary">{formatRp(pkg.price)}</div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>• Semua mode & model NexaBot tanpa batas</li>
                <li>• Saldo Rp tetap utuh (tidak terpotong) selama paket aktif</li>
                <li>• Beli lagi saat masih aktif? Masa berlakunya ditumpuk</li>
              </ul>
            </div>
            <div className="text-right">
              {pendingPackage ? (
                <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Menunggu approval</Badge>
              ) : (
                <Button onClick={() => startPackage(pkg.slug)}>
                  {unlimited?.active ? `Perpanjang ${pkg.label}` : `Beli Paket ${pkg.label}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {step === 'select' && (
        <Section title="Top Up Saldo" sub={`Minimal ${formatRp(wallet?.min_topup ?? 10000)}`}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {NOMINALS.map((n) => (
              <button
                key={n}
                onClick={() => { setMode('balance'); setSelectedAmount(n); setCustomAmount('') }}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  mode === 'balance' && selectedAmount === n && !customAmount
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="text-lg font-bold">{formatRp(n)}</div>
              </button>
            ))}
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Atau nominal lain (min {formatRp(wallet?.min_topup ?? 10000)})</label>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => { setMode('balance'); setCustomAmount(e.target.value) }}
              placeholder="Masukkan nominal..."
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Catatan (opsional)</label>
            <input
              type="text"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="Contoh: an. Ahmad"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={() => setStep('pay')} disabled={loading} className="w-full">
            Lanjut Bayar {formatRp(amount)}
          </Button>
        </Section>
      )}

      {step === 'pay' && (
        <Section title="Pembayaran via DANA" sub="Transfer ke nomor DANA berikut">
          <div className="rounded-xl border border-border bg-card/50 p-5 mb-4">
            <div className="text-center mb-4">
              <div className="text-sm text-muted-foreground mb-1">Transfer ke:</div>
              <div className="text-xl font-bold">💜 DANA</div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                <div>
                  <div className="text-xs text-muted-foreground">Nomor HP</div>
                  <div className="font-mono font-bold text-lg">{DANA_NUMBER}</div>
                </div>
                <button onClick={copyNumber} className="p-2 rounded-lg hover:bg-accent transition">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="p-3 rounded-lg bg-background">
                <div className="text-xs text-muted-foreground">Atas Nama</div>
                <div className="font-medium">{DANA_NAME}</div>
              </div>
              <div className="p-3 rounded-lg bg-background">
                <div className="text-xs text-muted-foreground">
                  Jumlah Transfer {mode === 'package' ? `(Paket Unlimited ${pkg.label} · ${pkg.days} hari)` : ''}
                </div>
                <div className="font-bold text-primary text-lg">{formatRp(amount)}</div>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Catatan (opsional)</label>
            <input
              type="text"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="Contoh: an. Ahmad"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setStep('select'); setMode('balance') }} className="flex-1">
              Kembali
            </Button>
            <Button onClick={() => submit(mode === 'package' ? 'package' : 'topup')} disabled={loading} className="flex-1">
              {loading ? 'Mengirim...' : 'Sudah Transfer'}
            </Button>
          </div>

          <div className="mt-4 text-center">
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-emerald-500 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Hubungi Admin via WhatsApp
            </a>
          </div>
        </Section>
      )}

      {step === 'confirm' && (
        <Section title="Menunggu Approval" sub="Pengajuan kamu sedang diproses admin">
          <div className="text-center py-8">
            <div className="text-5xl mb-4">⏳</div>
            <div className="text-lg font-medium mb-2">
              {mode === 'package' ? 'Paket Unlimited menunggu approval' : 'Topup menunggu approval'}
            </div>
            <div className="text-sm text-muted-foreground mb-4">
              {mode === 'package'
                ? `Paket ${pkg.label} ${pkg.days} hari aktif otomatis setelah admin menyetujui pembayaran.`
                : 'Saldo masuk otomatis setelah admin menyetujui pembayaran.'}
              <br />Hubungi admin jika sudah transfer.
            </div>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-medium hover:bg-emerald-500/20 transition"
            >
              <ExternalLink className="h-4 w-4" />
              Konfirmasi via WhatsApp
            </a>
            <div className="mt-4">
              <Button variant="outline" onClick={() => { setStep('select'); setMode('balance'); fetchBalance(); fetchTopups() }}>
                Kembali
              </Button>
            </div>
          </div>
        </Section>
      )}

      {/* Riwayat gabungan: top up saldo & paket */}
      {topups.length > 0 && (
        <Section title="Riwayat" sub="Top up saldo & pembelian paket">
          <div className="space-y-2">
            {topups.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card/30">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{formatRp(t.amount)}</span>
                    {t.kind === 'unlimited' && (
                      <Badge variant="default">
                        <Sparkles className="h-3 w-3 mr-1" /> Paket {nexabotPackageName(t.package_slug, t.days || pkg.days)}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDate(t.created_at)}
                    {t.kind === 'unlimited' && t.status === 'approved' && t.expires_at && ` · berlaku s/d ${formatDate(t.expires_at)}`}
                  </div>
                  {t.admin_note && (
                    <div className="text-[11px] text-muted-foreground italic">{t.admin_note}</div>
                  )}
                </div>
                {getStatusBadge(t.status)}
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageContent>
  )
}
