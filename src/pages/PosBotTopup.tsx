import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Copy } from 'lucide-react'
import { DANA_NUMBER, DANA_NAME, adminWhatsappLink, formatRp } from '@/lib/payment'
import { PaymentMethodToggle, QrisPanel } from '@/components/QrisPayment'
import { fetchPosbotWallet, POSBOT_PRESET_FALLBACKS } from '@/lib/posbotWallet'

const WHATSAPP_LINK = adminWhatsappLink('Halo saya ingin top up saldo PosBot')

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

export default function PosBotTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [presets, setPresets] = useState<number[]>(POSBOT_PRESET_FALLBACKS)
  const [minTopup, setMinTopup] = useState(10000)
  const [maxTopup, setMaxTopup] = useState(5000000)
  // Kelayakan kunci server dari server (top up / admin) — bukan tebakan browser.
  const [serverKey, setServerKey] = useState<{ available: boolean; reason?: string } | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number>(POSBOT_PRESET_FALLBACKS[0])
  const [customAmount, setCustomAmount] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [payMethod, setPayMethod] = useState<'dana' | 'qris'>('dana')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [submitted, setSubmitted] = useState<Topup | null>(null)
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')

  const API = '/api/posbot'

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const amount = customAmount ? parseInt(customAmount, 10) : selectedAmount

  const fetchWallet = useCallback(async () => {
    if (!token) return
    try {
      const w = await fetchPosbotWallet(token)
      if (w) {
        setBalance(w.balance)
        setPresets(w.presets.length > 0 ? w.presets : POSBOT_PRESET_FALLBACKS)
        setMinTopup(w.min_topup)
        setMaxTopup(w.max_topup)
        setServerKey(w.server_key ?? null)
      }
    } catch (e) { console.warn('[PosBotTopup] Failed to fetch wallet:', e) }
  }, [token])

  const fetchTopups = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch (e) { console.warn('[PosBotTopup] Failed to fetch topups:', e) }
  }, [headers, token])

  useEffect(() => {
    fetchWallet()
    fetchTopups()
  }, [fetchWallet, fetchTopups])

  const submitTopup = async (note: string, next: 'pay' | 'confirm') => {
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
        if (next === 'pay') {
          // Simpan baris yang diajukan — amount_total adalah nominal yang
          // harus dibayar dan yang dicocokkan parser email.
          setSubmitted(data.topup || null)
          addToast(`Topup ${formatRp(amount)} diajukan`, 'success')
          setStep('pay')
          fetchTopups()
        } else {
          // Baris sudah dibuat di langkah pertama — tidak perlu pengajuan kedua.
          addToast('Konfirmasi terkirim', 'success')
          setStep('confirm')
          fetchTopups()
          fetchWallet()
        }
      } else {
        addToast(data.error || 'Gagal', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setLoading(false)
  }

  const handleTopup = () => submitTopup(proofNote, 'pay')
  const handleConfirmTransfer = () => submitTopup(proofNote || 'Transfer via DANA', 'confirm')

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

  return (
    <PageContent>
      <PageHeader
        eyebrow="PosBot"
        title="Top Up"
        highlight="Saldo"
        desc="Isi saldo Rupiah khusus provider PosBot. Dipotong per generate sesuai tarif model."
      />

      {/* Balance */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo PosBot</div>
            <div className="text-2xl font-bold">{formatRp(balance)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>Gambar: <b className="text-foreground">{formatRp(350)}/generate</b></div>
          <div>Video: <b className="text-foreground">{formatRp(1000)}–{formatRp(6500)}/generate</b></div>
        </div>
        <div className="mt-3 text-[11px] leading-relaxed">
          {serverKey?.available ? (
            <span className="text-emerald-500">
              ✓ Setelah saldo masuk, generate langsung jalan tanpa API key — relay memakai kunci server PosBot dan
              saldo ini yang dipotong.
            </span>
          ) : (
            <span className="text-muted-foreground">
              {serverKey?.reason || 'Kunci server PosBot belum diatur admin — generate membutuhkan API key PosBot sendiri di halaman Providers.'}
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
          title={payMethod === 'qris' ? 'Pembayaran via QRIS' : 'Pembayaran via DANA'}
          sub={payMethod === 'qris' ? 'Scan QRIS di bawah untuk bayar' : 'Transfer ke nomor DANA berikut'}
        >
          <PaymentMethodToggle value={payMethod} onChange={setPayMethod} />

          {payMethod === 'qris' && (
            <QrisPanel
              amountLabel={formatRp(Number.isInteger(amount) ? amount : 0)}
              exactAmount={submitted?.amount_total ?? undefined}
            />
          )}

          {payMethod === 'dana' && (
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
              <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                <div>
                  <div className="text-xs text-muted-foreground">Atas Nama</div>
                  <div className="font-medium">{DANA_NAME}</div>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                <div>
                  <div className="text-xs text-muted-foreground">Jumlah Transfer</div>
                  <div className="font-bold text-amber-400 text-lg">
                    {formatRp(submitted?.amount_total ?? (Number.isInteger(amount) ? amount : 0))}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Termasuk kode unik — jangan dibulatkan</div>
                </div>
              </div>
            </div>
          </div>
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
              {loading ? 'Mengirim...' : payMethod === 'qris' ? 'Sudah Bayar' : 'Sudah Transfer'}
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
        <Section title="Menunggu Approval" sub="Topup kamu sedang diproses admin">
          <div className="text-center py-8">
            <div className="text-5xl mb-4">⏳</div>
            <div className="text-lg font-medium mb-2">Menunggu Approval Admin</div>
            <div className="text-sm text-muted-foreground mb-4">
              Saldo masuk setelah admin memverifikasi pembayaran.
              <br />Hubungi admin jika sudah transfer.
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
                Kembali ke Top Up
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
