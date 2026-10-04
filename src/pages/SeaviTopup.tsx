import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Wallet, Clock, CheckCircle, XCircle, ExternalLink, Copy, Coins } from 'lucide-react'
import { DANA_NUMBER, DANA_NAME, adminWhatsappLink, formatRp } from '@/lib/payment'
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
}

export default function SeaviTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [packages, setPackages] = useState<SeaviPackage[]>(SEAVI_PACKAGE_FALLBACKS)
  const [tokenPrice, setTokenPrice] = useState(2000)
  const [selectedSlug, setSelectedSlug] = useState<string>(SEAVI_PACKAGE_FALLBACKS[0].slug)
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [topups, setTopups] = useState<Topup[]>([])
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
    if (!selectedPackage) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/topup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ package_slug: selectedPackage.slug, proof_note: proofNote || 'Transfer via DANA' }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Konfirmasi terkirim, tunggu approval admin', 'success')
        setStep('confirm')
        fetchTopups()
        fetchWallet()
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

  return (
    <PageContent>
      <PageHeader
        eyebrow="Seavi"
        title="Top Up"
        highlight="Token"
        desc={`Isi token khusus provider Seavi. Harga: ${formatRp(tokenPrice)}/token — generate 1-2 token tergantung model`}
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
          <div>Model 1 token: <b className="text-foreground">Veo 3.1, Kling 3, Grok, Seedance, Motion Control, Upscale, Image</b></div>
          <div>Model 2 token: <b className="text-foreground">Wan 3.0, Gemini Omni</b></div>
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Paket Token" sub="Minimal Rp 4.000 = 2 token">
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
                  <div className="text-xs text-muted-foreground">Paket</div>
                  <div className="font-bold text-primary text-lg">{selectedPackage.label} — {formatRp(selectedPackage.price)}</div>
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
              Token masuk setelah admin memverifikasi pembayaran.
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
