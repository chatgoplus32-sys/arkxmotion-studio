import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { QRIS_IMG, formatRp } from '@/lib/membership'
import {
  DEFAULT_PRO_FEE,
  buildProWaPaymentUrl,
  fetchProStatus,
  getProFee,
  submitProPayment,
  type ProStatus,
} from '@/lib/pro'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Crown,
  Loader2,
  Lock,
  MessageCircle,
  Music,
  RefreshCw,
  Sparkles,
  Wand2,
  XCircle,
} from 'lucide-react'

const BENEFITS = [
  { icon: Wand2, title: 'Gemini Tools terbuka', desc: 'Edit Video Auto Motion, UGC Pro, dan Storyboard V7 lengkap dengan prompt template.' },
  { icon: Music, title: 'AI Song Cover & H3 Music Avatar', desc: 'Buat cover lagu dan avatar musik yang berbicara dari foto.' },
  { icon: Sparkles, title: 'Fitur AI lain tetap terbuka', desc: 'Motion Control, Image to Video, Virtual Try-On, Voice Over, Music Generator, dan lainnya.' },
  { icon: Crown, title: 'Sekali bayar, permanen', desc: 'Tidak ada perpanjangan bulanan. Pro aktif selamanya setelah disetujui.' },
]

const STEPS = [
  { title: 'Scan & bayar', desc: 'Bayar sesuai nominal lewat QRIS ARKXMotion Studio.' },
  { title: 'Kirim konfirmasi', desc: 'Isi catatan pembayaran lalu kirim konfirmasi dari halaman ini.' },
  { title: 'Admin aktifkan', desc: 'Setelah pembayaran dicek, akun otomatis jadi Pro dan tiga fitur premium terbuka.' },
]

function formatDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'none') {
    return <span className="text-[11px] text-muted-foreground">Belum ada pembayaran</span>
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-emerald-500/10 text-emerald-500">
        <CheckCircle2 className="h-3 w-3" /> Disetujui
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-red-500/10 text-red-500">
        <XCircle className="h-3 w-3" /> Ditolak
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-yellow-500/10 text-yellow-500">
      <Clock className="h-3 w-3" /> Menunggu approval
    </span>
  )
}

export default function UpgradeProPage() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const addToast = useToastStore((s) => s.addToast)

  const [status, setStatus] = useState<ProStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [fee, setFee] = useState(DEFAULT_PRO_FEE)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const syncedProRef = useRef(false)

  const isPro = status?.plan === 'pro' || user?.role === 'admin' || user?.plan === 'pro'
  const pendingPayment = status?.payment?.status === 'pending' ? status.payment : null

  const loadStatus = useCallback(async () => {
    if (!token) { setLoading(false); return }
    try {
      const next = await fetchProStatus(token)
      setStatus(next)
      if (next.plan === 'pro' && user?.plan !== 'pro' && !syncedProRef.current) {
        syncedProRef.current = true
        await checkAuth()
      }
    } catch (e: any) {
      addToast(e?.message || 'Gagal memuat status Pro', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, user?.plan, checkAuth, addToast])

  useEffect(() => {
    getProFee().then(setFee).catch(() => {})
    loadStatus()
  }, [loadStatus])

  // Selama menunggu approval, cek berkala supaya halaman langsung berubah Pro
  // begitu admin menyetujui — tanpa user harus logout/login.
  useEffect(() => {
    if (!pendingPayment) return
    const timer = setInterval(loadStatus, 10000)
    return () => clearInterval(timer)
  }, [pendingPayment, loadStatus])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setSubmitting(true)
    try {
      const data = await submitProPayment(token, note)
      setStatus((prev) => ({
        plan: prev?.plan ?? 'free',
        isAdmin: prev?.isAdmin ?? false,
        proSince: prev?.proSince ?? null,
        payment: data.payment,
      }))
      setNote('')
      addToast('Konfirmasi terkirim — admin akan mengaktifkan Pro kamu', 'success')
    } catch (e: any) {
      addToast(e?.message || 'Gagal mengirim konfirmasi', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openWaConfirm = () => {
    if (!user) return
    const url = buildProWaPaymentUrl({ name: user.name, email: user.email, note: status?.payment?.proofNote, fee })
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return (
      <PageContent>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </PageContent>
    )
  }

  if (isPro) {
    return (
      <PageContent>
        <PageHeader
          eyebrow="ARKXMOTION PRO"
          title="Akun Kamu"
          highlight="Pro"
          desc="Semua fitur premium ARKXMotion Studio sudah terbuka untuk akun ini."
        />
        <Section className="max-w-2xl">
          <div className="flex flex-col items-center text-center py-6">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Crown className="h-8 w-8" />
            </div>
            <div className="text-xl font-display font-bold">Selamat, kamu Pro!</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {status?.isAdmin || user?.role === 'admin'
                ? 'Sebagai admin, kamu otomatis punya akses ke semua fitur Pro.'
                : `Upgrade Pro sudah aktif${status?.proSince ? ` sejak ${formatDate(status.proSince)}` : ''}. Gemini Tools, AI Song Cover, dan H3 Music Avatar sudah terbuka.`}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
              <Link to="/tools/gemini-tools">
                <Button>
                  <Wand2 className="h-4 w-4" /> Buka Gemini Tools <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/dashboard">
                <Button variant="outline">Kembali ke Dashboard</Button>
              </Link>
            </div>
          </div>
        </Section>
      </PageContent>
    )
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="ARKXMOTION PRO"
        title="Upgrade"
        highlight="Pro"
        desc="Membuka Gemini Tools, AI Song Cover, dan H3 Music Avatar. Khusus member lama — fitur AI lainnya tetap terbuka, sekali bayar, berlaku permanen."
        actions={
          <Button variant="outline" onClick={loadStatus}>
            <RefreshCw className="h-4 w-4" /> Cek Status
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Section title="⭐ Yang kamu dapat" sub="Akses ke tiga fitur premium ARKXMotion Studio">
            <div className="space-y-4">
              {BENEFITS.map((b) => (
                <div key={b.title} className="flex gap-3 items-start">
                  <div className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <b.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{b.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="🚀 Cara upgrade" sub="Tiga langkah, tanpa langganan bulanan">
            <div className="space-y-4">
              {STEPS.map((s, i) => (
                <div key={s.title} className="flex gap-3 items-start">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-secondary text-foreground text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <Section
          title="💳 Pembayaran Upgrade Pro"
          sub="Khusus member lama — bayar via QRIS, lalu kirim konfirmasi"
          right={<StatusBadge status={status?.payment?.status ?? 'none'} />}
        >
          <div className="flex items-baseline justify-between rounded-xl bg-secondary/50 border border-border px-4 py-3 mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Harga Pro</div>
              <div className="text-2xl font-bold brand-text">{formatRp(fee)}</div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              khusus member lama
              <br />
              sekali bayar · permanen
            </div>
          </div>

          {status?.payment && status.payment.status !== 'rejected' && (
            <div className="rounded-xl border border-border bg-secondary/30 p-3 mb-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Konfirmasi terakhir</span>
                <span className="font-mono text-xs">{formatRp(status.payment.amount)}</span>
              </div>
              <div className="mt-2"><StatusBadge status={status.payment.status} /></div>
              {status.payment.proofNote && (
                <p className="text-xs text-muted-foreground mt-2">Catatan: {status.payment.proofNote}</p>
              )}
              {status.payment.status === 'approved' && (
                <p className="text-xs text-emerald-500 mt-2">Pembayaran diterima. Muat ulang status untuk melihat akses Pro.</p>
              )}
            </div>
          )}

          {pendingPayment ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
                <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-yellow-500">Menunggu approval admin</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pembayaran kamu sudah dicatat. Admin akan mengaktifkan Pro setelah mengecek pembayaran.
                    Halaman ini mengecek status otomatis tiap 10 detik.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={openWaConfirm} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  <MessageCircle className="h-4 w-4" /> Konfirmasi via WhatsApp
                </Button>
                <Button variant="outline" onClick={loadStatus}>
                  <RefreshCw className="h-4 w-4" /> Cek Status
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {status?.payment?.status === 'rejected' && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs">
                  <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">
                    Konfirmasi sebelumnya ditolak{status.payment.adminNote ? `: ${status.payment.adminNote}` : '.'} Silakan bayar ulang lalu kirim konfirmasi baru.
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-border bg-white p-2">
                <img src={QRIS_IMG} alt="QRIS ARKXMotion Studio" className="w-full max-w-[220px] mx-auto rounded" />
                <p className="text-center text-[12px] text-muted-foreground mt-1">
                  Scan QRIS → bayar {formatRp(fee)}
                </p>
              </div>

              <div>
                <label htmlFor="pro-note" className="block text-xs text-muted-foreground mb-1">
                  Catatan pembayaran (opsional)
                </label>
                <textarea
                  id="pro-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="mis. Pembayaran atas nama Koko, jam 14:30"
                  rows={2}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none"
                />
              </div>

              <Button type="submit" className="w-full" loading={submitting}>
                <Lock className="h-4 w-4" /> Saya sudah bayar — Kirim Konfirmasi
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Nominal konfirmasi mengikuti harga Pro di server: <b className="text-foreground">{formatRp(fee)}</b>.
              </p>
            </form>
          )}
        </Section>
      </div>
    </PageContent>
  )
}
