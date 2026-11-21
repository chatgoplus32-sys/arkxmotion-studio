import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import { adminWhatsappLink, formatRp, recreateBasunipayQris } from '@/lib/payment'
import { QrisPanel, BasunipayCheckoutButton } from '@/components/QrisPayment'
import { fetchRunninghubWallet, RUNNINGHUB_PRESET_FALLBACKS } from '@/lib/runninghubWallet'

const WHATSAPP_LINK = adminWhatsappLink('Halo saya ingin top up saldo RunningHub')

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proof_note: string
  admin_note: string
  created_at: string
  /** Nominal bayar tepat (amount + kode unik) — diisi server saat pengajuan. */
  unique_code?: number | null
  amount_total?: number | null
}

export default function RunningHubTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [charge, setCharge] = useState(2500)
  const [presets, setPresets] = useState<number[]>(RUNNINGHUB_PRESET_FALLBACKS)
  const [minTopup, setMinTopup] = useState(10000)
  const [maxTopup, setMaxTopup] = useState(5000000)
  // Kelayakan token server dari server (top up / admin) — bukan tebakan browser.
  const [serverKey, setServerKey] = useState<{ available: boolean; reason?: string } | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number>(RUNNINGHUB_PRESET_FALLBACKS[0])
  const [customAmount, setCustomAmount] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [submitted, setSubmitted] = useState<Topup | null>(null)
  const [basunipay, setBasunipay] = useState<{ checkout_url?: string; payable_amount?: number; qris_image?: string } | null>(null)
  const [qrRetrying, setQrRetrying] = useState(false)
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')

  const API = '/api/runninghub-wallet'

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const amount = customAmount ? parseInt(customAmount, 10) : selectedAmount

  const fetchWallet = useCallback(async () => {
    if (!token) return
    try {
      const w = await fetchRunninghubWallet(token)
      if (w) {
        setBalance(w.balance)
        setCharge(w.charge ?? 2500)
        setPresets(w.presets.length > 0 ? w.presets : RUNNINGHUB_PRESET_FALLBACKS)
        setMinTopup(w.min_topup)
        setMaxTopup(w.max_topup)
        setServerKey(w.server_key ?? null)
      }
    } catch (e) { console.warn('[RunningHubTopup] Failed to fetch wallet:', e) }
  }, [token])

  const fetchTopups = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch (e) { console.warn('[RunningHubTopup] Failed to fetch topups:', e) }
  }, [headers, token])

  useEffect(() => {
    fetchWallet()
    fetchTopups()
  }, [fetchWallet, fetchTopups])

  // Auto-refresh: begitu pembayaran diverifikasi otomatis (BasuNiPay /
  // notifikasi bank), saldo & status baris berubah tanpa reload halaman.
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

  const submitTopup = async (note: string) => {
    if (!Number.isInteger(amount) || amount < minTopup) {
      addToast(`Minimal topup ${formatRp(minTopup)}`, 'error')
      return
    }
    if (amount > maxTopup) {
      addToast(`Maksimal topup ${formatRp(maxTopup)}`, 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/topup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, proof_note: note }),
      })
      const data = await res.json()
      if (res.ok) {
        // Simpan baris yang diajukan — amount_total adalah nominal yang
        // harus dibayar dan yang dicocokkan parser email.
        setSubmitted(data.topup || null)
        setBasunipay(data.basunipay || null)
        addToast(`Topup ${formatRp(amount)} diajukan`, 'success')
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

  const handleTopup = () => submitTopup(proofNote)
  // Baris pengajuan sudah dibuat di handleTopup. Tombol "Sudah Bayar/Transfer"
  // hanya menandai user sudah membayar lalu pindah ke layar konfirmasi —
  // POST kedua di sini hanya membuat baris pending dobel.
  const handleConfirmTransfer = () => {
    setStep('confirm')
    fetchTopups()
    fetchWallet()
  }

  // Status baris yang sedang dibayar, dilihat ulang dari daftar terbaru
  // (di-update polling) supaya layar konfirmasi ikut berubah saat lunas.
  const statusDiajukan = submitted ? topups.find((t) => t.id === submitted.id)?.status ?? submitted.status : null
  const lunas = statusDiajukan === 'approved'

  // Checkout BasuNiPay gagal dibuat (jaringan/API)? Siapkan ulang untuk baris
  // yang sama — tanpa mengajukan top up baru dan tanpa QRIS statis lama.
  const handleRetryQris = async () => {
    if (!token || !submitted || qrRetrying) return
    setQrRetrying(true)
    const bp = await recreateBasunipayQris(token, 'runninghub_topup', submitted.id)
    setQrRetrying(false)
    if (bp) {
      setBasunipay(bp)
      addToast('QRIS BasuNiPay siap — bayar sesuai nominal', 'success')
    } else {
      addToast('QRIS BasuNiPay masih gagal disiapkan — coba lagi', 'error')
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
        eyebrow="RunningHub"
        title="Top Up"
        highlight="Saldo"
        desc="Isi saldo Rupiah khusus provider RunningHub. Harga per model per generate - sesuai tarif di System Settings, tanpa perlu token sendiri."
      />

      {/* Balance */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo RunningHub</div>
            <div className="text-2xl font-bold">{formatRp(balance)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>Tarif: <b className="text-foreground">{formatRp(charge)}/generate</b></div>
          <div>Berlaku: <b className="text-foreground">semua fitur RunningHub</b></div>
        </div>
        <div className="mt-3 text-[11px] leading-relaxed">
          {serverKey?.available ? (
            <span className="text-emerald-500">
              ✓ Setelah saldo masuk, generate langsung jalan tanpa API key — relay memakai token master RunningHub dari
              pool operator (auto-rotate) dan saldo ini yang dipotong.
            </span>
          ) : (
            <span className="text-muted-foreground">
              {serverKey?.reason || 'Token master RunningHub belum diatur admin — generate membutuhkan access token/API key RunningHub sendiri di halaman Providers.'}
            </span>
          )}
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Nominal Top Up" sub={`Minimal ${formatRp(minTopup)} · maksimal ${formatRp(maxTopup)}`}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {presets.map((n) => (
              <button
                key={n}
                onClick={() => { setSelectedAmount(n); setCustomAmount('') }}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  selectedAmount === n && !customAmount
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="text-lg font-bold">{formatRp(n)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">≈ {Math.floor(n / charge)} generate</div>
              </button>
            ))}
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Atau nominal lain (min {formatRp(minTopup)})</label>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Masukkan nominal..."
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleTopup} disabled={loading} className="w-full">
            {loading ? 'Memproses...' : `Top Up ${formatRp(Number.isInteger(amount) ? amount : 0)}`}
          </Button>
        </Section>
      )}

      {step === 'pay' && (
        <Section
          title="Pembayaran via QRIS BasuNiPay"
          sub="Klik Bayar → checkout BasuNiPay, nominal TEPAT & terverifikasi otomatis"
        >
          <BasunipayCheckoutButton url={basunipay?.checkout_url} payable={basunipay?.payable_amount} image={basunipay?.qris_image} />

          {!(basunipay?.checkout_url || basunipay?.qris_image) && (
            <QrisPanel
              amountLabel={formatRp(Number.isInteger(amount) ? amount : 0)}
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
          sub={lunas ? 'Saldo sudah masuk ke akun kamu' : 'Verifikasi berjalan otomatis — halaman ini memperbarui sendiri'}
        >
          <div className="text-center py-8">
            <div className="text-5xl mb-4">{lunas ? '✅' : '⏳'}</div>
            <div className="text-lg font-medium mb-2">{lunas ? 'Saldo Masuk!' : 'Menunggu Pembayaran Masuk'}</div>
            <div className="text-sm text-muted-foreground mb-4">
              {lunas
                ? 'Pembayaran terverifikasi otomatis dan saldo sudah ditambahkan — siap dipakai generate.'
                : 'Pembayaran diverifikasi otomatis dari QRIS/notifikasi bank — saldo masuk sendiri beberapa menit setelah bayar. Halaman ini refresh otomatis.'}
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
                  <div className="text-sm font-medium">{formatRp(t.amount)}</div>
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