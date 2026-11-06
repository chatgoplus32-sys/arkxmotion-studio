import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { logAudit } from '@/lib/auditLog'
import { LogIn, Mail, Lock, AlertCircle, Sparkles, ArrowRight, ShieldCheck, Zap, Star, CheckCircle2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const login = useAuthStore((state) => state.login)
  const addToast = useToastStore((state) => state.addToast)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const result = await login(email, password)

    if (result.error) {
      setError(result.error)
      addToast(result.error, 'error')
      setIsLoading(false)
      return
    }

    addToast('Welcome back!', 'success')
    logAudit('LOGIN', `User logged in: ${email}`, 'success', email)
    navigate('/quick-start')
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white grid lg:grid-cols-[1.1fr_1fr]">
      {/* LEFT — brand & social proof (desktop only) */}
      <div className="relative hidden overflow-hidden lg:block">
        <img src="/landing/hero-fantasy.webp" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[50%_38%] opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#050816]/20 via-[#050816]/70 to-[#050816]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050816] via-transparent to-[#050816]/40" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <img src="/landing/arkx-logo.jpg" alt="ARKXMotion Studio — AI Video Generation Platform" className="h-16 w-auto rounded-2xl object-contain shadow-[0_0_28px_rgba(0,168,255,0.5)]" />

          <div className="max-w-[470px]">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-300"><Sparkles className="h-3.5 w-3.5" /> AI Creative Suite All-in-One</div>
            <h1 className="text-[40px] font-black italic leading-[0.98] tracking-tight">
              <span className="text-white">Platform Kreatif AI</span><br />
              <span className="bg-gradient-to-r from-[#00A8FF] via-cyan-300 to-[#7B2FFF] bg-clip-text text-transparent">All-in-One</span>
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-white/60">Satu studio untuk video AI sinematik, animasi, foto produk, musik, dan semua kebutuhan konten kreatif kamu.</p>

            <ul className="mt-6 space-y-2.5 text-[13px] text-white/70">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Generate video AI dalam hitungan menit</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> 8 provider AI · smart routing · token rotation</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Kualitas hingga 4K Ultra HD</li>
            </ul>

            <div className="mt-7 flex items-center gap-3">
              <div className="flex -space-x-2.5">
                {['RA', 'DP', 'SA', 'MF', 'TN'].map((n) => <span key={n} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#050816] bg-gradient-to-br from-[#0066FF] to-[#8B5CF6] text-[10px] font-bold">{n}</span>)}
              </div>
              <div className="text-[11px] leading-tight text-white/50"><b className="text-white">2.400+ kreator</b> sudah bergabung<br />48k video ter-generate</div>
              <div className="ml-auto flex gap-1 text-yellow-400">{[1, 2, 3, 4, 5].map((s) => <Star key={s} className="h-4 w-4" fill="currentColor" />)}</div>
            </div>
          </div>

          <p className="text-[11px] text-white/35">© 2026 ARKXMotion Studio · AI video generation platform</p>
        </div>
      </div>

      {/* RIGHT — form */}
      <div className="relative flex items-center justify-center p-4 sm:p-8" style={{ background: 'radial-gradient(800px 500px at 70% 20%, rgba(0,168,255,0.12), transparent 60%), #050816' }}>
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center lg:hidden">
            <img src="/landing/arkx-logo.jpg" alt="ARKXMotion Studio — AI Video Generation Platform" className="h-12 w-auto rounded-xl object-contain shadow-[0_0_18px_rgba(0,168,255,0.45)]" />
          </div>

          <div className="rounded-[24px] border border-cyan-400/15 bg-[#0B1526]/80 p-6 shadow-[0_0_60px_rgba(0,168,255,0.12)] backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <h2 className="text-[22px] font-black italic tracking-tight">Welcome <span className="bg-gradient-to-r from-[#00A8FF] to-cyan-300 bg-clip-text text-transparent">Back</span></h2>
              <p className="mt-1 text-[13px] text-white/50">Masuk kembali ke studio AI creative kamu.</p>
            </div>

            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-[13px] text-red-300">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-white/70">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-semibold text-white/70">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" />
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgba(0,198,255,0.6)] disabled:cursor-not-allowed disabled:opacity-50">
                <LogIn className="h-4 w-4" /> {isLoading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-4 text-center text-[13px]">
              <Link to="/forgot-password" className="font-medium text-cyan-300 hover:text-cyan-200">Lupa password?</Link>
            </div>
            <div className="mt-3 border-t border-white/5 pt-4 text-center text-[13px] text-white/50">
              Belum punya akun? <Link to="/register" className="font-semibold text-cyan-300 hover:text-cyan-200">Create Account</Link>
              {' · '}
              <Link to="/register-status" className="text-white/40 transition hover:text-white">Cek status pendaftaran</Link>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-5 text-[10px] text-white/35">
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-400" /> Aman & Terenkripsi</span>
            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-400" /> Proses Cepat</span>
            <span className="flex items-center gap-1"><Star className="h-3 w-3 text-yellow-400" fill="currentColor" /> 4.9/5 Rating</span>
          </div>
        </div>
      </div>
    </div>
  )
}
