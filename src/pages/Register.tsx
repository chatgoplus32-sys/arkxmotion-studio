import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { UserPlus, Mail, Lock, User, AlertCircle, CheckCircle, MessageCircle } from 'lucide-react'
import { DEFAULT_MEMBERSHIP_FEE, QRIS_IMG, formatRp, buildWaPaymentUrl, getMembershipFee } from '@/lib/membership'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [devVerifyLink, setDevVerifyLink] = useState<string | null>(null)
  const [payNote, setPayNote] = useState('')
  const [fee, setFee] = useState(DEFAULT_MEMBERSHIP_FEE)
  const [isLoading, setIsLoading] = useState(false)
  const register = useAuthStore((state) => state.register)
  const addToast = useToastStore((state) => state.addToast)

  useEffect(() => {
    getMembershipFee().then(setFee).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setIsLoading(true)

    const result = await register(email, password, name)

    if (result.error) {
      setError(result.error)
      setIsLoading(false)
      return
    }

    setSuccess(true)
    setDevVerifyLink(result.devVerifyLink || null)
    setIsLoading(false)
    addToast('Registration successful! Cek email untuk verifikasi, lalu konfirmasi pembayaran.', 'success')
  }

  const handlePayConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    const waUrl = buildWaPaymentUrl({ name, email, note: payNote, fee })
    window.open(waUrl, '_blank')
    addToast('Konfirmasi pembayaran dibuka di WhatsApp', 'success')
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <img src="/arkx-full-logo.svg" alt="ARKXMotion Studio" className="h-16" />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-2">Registration Successful!</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Akun kamu sudah dibuat. Langkah berikutnya: <b>â‘  verifikasi email</b> â†’ <b>â‘¡ konfirmasi pembayaran</b> â†’ tunggu persetujuan admin.
              </p>

              {/* Konfirmasi pembayaran member (QRIS â†’ WhatsApp) */}
              <form onSubmit={handlePayConfirm} className="w-full mb-4 p-3 rounded-lg bg-secondary/50 border border-border text-left">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-medium">Konfirmasi Pembayaran (QRIS)</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Bayar <b className="text-foreground">{formatRp(fee)}</b> via QRIS di bawah, lalu klik tombol konfirmasi via WhatsApp.
                </p>
                <div className="mb-3 rounded-lg overflow-hidden border border-border bg-white p-2">
                  <img src={QRIS_IMG} alt="QRIS Faezya cell" className="w-full max-w-[220px] mx-auto rounded" />
                  <p className="text-center text-[10px] text-muted-foreground mt-1">Scan QRIS â†’ Bayar {formatRp(fee)} â†’ Konfirmasi via WhatsApp</p>
                </div>
                <div className="mb-2 flex items-center justify-between rounded-lg bg-secondary border border-border px-3 py-2">
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

              {devVerifyLink && (
                <div className="w-full mb-4 p-3 rounded-lg bg-secondary border border-border text-left">
                  <p className="text-xs text-muted-foreground mb-1.5">Mode dev â€” SMTP belum dikonfigurasi, verifikasi manual:</p>
                  <a
                    href={devVerifyLink}
                    className="text-xs text-primary break-all hover:underline"
                  >
                    {devVerifyLink}
                  </a>
                </div>
              )}

              <Link
                to="/register-status"
                className="block w-full py-2.5 px-4 bg-secondary text-foreground font-medium rounded-lg hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors text-center mb-2"
              >
                Cek Status Pendaftaran
              </Link>
              <Link
                to="/login"
                className="block w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background transition-colors text-center"
              >
                Go to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img src="/arkx-full-logo.svg" alt="ARKXMotion Studio" className="h-16" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Create Account</h2>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-muted-foreground mb-1.5">
                Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>
            </div>

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

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-muted-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-muted-foreground mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

