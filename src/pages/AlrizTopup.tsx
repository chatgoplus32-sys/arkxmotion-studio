import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Copy, Film } from 'lucide-react'
import { DANA_NUMBER, DANA_NAME, adminWhatsappLink, formatRp } from '@/lib/payment'
import {
  fetchAlrizWallet,
  ALRIZ_NOMINALS_FALLBACK,
  ALRIZ_MIN_TOPUP_FALLBACK,
  ALRIZ_MAX_TOPUP_FALLBACK,
} from '@/lib/alrizWallet'

const WHATSAPP_LINK = adminWhatsappLink('Halo saya ingin top up saldo Alriz Motion')

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proof_note: string
  admin_note: string
  created_at: string
}

export default function AlrizTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [minTopup, setMinTopup] = useState(ALRIZ_MIN_TOPUP_FALLBACK)
  const [maxTopup, setMaxTopup] = useState(ALRIZ_MAX_TOPUP_FALLBACK)
  const [nominals, setNominals] = useState<number[]>(ALRIZ_NOMINALS_FALLBACK)
  const [modelPrices, setModelPrices] = useState<Record<string, number>>({})
  const [selectedAmount, setSelectedAmount] = useState<number>(ALRIZ_NOMINALS_FALLBACK[0])
  const [customAmount, setCustomAmount] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')

  const API = '/api/alriz'

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const amount = customAmount ? parseInt(customAmount, 10) : selectedAmount

  const fetchBalance = useCallback(async () => {
    try {
      const w = await fetchAlrizWallet(token || '')
      if (!w) return
      setBalance(w.balance)
      setMinTopup(w.min_topup)
      setMaxTopup(w.max_topup)
      setNominals(w.nominals.length > 0 ? w.nominals : ALRIZ_NOMINALS_FALLBACK)
      setModelPrices(w.models)
      if (!w.nominals.includes(selectedAmount) && w.nominals.length > 0) {
        setSelectedAmount(w.nominals[0])
      }
    } catch (e) { console.warn('[AlrizTopup] Failed to fetch balance:', e) }
  }, [token, selectedAmount])

  const fetchTopups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch (e) { console.warn('[AlrizTopup] Failed to fetch topups:', e) }
  }, [headers])

  useEffect(() => {
    fetchBalance()
    fetchTopups()
  }, [fetchBalance, fetchTopups])

  const validAmount = Number.isInteger(amount) && amount >= minTopup && amount <= maxTopup

  const handleTopup = async () => {
    if (!validAmount) {
      addToast(`Nominal harus ${formatRp(minTopup)}–${formatRp(maxTopup)}`, 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API}/topup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, proof_note: proofNote }),
      })
      const data = await res.json()
      if (res.ok) {
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

  const handleConfirmTransfer = async () => {
    if (!validAmount) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/topup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount, proof_note: proofNote || 'Transfer via DANA' }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Konfirmasi terkirim, tunggu approval admin', 'success')
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

  const modelLabels: Record<string, string> = {
    'mc-kling-2.6-std': 'Kling 2.6 Std · 720p',
    'mc-kling-3.0-std': 'Kling 3.0 Std · 720p',
    'mc-kling-2.6-pro': 'Kling 2.6 Pro · 1080p',
    'mc-kling-3.0-pro': 'Kling 3.0 Pro · 1080p',
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Alriz Motion"
        title="Top Up"
        highlight="Saldo"
        desc={`Isi saldo khusus provider Alriz Motion (Kling Motion Control). Harga: ${formatRp(750)}–${formatRp(1750)}/video`}
      />

      {/* Balance */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo Alriz Motion</div>
            <div className="text-2xl font-bold">{formatRp(balance)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          {Object.entries(modelPrices).length > 0 ? (
            Object.entries(modelPrices).map(([id, price]) => (
              <div key={id}>{modelLabels[id] || id}: <b className="text-foreground">{formatRp(price)}/video</b></div>
            ))
          ) : (
            <>
              <div>MC 2.6 Std / 3.0 Std: <b className="text-foreground">{formatRp(750)}–{formatRp(1000)}/video</b></div>
              <div>MC 2.6 Pro / 3.0 Pro: <b className="text-foreground">{formatRp(1500)}–{formatRp(1750)}/video</b></div>
            </>
          )}
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Nominal Top Up" sub={`Minimal ${formatRp(minTopup)} · Maksimal ${formatRp(maxTopup)}`}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {nominals.map((n) => (
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
            <label className="text-sm font-medium mb-1 block">
              Atau nominal lain ({formatRp(minTopup)}–{formatRp(maxTopup)})
            </label>
            <input
              type="number"
              value={customAmount}
              min={minTopup}
              max={maxTopup}
              step={1000}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Masukkan nominal..."
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
            {customAmount && !validAmount && (
              <div className="text-[11px] text-red-500 mt-1">
                Nominal harus bulat {formatRp(minTopup)}–{formatRp(maxTopup)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mb-4 text-[11px] text-muted-foreground">
            <Film className="h-3.5 w-3.5" />
            Saldo dipotong otomatis per video saat generate (mis. {formatRp(750)} untuk MC 2.6 Std)
          </div>
          <Button onClick={handleTopup} disabled={loading || !validAmount} className="w-full">
            {loading ? 'Memproses...' : validAmount ? `Top Up ${formatRp(amount)}` : `Top Up (pilih nominal ${formatRp(minTopup)}–${formatRp(maxTopup)})`}
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
              <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                <div>
                  <div className="text-xs text-muted-foreground">Atas Nama</div>
                  <div className="font-medium">{DANA_NAME}</div>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                <div>
                  <div className="text-xs text-muted-foreground">Jumlah Transfer</div>
                  <div className="font-bold text-primary text-lg">{formatRp(amount)}</div>
                </div>
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
            <Button variant="outline" onClick={() => setStep('select')} className="flex-1">
              Kembali
            </Button>
            <Button onClick={handleConfirmTransfer} disabled={loading} className="flex-1">
              {loading ? 'Mengirim...' : 'Sudah Transfer'}
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
              <Button variant="outline" onClick={() => { setStep('select'); fetchBalance(); fetchTopups() }}>
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
