import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToastStore } from '@/stores/toastStore'
import { Mail, Loader2, CheckCircle2, AlertCircle, KeyRound, ShieldCheck, Zap, ArrowRight, Sparkles } from 'lucide-react'

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

  const leftHero = (
    <div className="relative hidden overflow-hidden lg:block">
      <img src="/landing/hero-fantasy.webp" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[50%_38%] opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#050816]/20 via-[#050816]/70 to-[#050816]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050816] via-transparent to-[#050816]/40" />
      <div className="relative flex h-full flex-col justify-between p-10">
        <div className="flex items-center gap-3">
          <img src="/landing/arkx-icon-v2.png" alt="ARKXMotion Studio" className="h-12 w-auto object-contain drop-shadow-[0_0_28px_rgba(0,168,255,0.5)]" />
          <div>
            <div className="text-base font-black italic leading-tight tracking-tight">
              <span className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-transparent">ARKX</span>
              <span className="text-white">MOTION</span>
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.42em] text-cyan-300/70">STUDIO</div>
          </div>
        </div>

        <div className="max-w-[470px]">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-300"><KeyRound className="h-3.5 w-3.5" /> Keamanan Akun Premium</div>
          <h1 className="text-[40px] font-black italic leading-[0.98] tracking-tight">
            <span className="text-white">Lupa Password?</span><br />
            <span className="bg-gradient-to-r from-[#00A8FF] via-cyan-300 to-[#7B2FFF] bg-clip-text text-transparent">Reset Jadi Gampang</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-white/60">Kami akan mengirim link reset ke email terdaftar. Klik link itu untuk set password baru — berlaku 15 menit demi keamanan.</p>
          <ul className="mt-6 space-y-2.5 text-[13px] text-white/70">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Link terkirim dalam hitungan detik</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Berlaku 15 menit — aman untuk kamu</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Akun & saldo tetap aman terjaga</li>
          </ul>
          <div className="mt-7 flex items-center gap-3">
            <div className="flex -space-x-2.5">
              {['RA', 'DP', 'SA', 'MF', 'TN'].map((n) => <span key={n} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#050816] bg-gradient-to-br from-[#0066FF] to-[#8B5CF6] text-[10px] font-bold">{n}</span>)}
            </div>
            <div className="text-[11px] leading-tight text-white/50"><b className="text-white">2.400+ kreator</b> mempercayakan akunnya<br />ke ARKXMotion Studio</div>
          </div>
        </div>

        <p className="text-[11px] text-white/35">© 2026 ARKXMotion Studio · AI video generation platform</p>
      </div>
    </div>
  )

  if (sent) {
    return (
      <div className="min-h-screen bg-[#050816] text-white grid lg:grid-cols-[1.1fr_1fr]">
        {leftHero}
        <div className="relative flex items-center justify-center p-4 sm:p-8" style={{ background: 'radial-gradient(800px 500px at 70% 20%, rgba(0,168,255,0.12), transparent 60%), #050816' }}>
          <div className="w-full max-w-[400px] rounded-[24px] border border-cyan-400/15 bg-[#0B1526]/80 p-6 text-center shadow-[0_0_60px_rgba(0,168,255,0.12)] backdrop-blur-xl sm:p-8 sm:text-left">
            <div className="flex flex-col items-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 shadow-[0_0_30px_rgba(34,197,94,0.25)]"><CheckCircle2 className="h-8 w-8 text-emerald-400" /></div>
              <h2 className="text-[22px] font-black italic tracking-tight">Link Reset <span className="bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">Dikirim!</span></h2>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">Jika email <b className="text-white">{email}</b> terdaftar, kami sudah mengirim link reset password. Link berlaku 15 menit.</p>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-[11px] leading-relaxed text-white/50">
                <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-cyan-300" /> Tips: cek folder Spam / Promotions kalau tidak muncul di inbox dalam 1 menit.
              </div>

              {devLink && (
                <div className="mt-4 w-full rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-left">
                  <p className="mb-1.5 text-xs text-amber-200/80">Mode dev — SMTP belum dikonfigurasi, buka link berikut:</p>
                  <a href={devLink} className="break-all text-xs text-cyan-300 hover:underline">{devLink}</a>
                </div>
              )}

              <Link to="/login" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] px-4 py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition hover:-translate-y-0.5">
                Kembali ke Login <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white grid lg:grid-cols-[1.1fr_1fr]">
      {leftHero}
      <div className="relative flex items-center justify-center p-4 sm:p-8" style={{ background: 'radial-gradient(800px 500px at 70% 20%, rgba(0,168,255,0.12), transparent 60%), #050816' }}>
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <img src="/landing/arkx-icon-v2.png" alt="ARKXMotion Studio" className="h-10 w-auto object-contain drop-shadow-[0_0_18px_rgba(0,168,255,0.45)]" />
            <div>
              <div className="text-sm font-black italic leading-tight"><span className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-transparent">ARKX</span><span>MOTION</span></div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.42em] text-cyan-300/70">STUDIO</div>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan-400/15 bg-[#0B1526]/80 p-6 shadow-[0_0_60px_rgba(0,168,255,0.12)] backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#0066FF] to-[#00D4FF] shadow-[0_0_20px_rgba(0,168,255,0.4)]"><KeyRound className="h-5 w-5 text-black" /></div>
              <h2 className="text-[22px] font-black italic tracking-tight">Lupa <span className="bg-gradient-to-r from-[#00A8FF] to-cyan-300 bg-clip-text text-transparent">Password?</span></h2>
              <p className="mt-1 text-[13px] leading-relaxed text-white/50">Masukkan email akunmu — kami kirim link reset yang berlaku 15 menit.</p>
            </div>

            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-[13px] text-red-300"><AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-white/70">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" />
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgba(0,198,255,0.6)] disabled:opacity-50">
                {isLoading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Mengirim...</span> : <><KeyRound className="h-4 w-4" /> Kirim Link Reset</>}
              </button>
            </form>

            <div className="mt-6 border-t border-white/5 pt-4 text-center text-[13px] text-white/50">
              Ingat password? <Link to="/login" className="font-semibold text-cyan-300 hover:text-cyan-200">Sign in</Link>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-5 text-[10px] text-white/35">
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-400" /> Aman & Terenkripsi</span>
            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-400" /> Link 15 Menit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
