import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { formatRp, recreateVelianpayQris } from '@/lib/payment'
import { VelianpayCheckoutButton, QrisPanel } from '@/components/QrisPayment'
import { MUSE_MIN_TOPUP } from '@/lib/muse'
import { Wallet, CheckCircle, XCircle, Clock } from 'lucide-react'

interface Topup { id: number; amount: number; status: 'pending' | 'approved' | 'rejected'; created_at: string; amount_total?: number | null }

export default function MuseTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [balance, setBalance] = useState(0)
  const [topups, setTopups] = useState<Topup[]>([])
  const [amount, setAmount] = useState(20000)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState<Topup | null>(null)
  const [velianpay, setVelianpay] = useState<{ checkout_url?: string; payable_amount?: number; qris_image?: string } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [step, setStep] = useState<'select' | 'pay'>('select')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [b, t] = await Promise.all([
        fetch('/api/muse/balance', { headers }).then((r) => r.json()),
        fetch('/api/muse/topups/mine', { headers }).then((r) => r.json()),
      ])
      setBalance(b.balance || 0); setTopups(t.topups || [])
    } catch { /* ignore */ }
  }, [token])

  useEffect(() => { void load() }, [load])
  const pending = topups.some((t) => t.status === 'pending')
  useEffect(() => {
    if (!pending && step === 'select') return
    const timer = setInterval(() => void load(), 8000)
    return () => clearInterval(timer)
  }, [pending, step, load])

  const submit = async () => {
    if (!amount || amount < MUSE_MIN_TOPUP) { addToast(`Minimal ${formatRp(MUSE_MIN_TOPUP)}`, 'error'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/muse/topup', { method: 'POST', headers, body: JSON.stringify({ amount }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Gagal')
      setSubmitted(d.topup); setVelianpay(d.velianpay); setStep('pay')
      addToast('Topup diajukan', 'success'); void load()
    } catch (e: any) { addToast(e?.message || 'Gagal', 'error') } finally { setLoading(false) }
  }

  const retry = async () => {
    if (!token || !submitted || retrying) return
    setRetrying(true)
    const bp = await recreateVelianpayQris(token, 'muse_topup', submitted.id)
    setRetrying(false)
    if (bp) { setVelianpay(bp); addToast('QRIS siap', 'success') } else addToast('QRIS gagal — coba lagi', 'error')
  }

  const badge = (s: string) => s === 'approved'
    ? <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" />Lunas</Badge>
    : s === 'rejected' ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Ditolak</Badge>
      : <Badge variant="warning"><Clock className="mr-1 h-3 w-3" />Pending</Badge>

  return (
    <PageContent>
      <PageHeader eyebrow="MUSEAI" title="Top Up" highlight="Saldo" desc="Isi saldo MuseAI untuk chat, gambar, dan video." />
      <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10"><Wallet className="h-6 w-6 text-primary" /></div>
          <div><div className="text-xs text-muted-foreground">Saldo MuseAI</div><div className="text-2xl font-bold">{formatRp(balance)}</div></div>
        </div>
      </div>

      {step === 'select' && (
        <Section title="Pilih Nominal" sub={`Minimal ${formatRp(MUSE_MIN_TOPUP)}`}>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[10000, 20000, 50000, 100000].map((n) => (
              <button key={n} onClick={() => setAmount(n)} className={`rounded-xl border-2 p-4 text-center ${amount === n ? 'border-primary bg-primary/5' : 'border-border'}`}>{formatRp(n)}</button>
            ))}
          </div>
          <input type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            className="mb-4 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm" />
          <Button className="w-full" onClick={submit} disabled={loading}>{loading ? 'Memproses…' : `Top Up ${formatRp(amount)}`}</Button>
        </Section>
      )}
      {step === 'pay' && (
        <Section title="Bayar via QRIS VelianPay" sub="Klik Bayar → checkout, saldo otomatis masuk saat lunas">
          <VelianpayCheckoutButton url={velianpay?.checkout_url} payable={velianpay?.payable_amount} image={velianpay?.qris_image} />
          {!(velianpay?.checkout_url || velianpay?.qris_image) && <QrisPanel exactAmount={submitted?.amount_total ?? undefined} onRetry={retry} retrying={retrying} />}
          <Button variant="outline" className="mt-3" onClick={() => setStep('select')}>Kembali</Button>
        </Section>
      )}
      <Section title="Riwayat Top Up">
        {topups.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Belum ada.</p> : (
          <div className="space-y-2">
            {topups.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div><div className="text-sm font-medium">{formatRp(t.amount)}</div><div className="text-[11px] text-muted-foreground">{new Date(t.created_at).toLocaleString('id-ID')}</div></div>
                {badge(t.status)}
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
