import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToastStore } from '@/stores/toastStore'
import { Mail, Loader2, CheckCircle, AlertCircle, KeyRound } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)
  const [error, setError] = useState('')
  const addToast = useToastStore((state) => state.addToast)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gagal mengirim link reset')
        return
      }
      setSent(true)
      setDevLink(data.devResetLink || null)
      addToast('Link reset dikirim ke email kamu (jika email terdaftar)', 'success')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
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
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-2">Link Reset Dikirim!</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Jika email <b>{email}</b> terdaftar, kami sudah mengirim link reset password. Link berlaku 15 menit.
              </p>

              {devLink && (
                <div className="w-full mb-4 p-3 rounded-lg bg-secondary border border-border text-left">
                  <p className="text-xs text-muted-foreground mb-1.5">Mode dev â€” SMTP belum dikonfigurasi, buka link berikut:</p>
                  <a href={devLink} className="text-xs text-primary break-all hover:underline">
                    {devLink}
                  </a>
                </div>
              )}

              <Link
                to="/login"
                className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background transition-colors text-center"
              >
                Kembali ke Login
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
            <KeyRound className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Lupa Password</h2>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            Masukkan email kamu. Kami akan mengirim link untuk mereset password.
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
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Mengirim...</span>
              ) : (
                'Kirim Link Reset'
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Ingat password?{' '}
            <Link to="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

