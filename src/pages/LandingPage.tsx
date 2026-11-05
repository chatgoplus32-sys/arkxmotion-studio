import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Rocket, User, Play, Clapperboard, Image as ImageIcon, AudioWaveform, MonitorPlay,
  Layers, Mic, Zap, Gem, Infinity as InfinityIcon, Users, ChevronRight, Menu, X,
} from 'lucide-react'
import MotionControlDemo from '@/components/landing/MotionControlDemo'
import { DEFAULT_MEMBERSHIP_FEE } from '@/lib/membership'
import { DEFAULT_PRO_FEE } from '@/lib/pro'
import { isBoosterPackage, NEXABOT_BOOSTER_COMING_SOON } from '@/lib/nexabotWallet'

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

const NAV = [
  { id: 'beranda', label: 'Beranda' },
  { id: 'features', label: 'Fitur' },
  { id: 'pricing', label: 'Harga' },
  { id: 'tutorial', label: 'Tutorial' },
  { id: 'showcase', label: 'Karya' },
  { id: 'komunitas', label: 'Komunitas' },
]

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

const quickFeatures = [
  { label: 'AI Video Generator', Icon: Clapperboard, tint: 'text-cyan-300' },
  { label: 'AI Image Generator', Icon: ImageIcon, tint: 'text-blue-300' },
  { label: 'AI Audio & Music', Icon: AudioWaveform, tint: 'text-fuchsia-300' },
  { label: 'Upscale 2K / 4K', Icon: MonitorPlay, tint: 'text-cyan-200' },
  { label: 'Motion Control', Icon: Layers, tint: 'text-indigo-300' },
  { label: 'Lip-Sync & Avatar', Icon: Mic, tint: 'text-pink-300' },
]

const valueProps = [
  { title: 'Proses Super Cepat', sub: 'Hasil dalam Hitungan Menit', Icon: Zap },
  { title: 'Kualitas Cinematic', sub: 'Hingga 4K Ultra HD', Icon: Gem },
  { title: 'Fitur Lengkap', sub: 'Video, Image, Audio, Animasi', Icon: InfinityIcon },
  { title: 'Komunitas Kreatif', sub: 'Belajar, Berbagi & Berkembang', Icon: Users },
]

const showcase = [
  { title: 'Film & Series AI', img: '/landing/showcase-film.webp', alt: 'Adegan film fantasi kolosal dengan ksatria berarmor' },
  { title: 'Animasi & Anime', img: '/landing/showcase-anime.webp', alt: 'Karakter anime dengan rambut biru bercahaya' },
  { title: 'Video Promosi', img: '/landing/showcase-promo.webp', alt: 'Kreator wanita berbicara ke mikrofon di studio' },
  { title: 'Musik AI', img: '/landing/showcase-music.webp', alt: 'Penyanyi di panggung dengan lampu neon ungu' },
  { title: 'Konten Bisnis', img: '/landing/showcase-business.webp', alt: 'Rumah modern mewah saat jam biru' },
  { title: 'Edukasi & Animasi', img: '/landing/showcase-edu.webp', alt: 'Karakter animasi 3D anak dengan buku melayang' },
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

interface MemberPricing {
  fee: number
  proFee: number
}

interface PricingPlan {
  name: string
  price: string
  sub: string
  features: string[]
  cta: string
  highlight: boolean
  to: string
}

const buildPricing = (p: MemberPricing): PricingPlan[] => [
  {
    name: 'Pro Member',
    price: rp(p.fee),
    sub: 'sekali bayar · permanen',
    features: ['Semua fitur AI terbuka', 'Motion, I2V, UGC & bulk fashion', 'Gemini Tools + prompt template', 'Semua provider & smart routing', 'Support WA 1 jam', 'Token generate dibayar terpisah'],
    cta: 'Daftar Pro',
    highlight: true,
    to: '/register',
  },
  {
    name: 'Member Lama',
    price: rp(p.proFee),
    sub: 'upgrade sekali bayar · permanen',
    features: ['Khusus akun yang sudah terdaftar', 'Buka Gemini Tools, AI Song Cover & H3 Music Avatar', 'Fitur AI lain tetap terbuka', 'Sekali bayar · permanen', 'Token generate dibayar terpisah'],
    cta: 'Login & Upgrade',
    highlight: false,
    to: '/login',
  },
  {
    name: 'Token Generate',
    price: 'Mulai Rp 10.000',
    sub: 'top up sesuai pemakaian',
    features: ['Token tiap provider terpisah', 'Cek balance real-time', 'Auto-fallback saat token habis', 'Top up via QRIS'],
    cta: 'Lihat Harga Provider',
    highlight: false,
    to: '#provider-prices',
  },
]

const buildFaqs = (p: MemberPricing) => [
  { q: 'Apa itu ARKXMotion Studio?', a: 'Platform all-in-one untuk generate video AI. Satu dashboard untuk akses 8+ provider — Weavy, Roboneo, Galleri5, Leonardo, OneOver, Framia, Magnific, CreatePulse — dengan token rotation & smart routing otomatis.' },
  { q: 'Bagaimana sistem token & credits?', a: 'Saldo CreatePulse, NexaBot, dan Seavi diisi lewat halaman Saldo Layanan. Provider lain (Roboneo, Weavy, Framia, dll.) memakai kunci milikmu sendiri — top up-nya diajukan lewat Top Up Manual dan diverifikasi admin. Sistem cek balance realtime sebelum generate dan auto-fallback ke kunci/token lain jika habis atau error.' },
  { q: 'Apakah bisa bulk generate?', a: 'Bisa. Bulk Fashion mendukung 1 karakter + ratusan outfit sekaligus, parallel processing. Cocok untuk katalog fashion & UGC massal.' },
  { q: 'Apakah ada watermark?', a: 'ARKXMotion Studio tidak menambahkan watermark ke hasil generate. Tool Watermark Remover juga tersedia untuk video dari sumber lain — termasuk fitur Pro.' },
  { q: `Saya sudah punya akun, apa tetap bayar ${rp(p.fee)}?`, a: `Tidak. Harga join ${rp(p.fee)} untuk pendaftar baru. Member lama cukup upgrade ${rp(p.proFee)} sekali bayar untuk membuka Gemini Tools, AI Song Cover, dan H3 Music Avatar — fitur AI lainnya tetap terbuka tanpa upgrade. Biaya token generate tetap terpisah sesuai pemakaian.` },
  { q: 'Apa saja yang terbuka setelah jadi Pro?', a: 'Pendaftar baru yang join Pro langsung mendapat semua fitur AI. Member lama yang upgrade membuka tiga fitur premium: Gemini Tools, AI Song Cover, dan H3 Music Avatar. Sekali bayar, tanpa biaya bulanan.' },
]

/** Pita film dekoratif — perforasi berulang, dipakai di banner CTA bawah. */
function FilmStrip({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none flex h-8 items-center gap-3 px-2 ${className}`} aria-hidden="true">
      {Array.from({ length: 22 }).map((_, i) => (
        <span key={i} className="h-3.5 w-5 shrink-0 rounded-[3px] bg-white/10" />
      ))}
    </div>
  )
}

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [aktif, setAktif] = useState('beranda')
  // Kalau endpoint harga tidak bisa diakses, bagian ini cukup tidak tampil.
  const [providerPrices, setProviderPrices] = useState<ProviderPrices | null>(null)
  const [memberPricing, setMemberPricing] = useState<MemberPricing>({
    fee: DEFAULT_MEMBERSHIP_FEE,
    proFee: DEFAULT_PRO_FEE,
  })
  const pricing = buildPricing(memberPricing)
  const faqs = buildFaqs(memberPricing)

  useEffect(() => {
    let alive = true
    fetch('/api/public/pricing')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.providers) setProviderPrices(d.providers as ProviderPrices) })
      .catch(() => { /* opsional: biarkan kosong */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/membership/config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d) return
        const fee = Number(d.membershipFee)
        const proFee = Number(d.proFee)
        setMemberPricing({
          fee: Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_MEMBERSHIP_FEE,
          proFee: Number.isFinite(proFee) && proFee > 0 ? proFee : DEFAULT_PRO_FEE,
        })
      })
      .catch(() => { /* pakai harga default */ })
    return () => { alive = false }
  }, [])

  // Menu tengah menandai section yang sedang dibaca, bukan sekadar diklik.
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[]
    els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    if (!els.length) return
    let frame = 0
    const cek = () => {
      frame = 0
      const garis = window.innerHeight * 0.38
      let id = els[0].id
      for (const el of els) if (el.getBoundingClientRect().top <= garis) id = el.id
      const palingBawah = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4
      setAktif(palingBawah ? els[els.length - 1].id : id)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(cek) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    cek()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const glass = 'border-cyan-400/20 bg-slate-900/60 backdrop-blur-xl shadow-[0_0_30px_rgba(0,240,255,0.08)]'
  const ctaUtama = 'group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#0066FF] via-[#00C6FF] to-[#8B5CF6] px-6 py-3 text-[14px] sm:text-[15px] font-bold text-white shadow-[0_0_28px_rgba(0,102,255,0.45)] transition-all hover:shadow-[0_0_44px_rgba(0,198,255,0.6)] hover:-translate-y-0.5 active:translate-y-0'

  return (
    <div className="min-h-screen bg-[#050816] text-white overflow-x-hidden selection:bg-[#00F0FF]/30 [scroll-behavior:smooth]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400..900;1,600..900&display=swap');
        @keyframes floatY { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        @keyframes glowPulse { 0%,100% { opacity:.5 } 50% { opacity:.9 } }
        @keyframes spinSlow { to { transform: rotate(360deg) } }
        .animate-floatY { animation: floatY 6s ease-in-out infinite }
        .animate-glowPulse { animation: glowPulse 7s ease-in-out infinite }
        .animate-spinSlow { animation: spinSlow 26s linear infinite }
      `}</style>

      {/* ===================== A. STICKY GLASS NAVBAR ===================== */}
      <nav className="fixed top-0 z-50 w-full border-b border-cyan-400/10 bg-[#050816]/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between px-5 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <img src="/landing/arkx-icon.png" alt="ARKX" className="h-10 w-10 object-cover rounded-xl shadow-[0_0_22px_rgba(0,198,255,0.35)]" />
            <span className="text-[15px] font-black italic leading-none tracking-tight">
              <span className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-transparent">ARKX</span>
              <span className="text-white">MOTION</span>
              <span className="mt-0.5 block text-[9px] font-semibold not-italic tracking-[0.42em] text-cyan-300/70">STUDIO</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className="group relative px-3 py-2 text-[13.5px] font-medium text-white/60 transition hover:text-white">
                {n.label}
                <span className={`absolute -bottom-1 left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#0066FF] to-[#00F0FF] transition-all duration-300 ${aktif === n.id ? 'w-6 opacity-100 shadow-[0_0_10px_rgba(0,240,255,0.9)]' : 'w-0 opacity-0 group-hover:w-4 group-hover:opacity-70'}`} />
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/login" className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-white/80 backdrop-blur transition hover:border-cyan-400/40 hover:text-white sm:inline-flex">
              <User className="h-4 w-4" /> Login
            </Link>
            <Link to="/register" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#0066FF] to-[#8B5CF6] px-3.5 py-2 text-[13px] font-bold text-white shadow-[0_0_22px_rgba(0,102,255,0.5)] transition hover:shadow-[0_0_34px_rgba(139,92,246,0.65)] hover:-translate-y-0.5 sm:px-4">
              <Rocket className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Daftar Sekarang</span>
              <span className="sm:hidden">Daftar</span>
            </Link>
            <button onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu navigasi" className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 lg:hidden">
              {mobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileMenu && (
          <div className="border-t border-cyan-400/10 bg-[#050816]/95 px-5 py-4 backdrop-blur-2xl lg:hidden">
            <div className="grid grid-cols-2 gap-1">
              {NAV.map((n) => (
                <a key={n.id} href={`#${n.id}`} onClick={() => setMobileMenu(false)} className="rounded-xl px-3 py-2.5 text-sm text-white/75 transition hover:bg-cyan-400/10 hover:text-white">
                  {n.label}
                </a>
              ))}
            </div>
            <Link to="/login" onClick={() => setMobileMenu(false)} className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2.5 text-sm text-white/80">
              <User className="h-4 w-4" /> Login
            </Link>
          </div>
        )}
      </nav>

      {/* ===================== B. HERO ===================== */}
      <section id="beranda" className="relative scroll-mt-24 overflow-hidden pb-16 pt-[104px] sm:pt-[120px]">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_18%_-5%,rgba(0,102,255,0.28),transparent_65%),radial-gradient(760px_460px_at_88%_10%,rgba(139,92,246,0.22),transparent_60%),radial-gradient(620px_420px_at_60%_92%,rgba(0,240,255,0.14),transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(120,190,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,190,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_75%_55%_at_50%_0%,black_65%,transparent_105%)]" />
        </div>

        <div className="mx-auto grid max-w-[1240px] items-start gap-10 px-5 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <img src="/landing/arkx-icon.png" alt="" aria-hidden="true" className="h-9 w-9 object-cover rounded-lg shadow-[0_0_18px_rgba(0,198,255,0.4)]" />
              <span className="text-[13px] font-black italic tracking-wide">
                ARKX<span className="text-cyan-300">MOTION</span>
                <span className="ml-1.5 text-[9px] font-semibold not-italic tracking-[0.4em] text-white/45">STUDIO</span>
              </span>
            </div>

            <h1 className="mt-6 text-[38px] font-black italic leading-[0.98] tracking-[-0.03em] sm:text-[52px] md:text-[62px] lg:text-[50px] xl:text-[62px]">
              <span className="block text-white drop-shadow-[0_0_28px_rgba(0,102,255,0.35)]">Platform Kreatif AI</span>
              <span className="mt-1 block bg-gradient-to-r from-white via-[#7FE7FF] to-[#00F0FF] bg-clip-text text-[54px] leading-[0.92] text-transparent drop-shadow-[0_0_36px_rgba(0,240,255,0.45)] sm:text-[76px] md:text-[92px] lg:text-[74px] xl:text-[92px]">All-in-One</span>
            </h1>

            <p className="mt-6 max-w-[560px] text-[15px] leading-relaxed text-white/65 md:text-[17px]">
              Buat Video, Animasi, Film, Musik, dan Konten Kreatif Cinematic Berkualitas Tinggi dengan Teknologi AI Terkini.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register" className={ctaUtama}>
                <Rocket className="h-[18px] w-[18px] transition-transform group-hover:-translate-y-0.5" />
                Mulai Berkarya Sekarang
                <ChevronRight className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#demo" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-6 py-3 text-[14px] font-semibold text-white/85 backdrop-blur-xl transition hover:border-cyan-400/40 hover:bg-white/[0.09] hover:text-white sm:text-[15px]">
                <Play className="h-[18px] w-[18px]" fill="currentColor" /> Lihat Demo
              </a>
            </div>

            <p className="mt-4 text-[12.5px] text-white/40">
              Dipercaya 2,400+ kreator · 48k video ter-generate · {providers.length} provider AI dalam satu dashboard
            </p>

            <div className="mt-9 grid grid-cols-3 gap-3 sm:grid-cols-6 sm:gap-2.5">
              {quickFeatures.map(({ label, Icon, tint }) => (
                <div key={label} className={`group flex flex-col items-center gap-2 rounded-2xl ${glass} px-2 py-3.5 text-center transition hover:border-cyan-300/45 hover:shadow-[0_0_26px_rgba(0,240,255,0.18)]`}>
                  <Icon className={`h-6 w-6 ${tint} drop-shadow-[0_0_10px_rgba(0,240,255,0.55)] transition-transform group-hover:scale-110`} strokeWidth={1.7} />
                  <span className="text-[10px] font-semibold leading-tight text-white/70 sm:text-[10.5px]">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Seni hero + mockup laptop */}
          <div className="relative flex flex-col lg:block lg:min-h-[720px]">
            <div className="relative h-[300px] overflow-hidden rounded-[28px] border border-cyan-400/20 shadow-[0_0_60px_rgba(0,102,255,0.25)] sm:h-[360px] lg:absolute lg:inset-0 lg:h-auto">
              <img src="/landing/hero-fantasy.webp" alt="Ilustrasi sinematik ksatria dan putri dengan naga cahaya biru di langit malam" width={1024} height={1536} className="h-full w-full object-cover object-[50%_38%]" />
              <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#050816] via-[#050816]/55 to-transparent" />
            </div>

            {/* Ornamen pita film + clapperboard 3D */}
            <div className="absolute -right-2 top-6 hidden rotate-[18deg] opacity-70 lg:block">
              <FilmStrip className="h-7 flex-col" />
            </div>
            <div className="animate-spinSlow absolute -left-4 top-[26%] hidden h-20 w-20 place-items-center rounded-full border-2 border-cyan-300/30 bg-[#0A1128]/80 shadow-[0_0_28px_rgba(0,240,255,0.2)] backdrop-blur lg:grid">
              <span className="absolute h-3 w-3 rounded-full bg-cyan-300/70 shadow-[0_0_12px_#00F0FF]" />
              <span className="h-6 w-6 rounded-full border-2 border-cyan-300/40" />
            </div>

          </div>
        </div>
      </section>

      {/* ===================== C. VALUE PROPOSITION ===================== */}
      <section className="px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[1240px]">
          <div className="flex items-center justify-center gap-4">
            <span className="h-[1px] w-10 bg-gradient-to-r from-transparent to-cyan-300/60 sm:w-16" />
            <h2 className="text-center text-[22px] font-black italic tracking-tight sm:text-[30px]">Kenapa Pilih <span className="bg-gradient-to-r from-cyan-200 to-[#00F0FF] bg-clip-text text-transparent">ARKXMOTION STUDIO?</span></h2>
            <span className="h-[1px] w-10 bg-gradient-to-l from-transparent to-cyan-300/60 sm:w-16" />
          </div>

          <div className="mt-9 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {valueProps.map(({ title, sub, Icon }) => (
              <div key={title} className={`group rounded-2xl ${glass} p-5 transition hover:border-cyan-300/45 hover:shadow-[0_0_34px_rgba(0,240,255,0.16)]`}>
                <div className="flex items-center gap-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-[#0066FF]/25 to-[#8B5CF6]/15 shadow-[0_0_20px_rgba(0,102,255,0.25)]">
                    <Icon className="h-5 w-5 text-cyan-300 drop-shadow-[0_0_8px_rgba(0,240,255,0.7)]" strokeWidth={1.8} />
                  </span>
                  <div>
                    <div className="text-[15px] font-bold">{title}</div>
                    <div className="mt-0.5 text-[12.5px] text-white/50">{sub}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== D. SHOWCASE / USE CASE ===================== */}
      <section id="showcase" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[1240px]">
          <div className="text-center">
            <h2 className="text-[26px] font-black italic tracking-tight sm:text-[36px]">
              Kreasi <span className="bg-gradient-to-r from-[#0066FF] via-cyan-300 to-[#8B5CF6] bg-clip-text text-transparent">Tanpa Batas</span>
            </h2>
            <p className="mx-auto mt-3 max-w-[680px] text-[13.5px] text-white/55 sm:text-[15px]">
              Cocok untuk Kreator Konten, Film AI, Musik, Bisnis, Edukasi, hingga Hiburan.
            </p>
          </div>

          <div className="mt-9 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {showcase.map((s) => (
              <div key={s.title} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0A1128] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/50 hover:shadow-[0_0_36px_rgba(0,240,255,0.22)]">
                <div className="aspect-[3/4] w-full overflow-hidden">
                  <img src={s.img} alt={s.alt} width={768} height={1024} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                </div>
                <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#050816] via-[#050816]/70 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 backdrop-blur transition group-hover:border-cyan-300/60 group-hover:bg-cyan-400/20">
                    <Play className="ml-0.5 h-3 w-3" fill="currentColor" />
                  </span>
                  <span className="text-[12.5px] font-bold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">{s.title}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== E. BOTTOM CTA BANNER ===================== */}
      <section className="px-5 py-10 sm:px-6 sm:py-14">
        <div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-[26px] border border-cyan-400/35 bg-gradient-to-br from-[#0A1128] via-[#0b1430] to-[#120a2a] p-6 shadow-[0_0_54px_rgba(0,102,255,0.22)] sm:p-9">
          <div className="pointer-events-none absolute inset-x-0 -top-2 opacity-25"><FilmStrip /></div>
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 opacity-25"><FilmStrip /></div>
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[#8B5CF6]/25 blur-[70px]" />
          <div className="pointer-events-none absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-[#00F0FF]/15 blur-[70px]" />

          <div className="relative flex flex-col items-center justify-between gap-6 md:flex-row">
            <h2 className="max-w-[560px] text-[24px] font-black italic leading-tight tracking-tight sm:text-[32px]">
              Wujudkan Ide Kreatifmu<br className="hidden sm:block" /> Bersama <span className="bg-gradient-to-r from-cyan-200 to-[#00F0FF] bg-clip-text text-transparent">ARKXMOTION STUDIO</span>
            </h2>
            <Link to="/register" className={`${ctaUtama} w-full text-center md:w-auto`}>
              <Rocket className="h-[18px] w-[18px]" />
              <span className="text-left leading-tight">
                Daftar Sekarang
                <span className="block text-[11px] font-semibold text-white/70">& Dapatkan Akses Fitur Lengkap!</span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ===================== Provider strip ===================== */}
      <section className="border-y border-white/[0.06] bg-white/[0.015] px-5 py-6 sm:px-6">
        <div className="mx-auto max-w-[1240px]">
          <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 sm:mb-5 sm:text-[11px]">Trusted Providers • Auto Rotation • Load Balanced</p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 md:gap-3">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.04] px-3 py-1.5 transition-all hover:scale-105 hover:border-cyan-400/30 hover:bg-cyan-400/10 sm:px-4 sm:py-2">
                <span className="h-2 w-1.5 rounded-full sm:h-2 sm:w-2" style={{ background: p.dot }} />
                <span className="text-xs font-medium text-white/80 sm:text-sm">{p.name}</span>
                <span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400 sm:inline">● online</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== Fitur ===================== */}
      <section id="features" className="scroll-mt-24 px-5 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[640px]">
            <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-cyan-300/80">
              <span className="h-[1px] w-6 bg-cyan-300/50" /> Fitur Lengkap
            </div>
            <h2 className="mt-3 text-[28px] font-black italic leading-none tracking-[-0.02em] sm:text-[32px] md:text-[42px]">
              Semua tools <span className="bg-gradient-to-r from-[#0066FF] to-[#00F0FF] bg-clip-text text-transparent">video AI</span> dalam satu studio
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-white/50 sm:text-[15px]">Dari motion transfer sampai bulk UGC — semua provider, satu billing, satu dashboard.</p>
          </div>

          <div className="mt-8 grid gap-3.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className={`group rounded-[20px] ${glass} p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/45 hover:shadow-[0_14px_44px_rgba(0,240,255,0.14)] sm:p-6`}>
                <div className={`grid h-11 w-11 place-items-center rounded-xl border border-white/5 bg-gradient-to-br ${f.gradient} transition-transform duration-300 group-hover:scale-110 sm:h-12 sm:w-12`}>
                  <svg className="h-5 w-5 text-cyan-300 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={f.icon} /></svg>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold sm:text-[17px]">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/45 transition group-hover:text-white/60 sm:text-sm">{f.desc}</p>
                <div className="mt-4 inline-flex translate-y-1 items-center gap-1.5 text-xs font-medium text-cyan-300 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  Coba sekarang <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== Tutorial: cara kerja + demo ===================== */}
      <section id="tutorial" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[1240px] rounded-[24px] border border-cyan-400/15 bg-slate-900/40 p-6 backdrop-blur-xl sm:rounded-[28px] sm:p-8 md:p-10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">Tutorial</div>
              <h2 className="mt-2 text-[22px] font-black italic tracking-tight sm:text-[26px] md:text-[34px]">3 langkah — jadi</h2>
            </div>
            <p className="max-w-[420px] text-[13px] text-white/45 sm:text-sm">Upload, pilih model, generate. Background polling & notifikasi realtime, tinggal download.</p>
          </div>
          <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-white/[0.06] bg-[#050816]/70 p-5 transition-colors hover:border-cyan-400/30 sm:p-6">
                <div className="font-mono text-[12px] tracking-widest text-cyan-300">{s.n}</div>
                <div className="mt-2 text-[16px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-white/45 sm:text-sm">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="demo" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[1240px]">
          <div className="max-w-[640px]">
            <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-cyan-300/80">
              <span className="h-[1px] w-6 bg-cyan-300/50" /> Demo Motion Control
            </div>
            <h2 className="mt-3 text-[28px] font-black italic leading-none tracking-[-0.02em] sm:text-[32px] md:text-[42px]">
              Foto diam jadi <span className="bg-gradient-to-r from-[#0066FF] to-[#00F0FF] bg-clip-text text-transparent">video bergerak</span>
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-white/50 sm:text-[15px]">Lihat alurnya langsung — dari upload referensi, motion tracking, sampai video 5 detik siap. Geser garis untuk bandingkan sebelum & sesudah.</p>
          </div>

          <div className="mt-8 grid gap-5 sm:gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <MotionControlDemo />
            <div className="flex flex-col justify-center rounded-[22px] border border-cyan-400/20 bg-gradient-to-br from-[#0066FF]/12 to-transparent p-6 sm:rounded-[24px] sm:p-7">
              <h3 className="text-[18px] font-bold sm:text-[22px]">Untuk kreator yang butuh cepat — bukan ribet</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/55 sm:text-sm">Template workflow siap pakai, history & gallery terpusat, download sekali klik. Fokus ke ide, biar sistem urus teknis.</p>
              <ul className="mt-5 space-y-2.5 text-[13px] sm:text-sm">
                {['Kling V3 Pro, Wan & RoboNeo — pilih sesuai budget', 'Background polling — tutup tab tetap jalan', 'Auto retry & fallback provider', 'Gallery + logs + credits ter-track rapi'].map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-white/70">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-400/25 bg-cyan-400/10 text-[11px] text-cyan-300">✓</span>{t}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-[#0066FF] to-[#00F0FF] px-6 py-3 text-[14px] font-bold text-white shadow-[0_0_26px_rgba(0,102,255,0.45)] transition hover:shadow-[0_0_38px_rgba(0,240,255,0.55)]">Gabung Pro Sekarang</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== Harga ===================== */}
      <section id="pricing" className="scroll-mt-24 px-5 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto max-w-[640px] text-center">
            <h2 className="text-[26px] font-black italic tracking-tight sm:text-[30px] md:text-[40px]">Pricing jelas — Pro sekali bayar</h2>
            <p className="mt-3 text-[14px] text-white/50 sm:text-[15px]">Sekali bayar jadi Pro — semua fitur AI langsung terbuka untuk pendaftar baru. Belum termasuk token pemakaian. Bayar via QRIS, aktivasi oleh admin.</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3 sm:gap-5">
            {pricing.map((p) => (
              <div key={p.name} className={`relative flex flex-col rounded-[22px] border p-6 transition-all duration-300 hover:-translate-y-1 sm:rounded-[24px] sm:p-7 ${p.highlight ? 'border-cyan-400/40 bg-gradient-to-b from-[#0066FF]/18 to-slate-900/60 shadow-[0_18px_60px_rgba(0,102,255,0.25)] backdrop-blur-xl md:scale-[1.02]' : 'border-white/10 bg-slate-900/50 backdrop-blur-xl hover:border-cyan-400/30'}`}>
                {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#0066FF] to-[#00F0FF] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(0,240,255,0.5)]">Paling Populer</div>}
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-2 flex items-baseline"><span className="text-[32px] font-black tracking-tight">{p.price}</span></div>
                <div className="text-xs text-white/45">{p.sub}</div>
                <ul className="mt-5 flex-1 space-y-2 text-[13px] sm:text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-white/70"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-400/25 bg-cyan-400/10 text-[11px] text-cyan-300">✓</span>{f}</li>
                  ))}
                </ul>
                {p.to.startsWith('#')
                  ? <a href={p.to} className={`mt-6 w-full rounded-full px-5 py-3 text-center font-semibold transition-all ${p.highlight ? 'bg-gradient-to-r from-[#0066FF] to-[#00F0FF] text-white shadow-[0_0_24px_rgba(0,102,255,0.4)] hover:shadow-[0_0_36px_rgba(0,240,255,0.5)]' : 'border border-white/15 bg-white/[0.05] text-white hover:bg-white/10'}`}>{p.cta}</a>
                  : <Link to={p.to} className={`mt-6 w-full rounded-full px-5 py-3 text-center font-semibold transition-all ${p.highlight ? 'bg-gradient-to-r from-[#0066FF] to-[#00F0FF] text-white shadow-[0_0_24px_rgba(0,102,255,0.4)] hover:shadow-[0_0_36px_rgba(0,240,255,0.5)]' : 'border border-white/15 bg-white/[0.05] text-white hover:bg-white/10'}`}>{p.cta}</Link>}
              </div>
            ))}
          </div>

          {providerPrices && (
            <div id="provider-prices" className="mt-10 scroll-mt-24 rounded-[22px] border border-white/10 bg-slate-900/50 p-5 backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2 text-xs text-white/45 sm:text-[13px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
                Harga provider — tarif aktif dari server
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {providerPrices.nexabot && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[13px] font-semibold text-white/80">{providerPrices.nexabot.name}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">
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
                ).map((pkg) => {
                  const hanyaBooster = isBoosterPackage(pkg.slug)
                  return (
                  <div key={pkg.slug} className={`rounded-xl border p-4 ${hanyaBooster ? 'border-fuchsia-400/30 bg-fuchsia-500/[0.08]' : 'border-cyan-400/25 bg-[#0066FF]/[0.08]'}`}>
                    <div className={`text-[13px] font-semibold ${hanyaBooster ? 'text-fuchsia-200' : 'text-cyan-200'}`}>Paket {pkg.label}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">{rp(pkg.price)}</div>
                    <div className="text-[11px] text-white/40">
                      {hanyaBooster
                        ? `${NEXABOT_BOOSTER_COMING_SOON ? 'Coming soon · ' : ''}NexaDance 3.0 (20 detik 720p), Omni Flash 1.1 & GPT Image tanpa batas · mode lain tetap per generate`
                        : `Generate semua mode tanpa batas selama ${pkg.days} hari`}
                    </div>
                  </div>
                  )
                })}
                {providerPrices.createpulse && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[13px] font-semibold text-white/80">{providerPrices.createpulse.name}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">
                      {rp(providerPrices.createpulse.price_range.min)} – {rp(providerPrices.createpulse.price_range.max)}
                      <span className="text-[11px] font-normal text-white/40"> /generate</span>
                    </div>
                    <div className="text-[11px] text-white/40">Tergantung model · min top up {rp(providerPrices.createpulse.min_topup)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-[11px] text-white/30 sm:text-xs">Butuh custom enterprise? <Link to="/register" className="text-cyan-300 hover:underline">Chat admin di WhatsApp</Link> — respon &lt; 1 jam.</p>
        </div>
      </section>

      {/* ===================== Komunitas ===================== */}
      <section id="komunitas" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-7 text-center">
            <h2 className="text-[22px] font-black italic tracking-tight sm:text-[28px]">Komunitas <span className="bg-gradient-to-r from-cyan-200 to-[#00F0FF] bg-clip-text text-transparent">Kreatif</span></h2>
            <p className="mt-2 text-[13.5px] text-white/50">Belajar, berbagi & berkembang bersama kreator yang sudah pakai setiap hari.</p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3">
            {[
              { name: 'Riko • Fashion Seller', text: 'Bulk Fashion ngebantu banget. 1 model jadi 80 video katalog dalam 5 menit. Laku keras di Tiktok Shop.', stars: 5 },
              { name: 'Sinta • UGC Creator', text: 'Image to Video Wan & Grok hasilnya sinematik. Client puas, revisi minim.', stars: 5 },
              { name: 'Faezya Cell • Agency', text: 'Smart routing hemat credits. Token rotation otomatis, nggak pernah down pas deadline.', stars: 5 },
            ].map((t) => (
              <div key={t.name} className={`rounded-2xl ${glass} p-5 transition hover:border-cyan-300/40`}>
                <div className="text-sm text-cyan-300">{'★'.repeat(t.stars)}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-white/70 sm:text-sm">“{t.text}”</p>
                <div className="mt-3 text-[11px] font-medium text-white/50 sm:text-xs">{t.name}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== FAQ ===================== */}
      <section id="faq" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[820px]">
          <h2 className="text-center text-[22px] font-black italic tracking-tight sm:text-[24px] md:text-[32px]">FAQ</h2>
          <div className="mt-8 divide-y divide-white/5 overflow-hidden rounded-2xl border border-cyan-400/15 bg-slate-900/50 backdrop-blur-xl">
            {faqs.map((f, i) => (
              <div key={f.q}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.03]">
                  <span className="text-[13px] font-medium sm:text-sm">{f.q}</span>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-300 ${openFaq === i ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-200' : 'border-white/10 text-white/60'}`}>{openFaq === i ? '−' : '+'}</span>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="px-5 pb-5 text-[13px] leading-relaxed text-white/55 sm:text-sm">{f.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <img src="/landing/arkx-icon.png" alt="ARKX" className="h-7 w-7 object-cover rounded-lg" />
            <span className="text-sm font-bold italic">ARKXMOTION STUDIO</span>
            <span className="hidden text-xs text-white/30 sm:inline">© 2026 • AI video generation platform</span>
          </div>
          <div className="flex items-center gap-5 text-[11px] sm:text-xs">
            <a href="#features" className="text-white/40 transition hover:text-white">Fitur</a>
            <a href="#pricing" className="text-white/40 transition hover:text-white">Harga</a>
            <a href="#faq" className="text-white/40 transition hover:text-white">FAQ</a>
            <Link to="/login" className="text-white/40 transition hover:text-white">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
