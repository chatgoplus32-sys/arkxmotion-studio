import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, Input, Select, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { DANA_NAME, DANA_NUMBER, adminWhatsappLink, formatRp } from '@/lib/payment'
import { PaymentMethodToggle, QrisPanel } from '@/components/QrisPayment'
import {
  MANUAL_PROVIDERS,
  MANUAL_TOPUP_MAX,
  MANUAL_TOPUP_MIN,
  MANUAL_TOPUP_NOMINALS,
  manualProviderLabel,
  type ManualTopupRequest,
} from '@/lib/manualTopup'
import { CheckCircle, Clock, Copy, ExternalLink, Loader2, RefreshCw, Wallet, XCircle } from 'lucide-react'

function statusBadge(status: ManualTopupRequest['status']) {
  if (status === 'approved') {
    return (
      <Badge variant="success">
        <CheckCircle className="mr-1 h-3 w-3" /> Selesai
      </Badge>
    )
  }
  if (status === 'rejected') {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" /> Ditolak
      </Badge>
    )
  }
  return (
    <Badge variant="warning">
      <Clock className="mr-1 h-3 w-3" /> Menunggu
    </Badge>
  )
}

export default function ManualTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [params] = useSearchParams()
  const paramProvider = (params.get('provider') || '').trim().toLowerCase()

  // Provider dari tombol di halaman Providers boleh apa saja — kalau belum ada
  // di daftar, tetap ditampilkan supaya member tidak kehilangan konteks.
  const providerOptions = useMemo<{ value: string; label: string }[]>(() => {
    const options: { value: string; label: string }[] = MANUAL_PROVIDERS.map((p) => ({ value: p.key, label: p.label }))
    if (paramProvider && !options.some((o) => o.value === paramProvider)) {
      options.unshift({ value: paramProvider, label: paramProvider })
    }
    return options
  }, [paramProvider])

  const [provider, setProvider] = useState(paramProvider || 'roboneo')
  // Halaman bisa tetap ter-mount saat member pindah provider dari halaman
  // Providers; ikuti parameter URL terbaru.
  useEffect(() => {
    if (paramProvider) setProvider(paramProvider)
  }, [paramProvider])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [payMethod, setPayMethod] = useState<'dana' | 'qris'>('dana')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState<ManualTopupRequest[]>([])
  const [lastSubmitted, setLastSubmitted] = useState<ManualTopupRequest | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/provider-topup/mine', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (res.ok) setRequests(data.requests || [])
    } catch (e) {
      console.warn('[ManualTopup] gagal memuat riwayat:', e)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const nominal = Math.round(Number(amount))
  const nominalValid = Number.isFinite(nominal) && nominal >= MANUAL_TOPUP_MIN && nominal <= MANUAL_TOPUP_MAX

  const handleSubmit = async () => {
    if (!nominalValid) {
      addToast(`Nominal Rp ${MANUAL_TOPUP_MIN.toLocaleString('id-ID')}–Rp ${MANUAL_TOPUP_MAX.toLocaleString('id-ID')}`, 'error')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/provider-topup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, amount: nominal, note }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Permintaan terkirim', 'success')
        setRequests((prev) => [data.request, ...prev])
        setLastSubmitted(data.request)
        setAmount('')
        setNote('')
      } else {
        addToast(data.error || 'Gagal mengirim permintaan', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setSubmitting(false)
  }

  const waMessage = adminWhatsappLink(
    `Halo admin, saya sudah ajukan top up manual ${manualProviderLabel(provider)} ${formatRp(nominal || 0)}. Mohon diverifikasi.`,
  )

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(DANA_NUMBER)
    addToast('Nomor DANA disalin', 'success')
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Marketplace"
        title="Top Up"
        highlight="Manual"
        desc="Untuk provider tanpa dompet otomatis — diverifikasi admin"
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section title="📝 Ajukan Top Up Manual" sub="Pilih provider dan nominal, lalu bayar lewat DANA atau QRIS.">
            <div className="space-y-4">
              <div>
                <label htmlFor="manual-provider" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Provider
                </label>
                <Select
                  id="manual-provider"
                  options={providerOptions}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="manual-amount" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Nominal (Rp)
                </label>
                <Input
                  id="manual-amount"
                  type="number"
                  inputMode="numeric"
                  min={MANUAL_TOPUP_MIN}
                  max={MANUAL_TOPUP_MAX}
                  step={1000}
                  placeholder={`Minimal ${formatRp(MANUAL_TOPUP_MIN)}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {MANUAL_TOPUP_NOMINALS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAmount(String(value))}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                        nominal === value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-accent/40'
                      }`}
                    >
                      {formatRp(value)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Pembayaran</div>
                <PaymentMethodToggle value={payMethod} onChange={setPayMethod} />
                {payMethod === 'dana' ? (
                  <div className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="text-sm font-medium">Transfer DANA</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-mono text-lg font-bold">{DANA_NUMBER}</div>
                        <div className="text-xs text-muted-foreground">a.n. {DANA_NAME}</div>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={handleCopyNumber}>
                        <Copy className="h-3.5 w-3.5" /> Salin
                      </Button>
                    </div>
                    {nominalValid && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Transfer tepat <span className="font-semibold text-foreground">{formatRp(nominal)}</span>.
                      </p>
                    )}
                  </div>
                ) : (
                  <QrisPanel amountLabel={nominalValid ? formatRp(nominal) : undefined} />
                )}
              </div>

              <div>
                <label htmlFor="manual-note" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Catatan / bukti transfer (opsional)
                </label>
                <Textarea
                  id="manual-note"
                  rows={3}
                  maxLength={300}
                  placeholder="Contoh: transfer DANA Rp 50.000 a.n. Budi, jam 14.20"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <Button className="w-full" onClick={handleSubmit} loading={submitting} disabled={!nominalValid}>
                <Wallet className="h-4 w-4" />
                Ajukan Top Up
              </Button>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Provider ini memakai kunci milikmu sendiri, jadi tidak ada saldo yang dikreditkan otomatis.
                Setelah pembayaran diverifikasi, admin menyerahkan kunci/saldo provider dan menandai permintaan selesai.
              </p>

              {lastSubmitted && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <div className="text-sm font-semibold text-emerald-500">
                    Permintaan #{lastSubmitted.id} terkirim
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {manualProviderLabel(lastSubmitted.provider)} · {formatRp(lastSubmitted.amount)} — menunggu verifikasi admin.
                  </p>
                  <a
                    href={waMessage}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Konfirmasi ke admin via WhatsApp
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section
            title="Riwayat Permintaan"
            sub="Status diverifikasi manual oleh admin."
            right={
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Muat ulang
              </button>
            }
          >
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
              </div>
            ) : requests.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada permintaan.</p>
            ) : (
              <ul className="space-y-2.5">
                {requests.map((r) => (
                  <li key={r.id} className="rounded-xl border border-border bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{manualProviderLabel(r.provider)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{formatRp(r.amount)}</div>
                      </div>
                      {statusBadge(r.status)}
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                    </div>
                    {r.note && <div className="mt-1 text-[11px] italic text-muted-foreground">{r.note}</div>}
                    {r.admin_note && (
                      <div className="mt-1 rounded-lg bg-secondary/60 px-2 py-1 text-[11px] text-muted-foreground">
                        Admin: {r.admin_note}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
