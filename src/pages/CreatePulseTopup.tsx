import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Copy } from 'lucide-react'

const NOMINALS = [10000, 15000, 20000, 25000, 50000, 100000]
const DANA_NUMBER = '082280204445'
const DANA_NAME = 'Yusuf Prihandoko'
const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20top%20up%20saldo'

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proof_note: string
  admin_note: string
  created_at: string
}

export default function CreatePulseTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [selectedAmount, setSelectedAmount] = useState<number>(10000)
  const [customAmount, setCustomAmount] = useState('')
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')

  const API = '/api/createpulse'

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch(`${API}/balance`, { headers })
      const data = await res.json()
      setBalance(data.balance || 0)
    } catch {}
  }, [headers])

  const fetchTopups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/topups/mine`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch {}
  }, [headers])

  useEffect(() => {
    fetchBalance()
    fetchTopups()
  }, [fetchBalance, fetchTopups])

  const handleTopup = async () => {
    const amount = customAmount ? parseInt(customAmount) : selectedAmount
    if (!amount || amount < 10000) {
      addToast('Minimal topup Rp 10.000', 'error')
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
        addToast(`Topup Rp ${amount.toLocaleString('id-ID')} diajukan`, 'success')
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
    const amount = customAmount ? parseInt(customAmount) : selectedAmount
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

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

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
        eyebrow="CreatePulse"
        title="Top Up"
        highlight="Saldo"
        desc="Isi saldo khusus provider CreatePulse. Harga: Rp 1.500-2.250/generate"
      />

      {/* Balance */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo CreatePulse</div>
            <div className="text-2xl font-bold">{formatRp(balance)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div>Dreamina Seedance 2.0: <b className="text-foreground">{formatRp(1500)}/generate</b></div>
          <div>Veo Omni 10s: <b className="text-foreground">{formatRp(1500)}/generate</b></div>
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Nominal Top Up" sub="Minimal Rp 10.000">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {NOMINALS.map((n) => (
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
            <label className="text-sm font-medium mb-1 block">Atau nominal lain (min Rp 10.000)</label>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Masukkan nominal..."
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleTopup} disabled={loading} className="w-full">
            {loading ? 'Memproses...' : `Top Up ${formatRp(customAmount ? parseInt(customAmount) || 0 : selectedAmount)}`}
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
                  <div className="font-bold text-primary text-lg">{formatRp(customAmount ? parseInt(customAmount) || 0 : selectedAmount)}</div>
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
              Topup kamu akan disetujui setelah admin memverifikasi pembayaran.
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
