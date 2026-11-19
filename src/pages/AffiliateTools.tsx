import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, Input, Label } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  MIN_WITHDRAWAL,
  fetchAffiliate,
  requestWithdrawal,
  type AffiliateData,
  type AffiliateWithdrawal,
} from '@/lib/affiliate'
import { formatRp } from '@/lib/membership'
import {
  Share2,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Wallet,
  Users,
  Banknote,
  ArrowDownToLine,
  Link2,
} from 'lucide-react'

const STATUS_LABEL: Record<AffiliateWithdrawal['status'], string> = {
  pending: 'Menunggu',
  paid: 'Dibayar',
  rejected: 'Ditolak',
}

const STATUS_VARIANT: Record<AffiliateWithdrawal['status'], 'warning' | 'success' | 'destructive'> = {
  pending: 'warning',
  paid: 'success',
  rejected: 'destructive',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

export default function AffiliateToolsPage() {
  const token = useAuthStore((s) => s.token)
  const addToast = useToastStore((s) => s.addToast)

  const [data, setData] = useState<AffiliateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const referralLink = useMemo(() => {
    if (!data?.referralCode || typeof window === 'undefined') return ''
    return `${window.location.origin}/register?ref=${encodeURIComponent(data.referralCode)}`
  }, [data?.referralCode])

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    setError('')
    try {
      setData(await fetchAffiliate(token))
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat data afiliasi')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const copyLink = async () => {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      addToast('Link afiliasi disalin', 'success')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      addToast('Browser menolak akses clipboard — salin manual dari kolom link', 'error')
    }
  }

  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || submitting) return
    const nominal = Number(amount.replace(/[^\d]/g, ''))
    if (!Number.isFinite(nominal) || nominal < MIN_WITHDRAWAL) {
      addToast(`Minimal pencairan ${formatRp(MIN_WITHDRAWAL)}`, 'error')
      return
    }
    if (data && nominal > data.balance) {
      addToast('Nominal melebihi saldo afiliasi kamu', 'error')
      return
    }
    setSubmitting(true)
    try {
      await requestWithdrawal(token, nominal, destination, note)
      addToast('Pengajuan pencairan terkirim — tunggu proses admin', 'success')
      setAmount('')
      setDestination('')
      setNote('')
      await load()
    } catch (err) {
      addToast((err as Error).message || 'Gagal mengajukan pencairan', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const body = () => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat data afiliasi…
        </div>
      )
    }
    if (error || !data) {
      return (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error || 'Data afiliasi tidak tersedia'}</p>
          <Button variant="secondary" size="sm" onClick={() => { setLoading(true); void load() }}>
            <RefreshCw className="mr-2 h-4 w-4" /> Coba lagi
          </Button>
        </div>
      )
    }

    return (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<Wallet className="h-3.5 w-3.5" />} label="Saldo afiliasi" value={formatRp(data.balance)} sub={`Minimal cair ${formatRp(MIN_WITHDRAWAL)}`} />
          <Stat icon={<Banknote className="h-3.5 w-3.5" />} label="Total komisi" value={formatRp(data.totalEarned)} />
          <Stat icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="Sudah dicairkan" value={formatRp(data.totalWithdrawn)} />
          <Stat icon={<Users className="h-3.5 w-3.5" />} label="Join via link" value={String(data.totalReferrals)} sub="Sudah bayar & dapat komisi" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section
            title="Link Afiliasi"
            icon={<Link2 className="h-4 w-4" />}
            sub="Bagikan ke teman. Komisi 25% masuk setelah pembayaran join Pro mereka disetujui."
            right={<Badge variant="default">{data.referralCode}</Badge>}
          >
            <div className="space-y-3">
              <Label htmlFor="affiliate-link">Link referral</Label>
              <div className="flex gap-2">
                <Input id="affiliate-link" readOnly value={referralLink} onFocus={(e) => e.currentTarget.select()} />
                <Button onClick={copyLink} className="shrink-0">
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? 'Tersalin' : 'Salin'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Kode <span className="font-mono">{data.referralCode}</span> bisa juga diketik manual di kolom
                “Kode Referral” saat teman mendaftar.
              </p>
            </div>
          </Section>

          <Section
            title="Cairkan Saldo"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            sub="Pengajuan diproses manual oleh admin. Saldo dikunci saat diajukan."
          >
            <form onSubmit={submitWithdrawal} className="space-y-3">
              <div>
                <Label htmlFor="affiliate-amount">Nominal (Rp)</Label>
                <Input
                  id="affiliate-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder={String(MIN_WITHDRAWAL)}
                />
              </div>
              <div>
                <Label htmlFor="affiliate-destination">Tujuan pencairan</Label>
                <Input
                  id="affiliate-destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="DANA / bank + nomor rekening + nama"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="affiliate-note">Catatan (opsional)</Label>
                <Input
                  id="affiliate-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Contoh: DANA 08xx a.n. Nama"
                  maxLength={300}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || data.balance < MIN_WITHDRAWAL}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownToLine className="mr-2 h-4 w-4" />}
                {data.balance < MIN_WITHDRAWAL ? `Saldo belum mencapai ${formatRp(MIN_WITHDRAWAL)}` : 'Ajukan Pencairan'}
              </Button>
            </form>
          </Section>
        </div>

        <Section title="Riwayat Komisi" icon={<Banknote className="h-4 w-4" />} sub="25% dari biaya join Pro member yang kamu undang">
          {data.commissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Belum ada komisi. Bagikan link afiliasi kamu untuk mulai.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 font-medium">Member</th>
                    <th className="py-2 pr-3 font-medium">Rate</th>
                    <th className="py-2 text-right font-medium">Komisi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commissions.map((c) => (
                    <tr key={c.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-3 text-muted-foreground">{formatDate(c.createdAt)}</td>
                      <td className="py-2.5 pr-3">{c.referredName}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{c.rate}%</td>
                      <td className="py-2.5 text-right font-medium tabular-nums">{formatRp(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Riwayat Pencairan" icon={<ArrowDownToLine className="h-4 w-4" />} sub="Status pengajuan saldo afiliasi kamu">
          {data.withdrawals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pengajuan pencairan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 font-medium">Tujuan</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.withdrawals.map((w) => (
                    <tr key={w.id} className="border-b border-border/60 align-top last:border-0">
                      <td className="py-2.5 pr-3 text-muted-foreground">{formatDate(w.createdAt)}</td>
                      <td className="py-2.5 pr-3">
                        <div>{w.destination}</div>
                        {(w.adminNote || w.note) && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{w.adminNote || w.note}</div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={STATUS_VARIANT[w.status]}>{STATUS_LABEL[w.status]}</Badge>
                      </td>
                      <td className="py-2.5 text-right font-medium tabular-nums">{formatRp(w.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </>
    )
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="AFFILIATE TOOLS"
        title="Affiliate"
        highlight="Tools"
        desc="Undang teman lewat link kamu. Setiap pembayaran join Pro dari link itu memberi komisi 25% ke saldo afiliasi — saldo terpisah yang bisa dicairkan ke DANA atau bank."
      />
      <div className="flex">
        <Badge variant="default" className="gap-1.5 px-3 py-1.5">
          <Share2 className="h-3.5 w-3.5" /> Komisi 25% per join Pro
        </Badge>
      </div>
      {body()}
    </PageContent>
  )
}
