import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { UserPlus, Mail, Lock, User, AlertCircle, CheckCircle, CheckCircle2, MessageCircle, Crown, Sparkles, ArrowRight, ShieldCheck, Zap, Star } from 'lucide-react'
import {
  DEFAULT_MEMBERSHIP_FEE,
  QRIS_IMG,
  formatRp,
  buildWaPaymentUrl,
  getMembershipPricing,
} from '@/lib/membership'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [payNote, setPayNote] = useState('')
  const [fee, setFee] = useState(DEFAULT_MEMBERSHIP_FEE)
  const [isLoading, setIsLoading] = useState(false)
  const register = useAuthStore((state) => state.register)
  const addToast = useToastStore((state) => state.addToast)

  useEffect(() => {
    getMembershipPricing()
      .then((pricing) => setFee(pricing.fee))
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
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
    setIsLoading(false)
    addToast('Registrasi berhasil! Menunggu persetujuan admin.', 'success')
  }

  const handlePayConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    const waUrl = buildWaPaymentUrl({ name, email, note: payNote, fee })
    window.open(waUrl, '_blank')
    addToast('Konfirmasi pembayaran dibuka di WhatsApp', 'success')
  }

  const heroLeft = (
    <div className="relative hidden overflow-hidden lg:block">
      <img src="/landing/hero-fantasy.webp" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[50%_38%] opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#050816]/20 via-[#050816]/70 to-[#050816]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050816] via-transparent to-[#050816]/40" />
      <div className="relative flex h-full flex-col justify-between p-10">
        <div className="flex items-center gap-3">
          <img src="/landing/arkx-icon-clean.png" alt="ARKXMotion Studio" className="h-12 w-auto object-contain drop-shadow-[0_0_28px_rgba(0,168,255,0.5)]" />
          <div>
            <div className="text-base font-black italic leading-tight tracking-tight">
              <span className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-transparent">ARKX</span>
              <span className="text-white">MOTION</span>
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.42em] text-cyan-300/70">STUDIO</div>
          </div>
        </div>

        <div className="max-w-[470px]">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-[11px] font-bold text-purple-300"><Crown className="h-3.5 w-3.5" /> Join Pro — Sekali Bayar</div>
          <h1 className="text-[40px] font-black italic leading-[0.98] tracking-tight">
            <span className="text-white">Buka Semua</span><br />
            <span className="bg-gradient-to-r from-[#00A8FF] via-cyan-300 to-[#7B2FFF] bg-clip-text text-transparent">Fitur Premium</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-white/60">Setelah pembayaran disetujui, akunmu otomatis jadi Pro dan semua fitur AI terbuka permanen. Mulai dari video AI sinematik, animasi, sampai konten kreatif.</p>

          <ul className="mt-6 space-y-2.5 text-[13px] text-white/70">
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Sekali bayar — permanen seumur hidup</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Akses model premium (Kling, Wan, Sora, dsb.)</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Prioritas server & kualitas 4K</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Support & Komunitas kreatif ARKX</li>
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
  )

  if (success) {
    return (
      <div className="min-h-screen bg-[#050816] text-white grid lg:grid-cols-[1.1fr_1fr]">
        {heroLeft}
        <div className="relative flex items-center justify-center p-4 sm:p-8" style={{ background: 'radial-gradient(800px 500px at 70% 20%, rgba(0,168,255,0.12), transparent 60%), #050816' }}>
          <div className="w-full max-w-[420px] rounded-[24px] border border-cyan-400/15 bg-[#0B1526]/80 p-6 text-center shadow-[0_0_60px_rgba(0,168,255,0.12)] backdrop-blur-xl sm:p-8">
            <div className="flex flex-col items-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 shadow-[0_0_30px_rgba(34,197,94,0.25)]"><CheckCircle className="h-7 w-7 text-emerald-400" /></div>
              <h2 className="text-[20px] font-black italic tracking-tight">Registration <span className="bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">Successful!</span></h2>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">Akun kamu sudah dibuat. Setelah pembayaran disetujui admin, akun otomatis jadi <b className="text-white">Pro</b> dan semua fitur AI terbuka.</p>

              <form onSubmit={handlePayConfirm} className="mb-4 mt-5 w-full rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4 text-left">
                <div className="mb-2 flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-400" /><span className="text-sm font-semibold">Konfirmasi Pembayaran (QRIS)</span></div>
                <p className="mb-3 text-[11px] text-white/50">Bayar <b className="text-white">{formatRp(fee)}</b> via QRIS, lalu klik tombol konfirmasi via WhatsApp.</p>
                <div className="mb-3 rounded-xl border border-white/10 bg-white p-2">
                  <img src={QRIS_IMG} alt="QRIS ARKXMotion Studio" className="mx-auto w-full max-w-[180px] rounded" />
                  <p className="mt-1 text-center text-[11px] text-white/50">Scan QRIS → Bayar {formatRp(fee)} → Konfirmasi via WhatsApp</p>
                </div>
                <div className="mb-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span className="text-xs text-white/50">Biaya join Pro</span>
                  <span className="text-sm font-bold text-emerald-300">{formatRp(fee)}</span>
                </div>
                <label className="mb-1 block text-[11px] text-white/50">Catatan (opsional)</label>
                <textarea value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="mis. Pembayaran atas nama Koko, jam 14:30" rows={2} className="mb-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20" />
                <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#25D366] to-[#128C7E] py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5">
                  <MessageCircle className="h-4 w-4" /> Konfirmasi via WhatsApp
                </button>
              </form>

              <Link to="/register-status" className="mb-2 block w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-center text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]">Cek Status Pendaftaran</Link>
              <Link to="/login" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] px-4 py-2.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition hover:-translate-y-0.5">Go to Login <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white grid lg:grid-cols-[1.1fr_1fr]">
      {heroLeft}
      <div className="relative flex items-center justify-center p-4 sm:p-8" style={{ background: 'radial-gradient(800px 500px at 70% 20%, rgba(0,168,255,0.12), transparent 60%), #050816' }}>
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <img src="/landing/arkx-icon-clean.png" alt="ARKXMotion Studio" className="h-10 w-auto object-contain drop-shadow-[0_0_18px_rgba(0,168,255,0.45)]" />
            <div>
              <div className="text-sm font-black italic leading-tight"><span className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-transparent">ARKX</span><span>MOTION</span></div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.42em] text-cyan-300/70">STUDIO</div>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan-400/15 bg-[#0B1526]/80 p-6 shadow-[0_0_60px_rgba(0,168,255,0.12)] backdrop-blur-xl sm:p-8">
            <div className="mb-5">
              <h2 className="flex items-center gap-2 text-[22px] font-black italic tracking-tight"><UserPlus className="h-5 w-5 text-cyan-300" /> Create <span className="bg-gradient-to-r from-[#00A8FF] to-cyan-300 bg-clip-text text-transparent">Account</span></h2>
              <p className="mt-1 text-[13px] text-white/50">Bergabung dengan 2.400+ kreator. Gratis daftar sekarang.</p>
            </div>

            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-purple-400/25 bg-gradient-to-br from-[#7B2FFF]/15 to-[#8B5CF6]/10 p-3.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7B2FFF] to-[#B44DFF] shadow-[0_0_20px_rgba(123,47,255,0.4)]"><Crown className="h-5 w-5 text-white" fill="currentColor" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-black uppercase tracking-[0.22em] text-purple-300">Join Pro — Sekali Bayar</div>
                <div className="mt-0.5 text-[22px] font-black text-white leading-none">{formatRp(fee)}</div>
                <div className="mt-1 text-[11px] leading-tight text-white/50">Setelah disetujui, akun otomatis Pro dan semua fitur AI terbuka permanen.</div>
              </div>
            </div>

            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-[13px] text-red-300"><AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="mb-1.5 block text-[13px] font-semibold text-white/70">Name</label>
                <div className="relative"><User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" /><input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" /></div>
              </div>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-white/70">Email</label>
                <div className="relative"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" /><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" /></div>
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-semibold text-white/70">Password</label>
                <div className="relative"><Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" /><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter" required minLength={8} className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" /></div>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block text-[13px] font-semibold text-white/70">Confirm Password</label>
                <div className="relative"><Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" /><input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Ulangi password" required minLength={8} className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none backdrop-blur transition focus:border-cyan-400/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-400/25" /></div>
              </div>
              <button type="submit" disabled={isLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] py-3 text-sm font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_44px_rgba(0,198,255,0.6)] disabled:opacity-50">
                <UserPlus className="h-4 w-4" /> {isLoading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

            <div className="mt-5 border-t border-white/5 pt-4 text-center text-[13px] text-white/50">
              Sudah punya akun? <Link to="/login" className="font-semibold text-cyan-300 hover:text-cyan-200">Sign in</Link>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-5 text-[10px] text-white/35">
            <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-400" /> Aman & Terenkripsi</span>
            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-400" /> Setup 2 Menit</span>
            <span className="flex items-center gap-1"><Star className="h-3 w-3 text-yellow-400" fill="currentColor" /> 4.9/5 Rating</span>
          </div>
        </div>
      </div>
    </div>
  )
}
