import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, Mail, Loader2, CheckCircle, Clock, XCircle, AlertCircle, MessageCircle } from 'lucide-react'
import { DEFAULT_MEMBERSHIP_FEE, QRIS_IMG, formatRp, buildWaPaymentUrl, getMembershipFee } from '@/lib/membership'

interface PaymentInfo {
  amount: number
  status: string
  proofNote: string
  adminNote: string
  createdAt: string
}

type StatusResult =
  | { found: false }
  | { found: true; approved: boolean; emailVerified: boolean; isAdmin: boolean; payment: PaymentInfo | null }

export default function RegisterStatusPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<StatusResult | null>(null)
  const [error, setError] = useState('')
  const [payNote, setPayNote] = useState('')
  const [fee, setFee] = useState(DEFAULT_MEMBERSHIP_FEE)

  useEffect(() => {
    getMembershipFee().then(setFee).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal cek status')
        return
      }
      setResult(data)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePayConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    const waUrl = buildWaPaymentUrl({ email, note: payNote, fee })
    window.open(waUrl, '_blank')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="h-12 w-12 rounded-lg overflow-hidden flex items-center justify-center">
              <img src="/arkx-logo.svg" alt="ARKXMotion" className="w-full h-full object-contain" />
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold">
            <span className="silver-text">ARK</span>
            <span className="gold-text">X</span>
            <span className="silver-text">Motion</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">STUDIO</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <Search className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Cek Status Pendaftaran</h2>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Masukkan email yang kamu pakai saat mendaftar untuk melihat status akun kamu.
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-muted-foreground mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Mengecek...</span>
              ) : (
                'Cek Status'
              )}
            </button>
          </form>

          {result && (
            <div className="mt-6 p-4 rounded-xl border border-border bg-secondary/30">
              {!result.found ? (
                <div className="flex items-start gap-3">
                  <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-red-400">Akun tidak ditemukan</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Email ini belum terdaftar. Pastikan email sesuai dengan yang kamu pakai saat mendaftar, atau{' '}
                      <Link to="/register" className="text-primary hover:underline">daftar dulu</Link>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    {result.approved ? (
                      <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className={`text-sm font-medium ${result.approved ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {result.approved ? 'Akun disetujui â€” silakan login' : 'Menunggu persetujuan admin'}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.approved
                          ? 'Akun kamu sudah aktif. Silakan login untuk mulai menggunakan ARKXMotion Studio.'
                          : 'Admin akan menyetujui akun kamu. Cek kembali halaman ini nanti.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    {result.emailVerified ? (
                      <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className={`text-sm font-medium ${result.emailVerified ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {result.emailVerified ? 'Email terverifikasi' : 'Email belum diverifikasi'}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.emailVerified
                          ? 'Email kamu sudah dikonfirmasi.'
                          : 'Cek inbox email kamu untuk link verifikasi. Tanpa verifikasi, akun tidak bisa login.'}
                      </p>
                    </div>
                  </div>

                  {/* Status pembayaran member */}
                  <div className="flex items-start gap-3">
                    {result.payment && result.payment.status === 'approved' ? (
                      <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : result.payment && result.payment.status === 'rejected' ? (
                      <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className={`text-sm font-medium ${
                        result.payment && result.payment.status === 'approved'
                          ? 'text-emerald-400'
                          : result.payment && result.payment.status === 'rejected'
                            ? 'text-red-400'
                            : 'text-yellow-400'
                      }`}>
                        {result.payment && result.payment.status === 'approved'
                          ? `Pembayaran disetujui (Rp ${result.payment.amount.toLocaleString('id-ID')})`
                          : result.payment && result.payment.status === 'rejected'
                            ? `Pembayaran ditolak (Rp ${result.payment.amount.toLocaleString('id-ID')})`
                            : result.payment
                              ? `Menunggu konfirmasi pembayaran (Rp ${result.payment.amount.toLocaleString('id-ID')})`
                              : 'Belum ada konfirmasi pembayaran'}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.payment && result.payment.status === 'approved'
                          ? 'Pembayaran kamu sudah diterima admin.'
                          : result.payment && result.payment.status === 'rejected'
                            ? `Ditolak admin: ${result.payment.adminNote || 'tanpa keterangan'}. Kirim ulang pembayaran atau hubungi admin.`
                            : result.payment
                              ? 'Admin sedang memproses pembayaran kamu.'
                              : 'Bayar via QRIS lalu konfirmasi via WhatsApp (lihat di bawah).'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Konfirmasi pembayaran via QRIS + WhatsApp */}
              {result.found && !result.approved && result.payment?.status !== 'approved' && (
                <form onSubmit={handlePayConfirm} className="mt-6 p-4 rounded-xl border border-border bg-secondary/30">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium">Konfirmasi Pembayaran (QRIS)</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Belum bayar? Scan QRIS di bawah, lalu konfirmasi pembayaran via WhatsApp ke admin.
                  </p>
                  <div className="mb-3 rounded-lg overflow-hidden border border-border bg-white p-2">
                    <img src={QRIS_IMG} alt="QRIS Faezya cell" className="w-full max-w-[200px] mx-auto rounded" />
                    <p className="text-center text-[10px] text-muted-foreground mt-1">Bayar {formatRp(fee)}</p>
                  </div>
                  <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary border border-border px-3 py-2">
                    <span className="text-xs text-muted-foreground">Biaya pendaftaran</span>
                    <span className="text-sm font-bold text-primary">{formatRp(fee)}</span>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-muted-foreground mb-1">Catatan (opsional)</label>
                    <textarea
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                      placeholder="mis. Pembayaran atas nama Koko, jam 14:30"
                      rows={2}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 px-3 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 transition-colors text-sm inline-flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Konfirmasi via WhatsApp
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Sudah punya akun?{' '}
            <Link to="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

