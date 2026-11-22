import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { formatRp, recreateBasunipayQris } from '@/lib/payment'
import { BasunipayCheckoutButton, QrisPanel } from '@/components/QrisPayment'
import { useTiktokPricing, ttModelPrice, TIKTOK_MIN_TOPUP } from '@/lib/tiktokSymphony'
import { Wallet, Clock, CheckCircle, XCircle } from 'lucide-react'

const NOMINALS = [10000, 20000, 50000, 100000]
const API = '/api/tiktok-symphony'

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proof_note: string
  admin_note: string
  created_at: string
  amount_total?: number | null
}

export default function TiktokTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const pricing = useTiktokPricing()

  const [balance, setBalance] = useState(0)
  const [topups, setTopups] = useState<Topup[]>([])
  const [selected, setSelected] = useState(TIKTOK_MIN_TOPUP)
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState<Topup | null>(null)
  const [basunipay, setBasunipay] = useState<{ checkout_url?: string; payable_amount?: number; qris_image?: string } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [step, setStep] = useState<'select' | 'pay'>('select')

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [b, t] = await Promise.all([
        fetch(`${API}/balance`, { headers }).then((r) => r.json()),
        fetch(`${API}/topups/mine`, { headers }).then((r) => r.json()),
      ])
      setBalance(b.balance || 0)
      setTopups(t.topups || [])
    } catch { /* ignore */ }
  }, [token])

  useEffect(() => { void load() }, [load])
  const adaPending = topups.some((t) => t.status === 'pending')
  useEffect(() => {
    if (!adaPending && step === 'select') return
    const timer = setInterval(() => void load(), 8000)
    return () => clearInterval(timer)
  }, [adaPending, step, load])

  const submit = async () => {
    const amount = custom ? parseInt(custom) : selected
    if (!amount || amount < TIKTOK_MIN_TOPUP) {
      addToast(`Minimal topup ${formatRp(TIKTOK_MIN_TOPUP)}`, 'error')
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
      if (!res.ok) throw new Error(data.error || 'Gagal')
      setSubmitted(data.topup || null)
      setBasunipay(data.basunipay || null)
      setStep('pay')
      addToast('Topup diajukan', 'success')
      void load()
    } catch (e: any) {
      addToast(e?.message || 'Gagal', 'error')
    } finally {
      setLoading(false)
    }
  }

  const retryQris = async () => {
    if (!token || !submitted || retrying) return
    setRetrying(true)
    const bp = await recreateBasunipayQris(token, 'tiktok_topup', submitted.id)
    setRetrying(false)
    if (bp) {
      setBasunipay(bp)
      addToast('QRIS BasuNiPay siap', 'success')
    } else {
      addToast('QRIS masih gagal disiapkan — coba lagi', 'error')
    }
  }

  const statusBadge = (s: string) => s === 'approved'
    ? <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" /> Lunas</Badge>
    : s === 'rejected'
      ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Ditolak</Badge>
      : <Badge variant="warning"><Clock className="mr-1 h-3 w-3" /> Pending</Badge>

  return (
    <PageContent>
      <PageHeader
        eyebrow="TIKTOK SYMPHONY"
        title="Top Up"
        highlight="Saldo"
        desc={`Isi saldo khusus TikTok Symphony. Seedance 2.0 Fast: ${formatRp(ttModelPrice(pricing, 'SEEDANCE_2_0_FAST'))}/generate.`}
      />

      <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10"><Wallet className="h-6 w-6 text-primary" /></div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo TikTok Symphony</div>
            <div className="text-2xl font-bold">{formatRp(balance)}</div>
          </div>
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Nominal" sub={`Minimal ${formatRp(TIKTOK_MIN_TOPUP)}`}>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NOMINALS.map((n) => (
              <button key={n} onClick={() => { setSelected(n); setCustom('') }}
                className={`rounded-xl border-2 p-4 text-center transition ${selected === n && !custom ? 'border-primary bg-primary/5' : 'border-border'}`}>
                {formatRp(n)}
              </button>
            ))}
          </div>
          <input type="number" value={custom} onChange={(e) => setCustom(e.target.value)}
            placeholder={`Atau nominal lain (min ${TIKTOK_MIN_TOPUP})`}
            className="mb-4 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm" />
          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? 'Memproses…' : `Top Up ${formatRp(custom ? parseInt(custom) || 0 : selected)}`}
          </Button>
        </Section>
      )}

      {step === 'pay' && (
        <Section title="Bayar via QRIS BasuNiPay" sub="Klik Bayar → checkout BasuNiPay, saldo otomatis masuk saat lunas">
          <BasunipayCheckoutButton url={basunipay?.checkout_url} payable={basunipay?.payable_amount} image={basunipay?.qris_image} />
          {!(basunipay?.checkout_url || basunipay?.qris_image) && (
            <QrisPanel exactAmount={submitted?.amount_total ?? undefined} onRetry={retryQris} retrying={retrying} />
          )}
          <Button variant="outline" onClick={() => setStep('select')} className="mt-3">Kembali</Button>
        </Section>
      )}

      <Section title="Riwayat Top Up" sub="Status diperbarui otomatis">
        {topups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada top up.</p>
        ) : (
          <div className="space-y-2">
            {topups.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div>
                  <div className="text-sm font-medium">{formatRp(t.amount)}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(t.created_at).toLocaleString('id-ID')}</div>
                </div>
                {statusBadge(t.status)}
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
