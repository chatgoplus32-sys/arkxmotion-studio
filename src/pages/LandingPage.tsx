import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

// Harga provider live dari /api/public/pricing (read-only, tanpa login).
interface ProviderPrices {
  nexabot?: {
    name: string
    price_per_generate: number
    min_topup: number
    /** Varian utama (dipakai kalau server belum mengirim daftar paket). */
    package: { label: string; price: number; days: number }
    /** Semua varian paket Unlimited: Mingguan, Bulanan, Tahunan. */
    packages?: { slug: string; label: string; price: number; days: number }[]
  }
  createpulse?: {
    name: string
    min_topup: number
    price_range: { min: number; max: number }
  }
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

const providers = [
  { name: 'Weavy', dot: '#8b5cf6' },
  { name: 'Roboneo', dot: '#ec4899' },
  { name: 'Galleri5', dot: '#f59e0b' },
  { name: 'Leonardo', dot: '#06b6d4' },
  { name: 'OneOver', dot: '#a78bfa' },
  { name: 'Framia', dot: '#10b981' },
  { name: 'Magnific', dot: '#f43f5e' },
  { name: 'CreatePulse', dot: '#3b82f6' },
]

const features = [
  {
    title: 'Motion Control',
    desc: 'Transfer motion dari video referensi ke karakter AI. Support Kling V3 Pro, Wan Motion, RoboNeo.',
    icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    gradient: 'from-blue-500/20 to-cyan-500/10',
  },
  {
    title: 'Image to Video',
    desc: 'Hidupkan foto jadi video sinematik. Gemini Veo, Wan 2.7, Grok Imagine, Seedance.',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    gradient: 'from-violet-500/20 to-purple-500/10',
  },
  {
    title: 'Bulk Fashion',
    desc: '1 model + 100 outfit = 100 video sekaligus. CSV upload, parallel engine.',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    gradient: 'from-emerald-500/20 to-teal-500/10',
  },
  {
    title: 'AI Upscaler',
    desc: 'Upscale 4K + enhance detail dengan Magnific, Leonardo & Topaz.',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z M10 10a3 3 0 106 0 3 3 0 00-6 0z',
    gradient: 'from-cyan-500/20 to-blue-500/10',
  },
  {
    title: 'Smart Routing',
    desc: 'Auto pilih provider termurah & tercepat. Balance real-time, fallback otomatis.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    gradient: 'from-blue-500/20 to-yellow-500/10',
  },
  {
    title: 'UGC Studio',
    desc: 'Product photography ke UGC video siap jual. Shopee, Tokopedia, Tiktok ready.',
    icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    gradient: 'from-pink-500/20 to-rose-500/10',
  },
]

const steps = [
  { n: '01', title: 'Upload Referensi', desc: 'Upload video motion atau foto produk. Drag & drop, langsung preview.' },
  { n: '02', title: 'Pilih Model & Provider', desc: 'Pilih Kling, Wan, Galleri5. Sistem auto-routing pilih yang paling optimal.' },
  { n: '03', title: 'Generate & Download', desc: 'Polling background, notifikasi realtime, download ZIP atau share link.' },
]

const pricing = [
  {
    name: 'Starter',
    price: 'Gratis',
    sub: 'Cocok buat coba',
    features: ['5 generate / bulan', 'Watermark', '1 provider', 'Community support'],
    cta: 'Mulai Gratis',
    highlight: false,
  },
  {
    name: 'Creator',
    price: 'Rp 150rb',
    sub: '/ bulan • paling populer',
    features: ['200 generate', 'Tanpa watermark', 'Semua provider', 'Bulk 50 parallel', 'Smart routing', 'Prioritas antrian'],
    cta: 'Pilih Creator',
    highlight: true,
  },
  {
    name: 'Studio',
    price: 'Custom',
    sub: 'Untuk tim & agency',
    features: ['Unlimited generate', 'API access', 'Dedicated token pool', 'White-label', 'SLA 99.9%', 'Support WA prioritas'],
    cta: 'Hubungi Admin',
    highlight: false,
  },
]

const faqs = [
  { q: 'Apa itu ARKXMotion Studio?', a: 'Platform all-in-one untuk generate video AI. Satu dashboard untuk akses 8+ provider — Weavy, Roboneo, Galleri5, Leonardo, OneOver, Framia, Magnific, CreatePulse — dengan token rotation & smart routing otomatis.' },
  { q: 'Bagaimana sistem token & credits?', a: 'Kamu beli token per provider (Roboneo/Framia/Weavy) via halaman Beli Token. Sistem cek balance realtime sebelum generate dan auto-fallback ke token lain jika habis/error.' },
  { q: 'Apakah bisa bulk generate?', a: 'Bisa. Bulk Fashion mendukung 1 karakter + ratusan outfit sekaligus, parallel processing. Cocok untuk katalog fashion & UGC massal.' },
  { q: 'Apakah ada watermark?', a: 'Tidak untuk paket Creator & Studio. Paket Starter gratis ada watermark kecil.' },
]

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [mobileMenu, setMobileMenu] = useState(false)
  // Kalau endpoint harga tidak bisa diakses, bagian ini cukup tidak tampil.
  const [providerPrices, setProviderPrices] = useState<ProviderPrices | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/public/pricing')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.providers) setProviderPrices(d.providers as ProviderPrices) })
      .catch(() => { /* opsional: biarkan kosong */ })
    return () => { alive = false }
  }, [])

  return (
    <div className="min-h-screen bg-[#050510] text-white overflow-x-hidden selection:bg-[#00a8ff]/30">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-fade-in-up { animation: fadeInUp 0.7s ease-out both; }
        .animate-fade-in { animation: fadeIn 0.6s ease-out both; }
        .animate-slide-right { animation: slideInRight 0.7s ease-out both; }
        .animate-float { animation: float 4s ease-in-out infinite; }
        .animate-shimmer { animation: shimmer 3s linear infinite; background-size: 200% 100%; }
      `}</style>

      <nav className="fixed top-0 w-full z-50 border-b border-white/[0.06] bg-[#050510]/70 backdrop-blur-2xl">
        <div className="max-w-[1180px] mx-auto px-6 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-3">
              <img src="/arkx-logo.svg" alt="ARKX" className="w-9 h-9 rounded-xl shadow-[0_0_20px_rgba(0,168,255,0.25)]" />
              <span className="text-[15px] font-bold tracking-tight">ARKXMotion Studio</span>
              <span className="hidden sm:inline text-[10px] font-mono tracking-widest px-2 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white/60">BETA 2.0</span>
            </Link>
            <div className="hidden lg:flex items-center gap-1 text-sm">
              <a href="#features" className="px-3 py-2 text-white/60 hover:text-white transition">Features</a>
              <a href="#how" className="px-3 py-2 text-white/60 hover:text-white transition">Cara Kerja</a>
              <a href="#pricing" className="px-3 py-2 text-white/60 hover:text-white transition">Pricing</a>
              <a href="#faq" className="px-3 py-2 text-white/60 hover:text-white transition">FAQ</a>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden sm:inline px-4 py-2 text-sm text-white/70 hover:text-white transition">Login</Link>
            <Link to="/register" className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] text-black rounded-xl hover:shadow-[0_8px_24px_rgba(0,168,255,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all">Get Started →</Link>
            <button onClick={() => setMobileMenu(!mobileMenu)} className="lg:hidden w-9 h-9 grid place-items-center rounded-xl border border-white/10 ml-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={mobileMenu ? "M6 18L18 6M6 6l12 12" : "M4 7h16M4 12h16M4 17h16"} /></svg>
            </button>
          </div>
        </div>
        {mobileMenu && (
          <div className="lg:hidden border-t border-white/5 bg-[#050510] px-6 py-4 flex flex-col gap-1">
            <a href="#features" onClick={() => setMobileMenu(false)} className="px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-white/80">Features</a>
            <a href="#how" onClick={() => setMobileMenu(false)} className="px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-white/80">Cara Kerja</a>
            <a href="#pricing" onClick={() => setMobileMenu(false)} className="px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-white/80">Pricing</a>
            <a href="#faq" onClick={() => setMobileMenu(false)} className="px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-white/80">FAQ</a>
          </div>
        )}
      </nav>

      <section className="relative pt-28 pb-10 px-6 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,black_70%,transparent_110%)]" />
          <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[1100px] h-[520px] bg-gradient-to-br from-[#00a8ff]/20 via-[#00d4ff]/10 to-transparent rounded-full blur-[80px] opacity-60 animate-[pulse_6s_ease-in-out_infinite]" />
          <div className="absolute top-[220px] right-[-80px] w-[420px] h-[420px] bg-blue-500/10 rounded-full blur-[90px] animate-[pulse_8s_ease-in-out_infinite_2s]" />
          <div className="absolute bottom-[-60px] left-[-40px] w-[300px] h-[300px] bg-cyan-500/8 rounded-full blur-[70px] animate-[pulse_10s_ease-in-out_infinite_4s]" />
        </div>

        <div className="max-w-[1180px] mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-10 items-center">
          <div className="animate-[fadeInUp_0.8s_ease-out]">
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
              <span className="text-white/70 font-mono text-[11px] tracking-widest uppercase">8 Providers • Smart Routing • Live</span>
              <span className="hidden sm:inline text-white/20">•</span>
              <span className="hidden sm:inline text-blue-400 text-xs">99.9% uptime</span>
            </div>

            <h1 className="mt-6 text-[36px] sm:text-[42px] md:text-[58px] font-black leading-[0.95] tracking-[-0.03em]">
              <span className="bg-gradient-to-r from-[#00a8ff] via-[#00d4ff] to-[#00f0ff] bg-clip-text text-transparent">ARKX</span>
              <span className="text-white">Motion Studio</span>
            </h1>

            <p className="mt-3 text-[13px] sm:text-[14px] font-mono tracking-[0.25em] text-blue-300/70 uppercase">Ideas Move Reality</p>

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] sm:text-xs font-mono tracking-wider text-white/40">
              <span>VIDEO</span>
              <span className="text-blue-400">•</span>
              <span>ANIMATION</span>
              <span className="text-blue-400">•</span>
              <span>AI</span>
              <span className="text-blue-400">•</span>
              <span>CREATIVE SOLUTION</span>
            </div>

            <p className="mt-5 text-[15px] md:text-[18px] leading-relaxed text-white/55 max-w-[560px]">
              Satu platform untuk semua kebutuhan video AI — motion control, image-to-video, bulk fashion, UGC & upscaler. Multi-provider, token rotation, balance check real-time.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="px-6 sm:px-7 py-3 sm:py-3.5 text-[14px] sm:text-[15px] font-semibold bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] text-black rounded-xl hover:shadow-[0_12px_30px_rgba(0,168,255,0.35)] hover:-translate-y-[1px] active:translate-y-0 transition-all">
                Mulai Gratis — 5 Generate
              </Link>
              <a href="#features" className="px-6 sm:px-7 py-3 sm:py-3.5 text-[14px] sm:text-[15px] font-medium bg-white text-black rounded-xl hover:bg-white/90 transition flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><circle cx="12" cy="12" r="10" /></svg>
                Lihat Demo
              </a>
            </div>

            <div className="mt-4 flex items-center gap-3 text-xs text-white/40">
              <span className="flex -space-x-2">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 border-2 border-[#050510] grid place-items-center text-[11px] font-bold text-black">A</span>
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 border-2 border-[#050510] grid place-items-center text-[11px] font-bold">B</span>
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 border-2 border-[#050510] grid place-items-center text-[11px] font-bold">C</span>
              </span>
              <span>Dipercaya 2,400+ creator • 48k video ter-generate</span>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3 max-w-[520px]">
              {[
                { k: '10k+', v: 'Video / minggu' },
                { k: '< 45s', v: 'Avg generate' },
                { k: '8+', v: 'AI Providers' },
              ].map((s) => (
                <div key={s.k} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3 backdrop-blur hover:border-[#00a8ff]/20 transition-colors">
                  <div className="text-[16px] sm:text-[18px] font-bold tracking-tight">{s.k}</div>
                  <div className="text-[10px] sm:text-[11px] text-white/45">{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative lg:h-[520px] mt-8 lg:mt-0 animate-[fadeInUp_0.8s_ease-out_0.2s_both]">
            <div className="absolute -inset-6 bg-gradient-to-br from-[#00a8ff]/15 to-blue-500/10 rounded-[28px] blur-2xl opacity-60" />
            <div className="relative rounded-[24px] overflow-hidden border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] backdrop-blur-2xl shadow-[0_20px_80px_rgba(0,0,0,0.5)]">
              <div className="h-11 flex items-center justify-between px-4 border-b border-white/5 bg-white/[0.03]">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-400/80" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <span className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <div className="text-[11px] sm:text-xs font-mono text-white/40">arkxmotion.studio — Dashboard</div>
                <div className="w-16" />
              </div>

              <div className="p-3 sm:p-4 grid gap-3 sm:gap-4">
                <div className="rounded-2xl overflow-hidden border border-white/5 bg-black/40 aspect-[16/9] relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-cyan-500/20" />
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="w-14 h-14 rounded-full bg-white text-black grid place-items-center shadow-xl hover:scale-110 transition-transform cursor-pointer">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7z" /></svg>
                    </div>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <span className="text-[10px] sm:text-[11px] font-mono px-2 py-1 rounded-full bg-black/60 border border-white/10 text-white/70">Kling V3 Pro • 5s • 720p</span>
                    <span className="text-[10px] sm:text-[11px] px-2 py-1 rounded-full bg-emerald-500 text-black font-semibold">● Generating 68%</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Total Generates', value: '48,291', sub: '+12% minggu ini', color: 'text-blue-400' },
                    { label: 'Success Rate', value: '96.4%', sub: 'Avg 38s', color: 'text-emerald-400' },
                    { label: 'Active Keys', value: '14/18', sub: '3 providers', color: 'text-blue-400' },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl bg-white/[0.04] border border-white/5 p-2 sm:p-3">
                      <div className="text-[10px] sm:text-[11px] text-white/40">{c.label}</div>
                      <div className={`text-[14px] sm:text-[16px] font-bold ${c.color}`}>{c.value}</div>
                      <div className="text-[10px] sm:text-[11px] text-white/30">{c.sub}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {providers.slice(0, 5).map((p) => (
                    <div key={p.name} className="rounded-xl bg-white/[0.03] border border-white/5 p-1.5 sm:p-2 text-center">
                      <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: p.dot }} />
                      <div className="text-[10px] sm:text-[11px] font-medium text-white/70">{p.name}</div>
                      <div className="text-[9px] sm:text-[10px] text-emerald-400">online</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="absolute -bottom-4 -left-4 hidden md:flex items-center gap-3 rounded-2xl bg-[#0c0c1a] border border-white/10 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] animate-[fadeInUp_0.8s_ease-out_0.5s_both]">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-300 grid place-items-center text-black">⚡</div>
              <div>
                <div className="text-sm font-semibold">Bulk 100 video — Done</div>
                <div className="text-xs text-white/50">Selesai dalam 4m 12s • ZIP siap download</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-6 px-6 border-y border-white/[0.06] bg-white/[0.015]">
        <div className="max-w-[1180px] mx-auto">
          <p className="text-center text-[10px] sm:text-[11px] font-mono tracking-[0.15em] sm:tracking-[0.2em] text-white/30 uppercase mb-4 sm:mb-5">Trusted Providers • Auto Rotation • Load Balanced</p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 md:gap-3">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white/[0.04] border border-white/5 hover:border-[#00a8ff]/30 hover:bg-[#00a8ff]/10 transition-all hover:scale-105">
                <span className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full" style={{ background: p.dot }} />
                <span className="text-xs sm:text-sm font-medium text-white/80">{p.name}</span>
                <span className="hidden sm:inline text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">● online</span>
              </div>
            ))}
          </div>
        </div>
      </section>      <section id="features" className="py-16 sm:py-20 px-6">
        <div className="max-w-[1180px] mx-auto">
          <div className="max-w-[640px]">
            <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-mono tracking-widest uppercase text-blue-400/80">
              <span className="w-6 h-[1px] bg-blue-300/50" /> Fitur Lengkap
            </div>
            <h2 className="mt-3 text-[28px] sm:text-[32px] md:text-[42px] font-black tracking-[-0.02em] leading-none">
              Semua tools <span className="bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] bg-clip-text text-transparent">video AI</span> dalam satu studio
            </h2>
            <p className="mt-4 text-[14px] sm:text-[15px] text-white/50 leading-relaxed">Dari motion transfer sampai bulk UGC — semua provider, satu billing, satu dashboard.</p>
          </div>

          <div className="mt-8 sm:mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {features.map((f, i) => (
              <div key={f.title} className="group relative rounded-[20px] border border-white/[0.06] bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-5 sm:p-6 hover:border-[#00a8ff]/30 hover:from-[#00a8ff]/[0.06] hover:to-transparent transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,168,255,0.12)]" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${f.gradient} border border-white/5 grid place-items-center group-hover:scale-110 transition-transform duration-300`}>
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={f.icon} /></svg>
                </div>
                <h3 className="mt-3 sm:mt-4 text-[15px] sm:text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-1.5 sm:mt-2 text-[13px] sm:text-sm leading-relaxed text-white/45 group-hover:text-white/60 transition">{f.desc}</p>
                <div className="mt-3 sm:mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-300">
                  Coba sekarang
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18l6-6-6-6" /></svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="py-12 sm:py-16 px-6">
        <div className="max-w-[1180px] mx-auto rounded-[20px] sm:rounded-[28px] border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent p-6 sm:p-8 md:p-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
            <div>
              <div className="text-[10px] sm:text-[11px] font-mono tracking-[0.2em] uppercase text-white/30">Cara Kerja</div>
              <h2 className="mt-2 text-[22px] sm:text-[26px] md:text-[34px] font-bold tracking-tight">3 langkah — jadi</h2>
            </div>
            <p className="text-[13px] sm:text-sm text-white/45 max-w-[420px]">Upload, pilih model, generate. Background polling & notifikasi realtime, tinggal download.</p>
          </div>
          <div className="mt-6 sm:mt-8 grid sm:grid-cols-3 gap-3 sm:gap-4">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl bg-[#080818] border border-white/[0.06] p-5 sm:p-6 hover:border-[#00a8ff]/20 transition-colors">
                <div className="text-[11px] sm:text-[12px] font-mono tracking-widest text-blue-400">{s.n}</div>
                <div className="mt-2 text-[15px] sm:text-[16px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[13px] sm:text-sm text-white/45 leading-relaxed">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 px-6">
        <div className="max-w-[1180px] mx-auto grid lg:grid-cols-2 gap-5 sm:gap-6">
          <div className="rounded-[20px] sm:rounded-[24px] border border-white/5 bg-white/[0.02] p-5 sm:p-6">
            <div className="text-[13px] sm:text-sm font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Live Generate Preview
            </div>
            <div className="mt-3 sm:mt-4 grid grid-cols-2 gap-2 sm:gap-3">
              <div className="rounded-xl overflow-hidden bg-black border border-white/5 aspect-[3/4] relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-pink-500/20" />
                <div className="absolute bottom-2 left-2 text-[10px] sm:text-[11px] px-2 py-1 rounded-full bg-black/60 border border-white/10">Before • Foto</div>
              </div>
              <div className="rounded-xl overflow-hidden bg-black border border-white/5 aspect-[3/4] relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-cyan-500/20" />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="w-10 h-10 rounded-full bg-white text-black grid place-items-center hover:scale-110 transition-transform cursor-pointer">▶</div>
                </div>
                <div className="absolute bottom-2 left-2 text-[10px] sm:text-[11px] px-2 py-1 rounded-full bg-emerald-500 text-black font-bold">After • Video</div>
              </div>
            </div>
            <div className="mt-2 sm:mt-3 text-[11px] sm:text-xs text-white/40">Model: Wan 2.7 • 6s • 720p • Cost 42 credits</div>
          </div>
          <div className="rounded-[20px] sm:rounded-[24px] border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent p-5 sm:p-6 flex flex-col justify-center">
            <h3 className="text-[18px] sm:text-[22px] font-bold">Untuk creator yang butuh cepat — bukan ribet</h3>
            <p className="mt-2 text-[13px] sm:text-sm text-white/55 leading-relaxed">Template workflow siap pakai, history & gallery terpusat, ZIP download sekali klik. Fokus ke ide, biar sistem urus teknis.</p>
            <ul className="mt-4 sm:mt-5 space-y-2 sm:space-y-2.5 text-[13px] sm:text-sm">
              {['Background polling — tutup tab tetap jalan', 'Auto retry & fallback provider', 'Gallery + logs + credits ter-track rapi'].map((t) => (
                <li key={t} className="flex items-center gap-2 sm:gap-2.5 text-white/70"><span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/20 grid place-items-center text-emerald-400 shrink-0">✓</span>{t}</li>
              ))}
            </ul>
            <Link to="/register" className="mt-5 sm:mt-6 inline-flex w-fit px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-white text-black font-semibold hover:bg-white/90 transition-all hover:scale-[1.02] active:scale-[0.98]">Coba Gratis Sekarang</Link>
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 sm:py-20 px-6">
        <div className="max-w-[1180px] mx-auto">
          <div className="text-center max-w-[640px] mx-auto">
            <h2 className="text-[26px] sm:text-[30px] md:text-[40px] font-black tracking-tight">Pricing simpel — tanpa jebakan</h2>
            <p className="mt-3 text-[14px] sm:text-[15px] text-white/50">Mulai gratis. Upgrade kapan saja. Bayar via QRIS, konfirmasi WA.</p>
          </div>
          <div className="mt-8 sm:mt-10 grid md:grid-cols-3 gap-4 sm:gap-5">
            {pricing.map((p) => (
              <div key={p.name} className={`relative rounded-[20px] sm:rounded-[24px] border p-5 sm:p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 ${p.highlight ? 'bg-gradient-to-b from-blue-500/15 to-white/[0.03] border-blue-500/30 shadow-[0_16px_50px_rgba(0,168,255,0.18)] md:scale-[1.02]' : 'bg-white/[0.02] border-white/5 hover:border-white/10'}`}>
                {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] sm:text-[11px] font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] text-black">Paling Populer</div>}
                <div className="text-[13px] sm:text-sm font-semibold">{p.name}</div>
                <div className="mt-2 text-[28px] sm:text-[32px] font-black tracking-tight">{p.price}</div>
                <div className="text-[11px] sm:text-xs text-white/45">{p.sub}</div>
                <ul className="mt-4 sm:mt-5 space-y-2 text-[13px] sm:text-sm flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-white/70"><span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/20 grid place-items-center text-emerald-400 text-xs shrink-0">✓</span>{f}</li>
                  ))}
                </ul>
                <Link to="/register" className={`mt-5 sm:mt-6 w-full text-center px-5 py-3 rounded-xl font-semibold transition-all duration-300 ${p.highlight ? 'bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] text-black hover:shadow-[0_10px_24px_rgba(0,168,255,0.3)] hover:scale-[1.02]' : 'bg-white text-black hover:bg-white/90 hover:scale-[1.02]'}`}>{p.cta}</Link>
              </div>
            ))}
          </div>
          {providerPrices && (
            <div className="mt-8 sm:mt-10 rounded-[20px] border border-white/5 bg-white/[0.02] p-4 sm:p-5">
              <div className="flex items-center gap-2 text-[11px] sm:text-xs text-white/45 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Harga provider — tarif aktif dari server
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {providerPrices.nexabot && (
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4">
                    <div className="text-[12px] sm:text-[13px] font-semibold text-white/80">{providerPrices.nexabot.name}</div>
                    <div className="mt-1 text-[16px] sm:text-[18px] font-black tracking-tight">
                      {rp(providerPrices.nexabot.price_per_generate)}
                      <span className="text-[11px] font-normal text-white/40"> /generate</span>
                    </div>
                    <div className="text-[11px] text-white/40">Semua mode · min top up {rp(providerPrices.nexabot.min_topup)}</div>
                  </div>
                )}
                {(providerPrices.nexabot?.packages?.length
                  ? providerPrices.nexabot.packages
                  : providerPrices.nexabot?.package
                    ? [{ slug: 'unlimited_weekly', ...providerPrices.nexabot.package }]
                    : []
                ).map((pkg) => (
                  <div key={pkg.slug} className="rounded-xl border border-blue-500/25 bg-blue-500/[0.07] p-3 sm:p-4">
                    <div className="text-[12px] sm:text-[13px] font-semibold text-blue-200">Paket {pkg.label}</div>
                    <div className="mt-1 text-[16px] sm:text-[18px] font-black tracking-tight">{rp(pkg.price)}</div>
                    <div className="text-[11px] text-white/40">Generate tanpa batas selama {pkg.days} hari</div>
                  </div>
                ))}
                {providerPrices.createpulse && (
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4">
                    <div className="text-[12px] sm:text-[13px] font-semibold text-white/80">{providerPrices.createpulse.name}</div>
                    <div className="mt-1 text-[16px] sm:text-[18px] font-black tracking-tight">
                      {rp(providerPrices.createpulse.price_range.min)} – {rp(providerPrices.createpulse.price_range.max)}
                      <span className="text-[11px] font-normal text-white/40"> /generate</span>
                    </div>
                    <div className="text-[11px] text-white/40">Tergantung model · min top up {rp(providerPrices.createpulse.min_topup)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-center text-[11px] sm:text-xs text-white/30 mt-4">Butuh custom enterprise? <Link to="/register" className="text-blue-400 hover:underline">Chat admin di WhatsApp</Link> — respon &lt; 1 jam.</p>
        </div>
      </section>

      <section className="py-10 sm:py-12 px-6">
        <div className="max-w-[1180px] mx-auto grid sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {[
            { name: 'Riko • Fashion Seller', text: 'Bulk Fashion ngebantu banget. 1 model jadi 80 video katalog dalam 5 menit. Laku keras di Tiktok Shop.', stars: 5 },
            { name: 'Sinta • UGC Creator', text: 'Image to Video Wan & Grok hasilnya sinematik. Client puas, revisi minim.', stars: 5 },
            { name: 'Faezya Cell • Agency', text: 'Smart routing hemat credits. Token rotation otomatis, nggak pernah down pas deadline.', stars: 5 },
          ].map((t) => (
            <div key={t.name} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 sm:p-5 hover:border-white/10 transition-colors">
              <div className="text-blue-400 text-sm">{'★'.repeat(t.stars)}</div>
              <p className="mt-2 text-[13px] sm:text-sm leading-relaxed text-white/70">“{t.text}”</p>
              <div className="mt-2 sm:mt-3 text-[11px] sm:text-xs font-medium text-white/50">{t.name}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="py-12 sm:py-16 px-6">
        <div className="max-w-[820px] mx-auto">
          <h2 className="text-[22px] sm:text-[24px] md:text-[32px] font-bold tracking-tight text-center">FAQ</h2>
          <div className="mt-6 sm:mt-8 divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
            {faqs.map((f, i) => (
              <div key={f.q}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between gap-3 sm:gap-4 hover:bg-white/[0.02] transition">
                  <span className="text-[13px] sm:text-sm font-medium">{f.q}</span>
                  <span className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full border border-white/10 grid place-items-center shrink-0 transition-all duration-300 ${openFaq === i ? 'bg-white text-black rotate-0' : 'text-white/60'}`}>{openFaq === i ? '−' : '+'}</span>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-[13px] sm:text-sm leading-relaxed text-white/55">{f.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 px-6">
        <div className="max-w-[900px] mx-auto rounded-[20px] sm:rounded-[28px] border border-blue-500/20 bg-gradient-to-b from-blue-500/10 via-[#00a8ff]/5 to-transparent p-6 sm:p-8 md:p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(400px_200px_at_50%_0%,rgba(0,168,255,0.15),transparent)]" />
          <div className="relative">
            <img src="/arkx-logo.svg" alt="ARKX" className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl shadow-[0_8px_24px_rgba(0,168,255,0.3)]" />
            <h2 className="mt-4 sm:mt-5 text-[24px] sm:text-[28px] md:text-[36px] font-black tracking-tight">Siap berkreasi hari ini?</h2>
            <p className="mt-2 sm:mt-3 text-[14px] sm:text-[15px] text-white/50 max-w-[560px] mx-auto">Daftar gratis, dapat 5 generate. Tidak perlu kartu kredit. Upgrade kapan saja via QRIS.</p>
            <div className="mt-5 sm:mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/register" className="px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl bg-gradient-to-r from-[#00a8ff] to-[#00d4ff] text-black font-semibold hover:shadow-[0_12px_30px_rgba(0,168,255,0.35)] transition-all hover:scale-[1.02] active:scale-[0.98]">Daftar Sekarang — Gratis</Link>
              <Link to="/login" className="px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl border border-white/10 bg-white/[0.04] font-medium hover:bg-white/[0.08] transition-all hover:scale-[1.02]">Login</Link>
            </div>
            <p className="mt-3 text-[11px] sm:text-xs text-white/30">✓ 2,400+ creator bergabung • ✓ Support WA 1 jam</p>
          </div>
        </div>
      </section>

      <footer className="py-8 sm:py-10 px-6 border-t border-white/5">
        <div className="max-w-[1180px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/arkx-logo.svg" alt="ARKX" className="w-7 h-7 rounded-lg" />
            <span className="text-sm font-semibold">ARKXMotion Studio</span>
            <span className="text-xs text-white/30 hidden sm:inline">© 2026 • AI video generation platform</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-5 text-[11px] sm:text-xs text-white/40">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#pricing" className="hover:text-white transition">Pricing</a>
            <a href="#faq" className="hover:text-white transition">FAQ</a>
            <Link to="/login" className="hover:text-white transition">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
