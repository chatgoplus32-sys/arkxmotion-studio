import { useCallback, useEffect, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { formatRp } from '@/lib/membership'
import { BasunipayCheckoutButton, QrisPanel } from '@/components/QrisPayment'
import { recreateBasunipayQris } from '@/lib/payment'
import {
  DEFAULT_ADDON_FEE,
  ADDON_ACCOUNTS_PER_PERIOD,
  ADDON_PERIOD_DAYS,
  buildAddonWaPaymentUrl,
  fetchAddonStatus,
  fetchAddonLinks,
  setAddonSaldoSource,
  getAddonFee,
  submitAddonPayment,
  type AddonAccount,
  type AddonStatus,
  type AddonLink,
} from '@/lib/addon'
import {
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  MailPlus,
  MessageCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'

const BENEFITS = [
  { icon: MailPlus, title: '3 akun email siap pakai', desc: 'Tiga akun email baru setiap periode — tinggal pakai, tidak perlu buat sendiri.' },
  { icon: Clock, title: 'Aktif 30 hari', desc: `Setiap pembayaran mengaktifkan add-on selama ${ADDON_PERIOD_DAYS} hari. Perpanjang kapan pun.` },
  { icon: ShieldCheck, title: 'Dikelola admin resmi', desc: 'Akun diserahkan langsung oleh admin ARKXMotion Studio — bukan akun hasil generate random.' },
  { icon: Sparkles, title: 'Khusus member', desc: 'Add-on ini khusus untuk member ARKXMotion Studio yang sudah aktif.' },
]

const STEPS = [
  { title: 'Klik Bayar Sekarang', desc: 'QRIS dinamis BasuniPay muncul dengan nominal TEPAT (harga + kode unik).' },
  { title: 'Scan & bayar', desc: 'Bayar nominal tepat lewat QRIS — pembayaran terverifikasi otomatis.' },
  { title: 'Terima 3 akun', desc: 'Periode add-on langsung aktif 30 hari; admin menyerahkan 3 akun email di halaman ini.' },
]

function formatDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
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

function AccountCard({ account, index }: { account: AddonAccount; index: number }) {
  const addToast = useToastStore((s) => s.addToast)
  const [showPassword, setShowPassword] = useState(false)

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      addToast(`${label} disalin`, 'success')
    } catch {
      addToast('Gagal menyalin — salin manual', 'error')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <MailCheck className="h-3.5 w-3.5" /> Akun {index + 1}
        </span>
        {account.note && <span className="text-[10px] text-muted-foreground text-right max-w-[60%]">{account.note}</span>}
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-muted-foreground w-14 shrink-0">Email</span>
          <code className="flex-1 min-w-0 truncate font-mono text-xs bg-background/60 border border-border rounded px-2 py-1.5">{account.email}</code>
          <button
            onClick={() => copy(account.email, 'Email')}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Salin email"
            aria-label="Salin email"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-muted-foreground w-14 shrink-0">Password</span>
          <code className="flex-1 min-w-0 truncate font-mono text-xs bg-background/60 border border-border rounded px-2 py-1.5">
            {showPassword ? account.password : '••••••••••••'}
          </code>
          <button
            onClick={() => setShowPassword((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
          >
            {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => copy(account.password, 'Password')}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Salin password"
            aria-label="Salin password"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AddonAkunPage() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const addToast = useToastStore((s) => s.addToast)

  const [status, setStatus] = useState<AddonStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [fee, setFee] = useState(DEFAULT_ADDON_FEE)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [checkoutImage, setCheckoutImage] = useState<string | null>(null)
  const [qrRetrying, setQrRetrying] = useState(false)
  const [links, setLinks] = useState<AddonLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linkBusyId, setLinkBusyId] = useState<number | null>(null)

  const pendingPayment = status?.payment?.status === 'pending' ? status.payment : null
  const accountsPerPeriod = status?.accountsPerPeriod ?? ADDON_ACCOUNTS_PER_PERIOD
  const isActive = !!status?.isActive
  const hasAccounts = (status?.accounts?.length ?? 0) > 0

  const loadStatus = useCallback(async () => {
    if (!token) { setLoading(false); return }
    try {
      const next = await fetchAddonStatus(token)
      setStatus(next)
      setFee((prev) => (Number.isFinite(next.fee) && next.fee > 0 ? next.fee : prev))
    } catch (e: any) {
      addToast(e?.message || 'Gagal memuat status Add-on Akun', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    getAddonFee().then(setFee).catch(() => {})
    loadStatus()
  }, [loadStatus])

  const loadLinks = useCallback(async () => {
    if (!token) return
    setLinksLoading(true)
    try {
      setLinks(await fetchAddonLinks(token))
    } catch (e: any) {
      addToast(e?.message || 'Gagal memuat daftar akun add-on', 'error')
    } finally {
      setLinksLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  const handleSaldoSource = async (link: AddonLink, source: 'parent' | 'own') => {
    if (!token || !link.addonUserId || link.saldoSource === source) return
    setLinkBusyId(link.addonUserId)
    try {
      const message = await setAddonSaldoSource(token, link.addonUserId, source)
      addToast(message, 'success')
      setLinks((prev) => prev.map((l) => (l.addonUserId === link.addonUserId ? { ...l, saldoSource: source } : l)))
    } catch (e: any) {
      addToast(e?.message || 'Gagal mengubah mode saldo', 'error')
    } finally {
      setLinkBusyId(null)
    }
  }

  // Selama menunggu approval (atau menunggu admin mengisi akun setelah
  // disetujui), cek berkala supaya akun langsung muncul di halaman.
  const awaitingAccounts = isActive && !hasAccounts
  useEffect(() => {
    if (!pendingPayment && !awaitingAccounts) return
    const timer = setInterval(loadStatus, 10000)
    return () => clearInterval(timer)
  }, [pendingPayment, awaitingAccounts, loadStatus])

  // Checkout BasuNiPay gagal dibuat? Siapkan ulang untuk pengajuan Add-on ini.
  const handleRetryQris = async () => {
    const paymentId = status?.payment?.id
    if (!paymentId || qrRetrying || !token) return
    setQrRetrying(true)
    const bp = await recreateBasunipayQris(token, 'account_addon_payments', paymentId)
    setQrRetrying(false)
    if (bp) {
      setCheckoutUrl(bp.checkout_url ?? null)
      setCheckoutImage(bp.qris_image ?? null)
      addToast('QRIS BasuNiPay siap — bayar sesuai nominal', 'success')
    } else {
      addToast('QRIS BasuNiPay masih gagal disiapkan — coba lagi', 'error')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setSubmitting(true)
    try {
      const data = await submitAddonPayment(token, note)
      setCheckoutUrl(data.basunipay?.checkout_url ?? null)
      setCheckoutImage(data.basunipay?.qris_image ?? null)
      setStatus((prev) => ({
        fee: prev?.fee ?? fee,
        accountsPerPeriod: prev?.accountsPerPeriod ?? ADDON_ACCOUNTS_PER_PERIOD,
        periodDays: prev?.periodDays ?? ADDON_PERIOD_DAYS,
        isActive: prev?.isActive ?? false,
        periodStart: prev?.periodStart ?? null,
        periodEnd: prev?.periodEnd ?? null,
        accounts: prev?.accounts ?? [],
        payment: data.payment,
      }))
      setNote('')
      addToast('QRIS BasuniPay siap — selesaikan pembayaran, add-on aktif otomatis', 'success')
    } catch (e: any) {
      addToast(e?.message || 'Gagal mengirim konfirmasi', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openWaConfirm = () => {
    if (!user) return
    const url = buildAddonWaPaymentUrl({ name: user.name, email: user.email, note: status?.payment?.proofNote, fee })
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

  return (
    <PageContent>
      <PageHeader
        eyebrow="ARKXMOTION ADD-ON"
        title="Add-on"
        highlight="Akun"
        desc="Tambahan akun email siap pakai khusus member — 3 akun per periode 30 hari, dikelola admin ARKXMotion Studio."
        actions={
          <Button variant="outline" onClick={() => { loadStatus(); loadLinks() }}>
            <RefreshCw className="h-4 w-4" /> Cek Status
          </Button>
        }
      />

      {status?.isAddonAccount && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3">
          <Users className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-sm text-cyan-200">
            <span className="font-semibold">Kamu login sebagai akun add-on{status.ownerName ? <> milik <b>{status.ownerName}</b></> : null}.</span>
            <span className="text-cyan-200/80">
              {' '}Mode saldo saat ini: {status.saldoSource === 'own'
                ? 'saldo sendiri — generate dipotong dari saldo akun ini (top up sendiri).'
                : 'saldo akun utama — generate dipotong dari saldo pemilik akun utama.'}
              {' '}Mode diatur oleh pemilik akun utama lewat menu Add-on Akun di akun utamanya.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Section title="Yang kamu dapat" sub="Add-on bulanan untuk member ARKXMotion Studio">
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

          <Section title="Cara aktifkan" sub="Tiga langkah, langganan bulanan">
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

          <Section title="Akun Add-on Tertaut" sub="3 email add-on yang sudah didaftarkan jadi akun — atur sumber saldonya">
            {linksLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada email add-on. Setelah pembayaran disetujui &amp; admin menyerahkan 3 email, daftar masing-masing di halaman <b>/register</b> dengan email tersebut — akun otomatis aktif &amp; tertaut ke akun kamu.
              </p>
            ) : (
              <div className="space-y-3">
                {links.map((link) => (
                  <div key={link.email} className="rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs sm:text-sm truncate">{link.email}</div>
                        {link.note && <div className="text-[11px] text-muted-foreground">{link.note}</div>}
                        <div className="mt-1 text-[11px]">
                          {link.registered ? (
                            <span className="inline-flex items-center gap-1 text-emerald-500">
                              <CheckCircle2 className="h-3 w-3" /> Terdaftar{link.name ? ` sebagai ${link.name}` : ''}
                            </span>
                          ) : (
                            <span className="text-yellow-500">Belum terdaftar — daftar di /register dengan email ini</span>
                          )}
                        </div>
                      </div>
                      {link.registered && link.addonUserId && (
                        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                          <button
                            type="button"
                            onClick={() => handleSaldoSource(link, 'parent')}
                            disabled={linkBusyId === link.addonUserId}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                              link.saldoSource === 'parent'
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title="Potong saldo CreatePulse/NexaBot/Seavi/PosBot/RunningHub dari akun utama"
                          >
                            {linkBusyId === link.addonUserId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />} Akun Utama
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaldoSource(link, 'own')}
                            disabled={linkBusyId === link.addonUserId}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                              link.saldoSource === 'own'
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title="Akun add-on top up & pakai saldo sendiri"
                          >
                            {linkBusyId === link.addonUserId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3" />} Saldo Sendiri
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  <b>Akun Utama</b> — generate dipotong dari saldo akun kamu (CreatePulse, NexaBot, Seavi, PosBot, RunningHub).
                  <br /><b>Saldo Sendiri</b> — akun add-on top up &amp; memakai saldo miliknya sendiri.
                </p>
              </div>
            )}
          </Section>

          {isActive && (
            <Section
              title="Akun Email Kamu"
              sub={`Periode aktif sampai ${formatDate(status?.periodEnd ?? null)} — ${accountsPerPeriod} akun`}
            >
              {hasAccounts ? (
                <div className="space-y-3">
                  {status!.accounts.map((account, i) => (
                    <AccountCard key={`${account.email}-${i}`} account={account} index={i} />
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    Simpan akun di tempat aman. Akun hanya tampil selama periode aktif.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm">
                  <div className="font-semibold text-yellow-500 mb-1">Akun sedang disiapkan admin</div>
                  <p className="text-xs text-muted-foreground">
                    Pembayaran kamu sudah disetujui. Admin akan mengisi 3 akun email di sini — biasanya tidak lebih dari 1×24 jam. Halaman ini mengecek otomatis tiap 10 detik.
                  </p>
                </div>
              )}
            </Section>
          )}
        </div>

        <Section
          title="Pembayaran Add-on Akun"
          sub="QRIS dinamis BasuniPay — nominal tepat, terverifikasi otomatis"
          right={<StatusBadge status={status?.payment?.status ?? 'none'} />}
        >
          <div className="flex items-baseline justify-between rounded-xl bg-secondary/50 border border-border px-4 py-3 mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Harga Add-on</div>
              <div className="text-2xl font-bold brand-text">{formatRp(fee)}</div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              {accountsPerPeriod} akun email / {ADDON_PERIOD_DAYS} hari
              <br />
              khusus member — per bulan
            </div>
          </div>

          {isActive && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 mb-4 text-xs">
              <span className="font-semibold text-emerald-400">Add-on aktif</span>
              <span className="text-muted-foreground"> — berlaku sampai {formatDate(status?.periodEnd ?? null)}. Beli lagi untuk memperpanjang (ditambahkan di atas sisa masa aktif).</span>
            </div>
          )}

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
                <p className="text-xs text-emerald-500 mt-2">Pembayaran diterima. Akun email akan muncul di halaman ini setelah admin mengisinya.</p>
              )}
            </div>
          )}

          {pendingPayment ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="text-sm font-semibold text-emerald-400 mb-1">
                  {status?.payment?.amountTotal
                    ? <>Bayar <b>TEPAT {formatRp(status.payment.amountTotal)}</b></>
                    : 'Bayar sesuai tarif Add-on'}
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Nominal sudah termasuk kode unik — add-on teraktivasi otomatis begitu pembayaran masuk, tidak perlu menunggu admin.
                </p>
                <BasunipayCheckoutButton
                  url={checkoutUrl ?? status?.payment?.checkoutUrl ?? null}
                  payable={status?.payment?.amountTotal ?? null}
                  image={checkoutImage ?? status?.payment?.qrisImage ?? null}
                />
                {!(checkoutImage ?? status?.payment?.qrisImage) && (
                  <QrisPanel exactAmount={status?.payment?.amountTotal ?? undefined} onRetry={handleRetryQris} retrying={qrRetrying} />
                )}
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
                <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-yellow-500">Menunggu pembayaran terdeteksi</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Begitu pembayaran masuk, periode add-on aktif 30 hari dan admin menyiapkan 3 akun email kamu.
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

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-foreground mb-1">
                  <QrCode className="h-4 w-4 text-primary" /> QRIS dinamis BasuniPay
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Pembayaran lewat QRIS dinamis: nominal TEPAT (harga Add-on + kode unik),
                  terverifikasi otomatis — begitu bayar, periode add-on langsung aktif 30 hari
                  tanpa menunggu admin.
                </p>
              </div>

              <div>
                <label htmlFor="addon-note" className="block text-xs text-muted-foreground mb-1">
                  Catatan pembayaran (opsional)
                </label>
                <textarea
                  id="addon-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="mis. Pembayaran atas nama Koko, jam 14:30"
                  rows={2}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none"
                />
              </div>

              <Button type="submit" className="w-full" loading={submitting}>
                <QrCode className="h-4 w-4" /> Bayar Sekarang — Tampilkan QRIS
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Harga mengikuti harga Add-on di server: <b className="text-foreground">{formatRp(fee)}</b> (kode unik ditambahkan otomatis di QR).
              </p>
            </form>
          )}
        </Section>
      </div>
    </PageContent>
  )
}
