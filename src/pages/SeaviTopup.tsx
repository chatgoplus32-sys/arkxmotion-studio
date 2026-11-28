import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Coins } from 'lucide-react'
import { adminWhatsappLink, formatRp, recreateVelianpayQris } from '@/lib/payment'
import { QrisPanel, VelianpayCheckoutButton } from '@/components/QrisPayment'
import { fetchSeaviWallet, SEAVI_PACKAGE_FALLBACKS, type SeaviPackage } from '@/lib/seaviWallet'

const WHATSAPP_LINK = adminWhatsappLink('Halo saya ingin top up token Seavi')

interface Topup {
  id: number
  amount: number
  tokens: number
  package_slug: string
  status: 'pending' | 'approved' | 'rejected'
  proof_note: string
  admin_note: string
  created_at: string
  /** Nominal bayar tepat (amount + kode unik) — diisi server saat pengajuan. */
  unique_code?: number | null
  amount_total?: number | null
}

export default function SeaviTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [packages, setPackages] = useState<SeaviPackage[]>(SEAVI_PACKAGE_FALLBACKS)
  const [tokenPrice, setTokenPrice] = useState(2000)
  // Kelayakan kunci server dari server (top up / admin) — bukan tebakan browser.
  const [serverKey, setServerKey] = useState<{ available: boolean; reason?: string } | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string>(SEAVI_PACKAGE_FALLBACKS[0].slug)
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [submitted, setSubmitted] = useState<Topup | null>(null)
  const [velianpay, setVelianpay] = useState<{ checkout_url?: string; payable_amount?: number; qris_image?: string } | null>(null)
  const [qrRetrying, setQrRetrying] = useState(false)
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')

  const API = '/api/seavi'

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const selectedPackage = packages.find((p) => p.slug === selectedSlug) || packages[0]

  const fetchWallet = useCallback(async () => {
    if (!token) return
    try {
      const w = await fetchSeaviWallet(token)
      if (w) {
        setBalance(w.tokens)
        setPackages(w.packages.length > 0 ? w.packages : SEAVI_PACKAGE_FALLBACKS)
        setTokenPrice(w.token_price || 2000)
        setServerKey(w.server_key ?? null)
        if (!w.packages.some((p) => p.slug === selectedSlug) && w.packages.length > 0) {
          setSelectedSlug(w.packages[0].slug)
        }
      }
    } catch (e) { console.warn('[SeaviTopup] Failed to fetch wallet:', e) }
  }, [token, selectedSlug])

  const fetchTopups = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch (e) { console.warn('[SeaviTopup] Failed to fetch topups:', e) }
  }, [headers, token])

  useEffect(() => {
    fetchWallet()
    fetchTopups()
  }, [fetchWallet, fetchTopups])

  // Auto-refresh: begitu pembayaran diverifikasi otomatis (VelianPay /
  // notifikasi bank), token & status baris berubah tanpa reload halaman.
  // Polling hanya jalan selama ada yang menunggu — begitu lunas, berhenti.
  const adaPending = topups.some((t) => t.status === 'pending')
  useEffect(() => {
    if (!adaPending && step === 'select') return
    const timer = setInterval(() => {
      fetchWallet()
      fetchTopups()
    }, 8000)
    return () => clearInterval(timer)
  }, [adaPending, step, fetchWallet, fetchTopups])

  const handleTopup = async () => {
    if (!selectedPackage) {
      addToast('Pilih paket dulu', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/topup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ package_slug: selectedPackage.slug, proof_note: proofNote }),
      })
      const data = await res.json()
      if (res.ok) {
        // Simpan baris yang diajukan — amount_total adalah nominal yang
        // harus dibayar dan yang dicocokkan parser email.
        setSubmitted(data.topup || null)
        setVelianpay(data.velianpay || null)
        addToast(`Paket ${selectedPackage.label} diajukan`, 'success')
        setStep('pay')
        fetchTopups()
      } else {
        addToast(data.error || 'Gagal', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setLoading(false)
  }

  const handleConfirmTransfer = async () => {
    // Baris sudah dibuat di handleTopup — tidak perlu pengajuan kedua.
    setStep('confirm')
    fetchTopups()
    fetchWallet()
  }

  // Status baris yang sedang dibayar, dilihat ulang dari daftar terbaru
  // (di-update polling) supaya layar konfirmasi ikut berubah saat lunas.
  const statusDiajukan = submitted ? topups.find((t) => t.id === submitted.id)?.status ?? submitted.status : null
  const lunas = statusDiajukan === 'approved'

  // Checkout VelianPay gagal dibuat (jaringan/API)? Siapkan ulang untuk baris
  // yang sama — tanpa mengajukan top up baru dan tanpa QRIS statis lama.
  const handleRetryQris = async () => {
    if (!token || !submitted || qrRetrying) return
    setQrRetrying(true)
    const bp = await recreateVelianpayQris(token, 'seavi_topup', submitted.id)
    setQrRetrying(false)
    if (bp) {
      setVelianpay(bp)
      addToast('QRIS VelianPay siap — bayar sesuai nominal', 'success')
    } else {
      addToast('QRIS VelianPay masih gagal disiapkan — coba lagi', 'error')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" /> Disetujui</Badge>
      case 'rejected': return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Ditolak</Badge>
      default: return <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Seavi"
        title="Top Up"
        highlight="Token"
        desc={`Isi token khusus provider Seavi. Harga: ${formatRp(tokenPrice)}/token — 1 token per generate untuk semua model aktif`}
      />

      {/* Balance */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Token Seavi</div>
            <div className="text-2xl font-bold">{balance} <span className="text-sm font-medium text-muted-foreground">token</span></div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>Token per generate: <b className="text-foreground">1 token untuk sebagian besar model, 2 token untuk Kling 4.0 / Wan 3.0 Prime / Seedance 2.5 S10</b></div>
          <div>Model aktif: <b className="text-foreground">19 model (video, motion control, image)</b></div>
        </div>
        <div className="mt-3 text-[11px] leading-relaxed">
          {serverKey?.available ? (
            <span className="text-emerald-500">
              ✓ Setelah token masuk, generate langsung jalan tanpa API key — relay memakai kunci server Seavi dan
              token ini yang dipotong.
            </span>
          ) : (
            <span className="text-muted-foreground">
              {serverKey?.reason || 'Kunci server Seavi belum diatur admin — generate membutuhkan API key Seavi sendiri di halaman Providers.'}
            </span>
          )}
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Paket Token" sub="Minimal Rp 3.400 = 2 token">
          <div className="grid grid-cols-2 gap-3 mb-4">
            {packages.map((p) => (
              <button
                key={p.slug}
                onClick={() => setSelectedSlug(p.slug)}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  selectedSlug === p.slug
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5 text-lg font-bold">
                  <Coins className="h-5 w-5 text-primary" />
                  {p.tokens} Token
                </div>
                <div className="text-sm text-muted-foreground mt-1">{formatRp(p.price)}</div>
                <div className="text-[11px] text-muted-foreground">≈ {formatRp(Math.round(p.price / Math.max(1, p.tokens)))}/token</div>
              </button>
            ))}
          </div>
          <Button onClick={handleTopup} disabled={loading} className="w-full">
            {loading ? 'Memproses...' : selectedPackage ? `Top Up ${selectedPackage.label} — ${formatRp(selectedPackage.price)}` : 'Top Up'}
          </Button>
        </Section>
      )}

      {step === 'pay' && selectedPackage && (
        <Section
          title="Pembayaran via QRIS VelianPay"
          sub="Klik Bayar → checkout VelianPay, nominal TEPAT & terverifikasi otomatis"
        >
          <VelianpayCheckoutButton url={velianpay?.checkout_url} payable={velianpay?.payable_amount} image={velianpay?.qris_image} />

          {!(velianpay?.checkout_url || velianpay?.qris_image) && (
            <QrisPanel
              amountLabel={`${selectedPackage.label} — ${formatRp(selectedPackage.price)}`}
              exactAmount={submitted?.amount_total ?? undefined}
              onRetry={handleRetryQris}
              retrying={qrRetrying}
            />
          )}

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
            <Button variant="outline" onClick={() => setStep('select')} className="flex-1">
              Kembali
            </Button>
            <Button onClick={handleConfirmTransfer} disabled={loading} className="flex-1">
              {loading ? 'Mengirim...' : 'Sudah Bayar'}
            </Button>
          </div>

          <div className="mt-4 text-center">
            <a
              href={WHATSAPP_LINK}
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
        <Section
          title={lunas ? 'Pembayaran Terverifikasi' : 'Menunggu Pembayaran'}
          sub={lunas ? 'Token sudah masuk ke akun kamu' : 'Verifikasi berjalan otomatis — halaman ini memperbarui sendiri'}
        >
          <div className="text-center py-8">
            <div className="text-5xl mb-4">{lunas ? '✅' : '⏳'}</div>
            <div className="text-lg font-medium mb-2">{lunas ? 'Token Masuk!' : 'Menunggu Pembayaran Masuk'}</div>
            <div className="text-sm text-muted-foreground mb-4">
              {lunas
                ? 'Pembayaran terverifikasi otomatis dan token sudah ditambahkan — siap dipakai generate.'
                : 'Pembayaran diverifikasi otomatis dari QRIS/notifikasi bank — token masuk sendiri beberapa menit setelah bayar. Halaman ini refresh otomatis.'}
              <br />Kalau sudah lebih dari 15 menit belum masuk, hubungi admin via WhatsApp.
            </div>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-medium hover:bg-emerald-500/20 transition"
            >
              <ExternalLink className="h-4 w-4" />
              Konfirmasi via WhatsApp
            </a>
            <div className="mt-4">
              <Button variant="outline" onClick={() => { setStep('select'); fetchWallet(); fetchTopups() }}>
                {lunas ? 'Lihat Saldo' : 'Kembali ke Top Up'}
              </Button>
            </div>
          </div>
        </Section>
      )}

      {/* History */}
      {topups.length > 0 && (
        <Section title="Riwayat Top Up">
          <div className="space-y-2">
            {topups.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card/30">
                <div>
                  <div className="text-sm font-medium">{t.tokens > 0 ? `${t.tokens} Token` : formatRp(t.amount)} <span className="text-muted-foreground font-normal">· {formatRp(t.amount)}</span></div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(t.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
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
