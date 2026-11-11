import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Rocket, User, Play, Clapperboard, Image as ImageIcon, AudioWaveform, MonitorPlay,
  Layers, Mic, Zap, Gem, Infinity as InfinityIcon, Users, ChevronRight, Menu, X,
} from 'lucide-react'
import MotionControlDemo from '@/components/landing/MotionControlDemo'
import { DEFAULT_MEMBERSHIP_FEE, DEFAULT_MEMBERSHIP_FEE_ORIGINAL, WA_NUMBER } from '@/lib/membership'
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
  seavi?: {
    name: string
    price_per_token: number
    min_topup: number
    packages?: { slug: string; label: string; price: number; tokens?: number }[]
  }
}

/** Statistik nyata dari /api/public/stats (jumlah video selesai & provider). */
interface PublicStats {
  users?: number
  videos?: number
  providers?: number
  /** Kreator yang benar-benar pernah generate (distinct user di log). */
  active_users?: number
  /** Halaman tool dengan generate selesai terbanyak (tanpa data pribadi). */
  top_pages?: { page: string; count: number }[]
}

/** Nama halaman di log → label yang dibaca manusia. */
const PAGE_LABEL: Record<string, string> = {
  'image-to-video': 'Image to Video',
  motion: 'Motion Control',
  'song-cover': 'AI Song Cover',
  'h3-music-avatar': 'H3 Music Avatar',
  'bulk-fashion': 'Bulk Fashion',
  ugc: 'UGC Studio',
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

/**
 * Ringkas angka besar untuk social proof: 1.272 → "1,3rb".
 * Format Indonesia pakai titik untuk ribuan dan koma untuk desimal.
 */
const ringkas = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')}rb`
  return String(n)
}

/**
 * Link WhatsApp admin. Dulu CTA "Chat admin di WhatsApp" menunjuk ke
 * /register — salah tujuan dan menutup kanal konversi. Sekarang benar-benar
 * membuka WhatsApp dengan pesan pembuka.
 */
const WA_ADMIN_URL = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(
  'Halo admin ARKXMotion Studio, saya butuh informasi untuk paket custom enterprise.',
)}`

const NAV = [
  { id: 'beranda', label: 'Beranda' },
  { id: 'features', label: 'Fitur' },
  { id: 'showcase', label: 'Karya' },
  { id: 'tutorial', label: 'Tutorial' },
  { id: 'demo', label: 'Demo' },
  { id: 'pricing', label: 'Harga' },
  { id: 'komunitas', label: 'Komunitas' },
]

/**
 * Provider yang benar-benar terhubung di app (lihat ProviderId di
 * src/stores/providerManager.ts). Daftar lama masih 8 provider padahal
 * integrasi sudah jauh lebih banyak — landing terlihat basi.
 */
const providers = [
  { name: 'Weavy', dot: '#8b5cf6' },
  { name: 'Roboneo', dot: '#ec4899' },
  { name: 'RunningHub', dot: '#22d3ee' },
  { name: 'CreatePulse', dot: '#3b82f6' },
  { name: 'NexaBot', dot: '#a3e635' },
  { name: 'Seavi', dot: '#f97316' },
  { name: 'Galleri5', dot: '#f59e0b' },
  { name: 'Leonardo', dot: '#06b6d4' },
  { name: 'OneOver', dot: '#a78bfa' },
  { name: 'Framia', dot: '#10b981' },
  { name: 'Magnific', dot: '#f43f5e' },
  { name: 'WaveSpeed', dot: '#38bdf8' },
  { name: 'Shotstack', dot: '#fb923c' },
  { name: 'Creatomate', dot: '#c084fc' },
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

interface FeatureItem {
  title: string
  desc: string
  icon: string
  gradient: string
  /** Fitur premium — dibuka lewat paket Pro / upgrade member lama. */
  pro?: boolean
}

const features: FeatureItem[] = [
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
  {
    title: 'Virtual Try-On',
    desc: 'Pakai outfit dan aksesori digital ke foto model — untuk katalog dan lookbook.',
    icon: 'M16 7l4 3-4 3M8 7L4 10l4 3M14 4l-4 16',
    gradient: 'from-fuchsia-500/20 to-pink-500/10',
    pro: true,
  },
  {
    title: 'AI Music & Song Cover',
    desc: 'Buat lagu AI dari nol, atau cover lagu favorit dengan vokal sendiri.',
    icon: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z',
    gradient: 'from-purple-500/20 to-indigo-500/10',
    pro: true,
  },
  {
    title: 'Voice Over & Avatar',
    desc: 'Avatar AI bicara dengan suara pilihanmu — untuk konten dan penjelasan produk.',
    icon: 'M19 10v2a7 7 0 01-14 0v-2a7 7 0 0114 0zM12 19v3m-4 0h8',
    gradient: 'from-sky-500/20 to-cyan-500/10',
    pro: true,
  },
  {
    title: 'ARKX AUTO Studio',
    desc: 'Edit video, UGC Pro dan auto-motion dalam satu studio AI (Gemini Tools).',
    icon: 'M11 3H4a1 1 0 00-1 1v16a1 1 0 001 1h16a1 1 0 001-1v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
    gradient: 'from-cyan-500/20 to-blue-500/10',
    pro: true,
  },
  {
    title: 'Watermark Remover',
    desc: 'Hapus watermark dari video milikmu sendiri, termasuk dari sumber lain.',
    icon: 'M4 4h16v16H4zM8 12l3 3 5-6',
    gradient: 'from-teal-500/20 to-emerald-500/10',
  },
  {
    title: 'Clip & Highlight',
    desc: 'Potong video panjang jadi klip pendek, plus Second Brain untuk riset konten.',
    icon: 'M8 6v12l8-6-8-6zM4 4h16v16H4z',
    gradient: 'from-orange-500/20 to-amber-500/10',
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
  /** Harga normal sebelum promo — ditampilkan sebagai harga coret. */
  originalFee: number
}

interface PricingPlan {
  name: string
  price: string
  sub: string
  features: string[]
  cta: string
  highlight: boolean
  to: string
  /** Harga coret + label hemat (hanya untuk paket join baru). */
  was?: string
  saving?: string
}

const buildPricing = (p: MemberPricing): PricingPlan[] => [
  {
    name: 'Join Pro Baru',
    price: rp(p.fee),
    was: p.originalFee > p.fee ? rp(p.originalFee) : undefined,
    saving: p.originalFee > p.fee ? `Hemat ${rp(p.originalFee - p.fee)}` : undefined,
    sub: 'sekali bayar · permanen',
    features: ['Semua fitur AI terbuka', 'Motion, I2V, UGC & bulk fashion', 'Virtual Try-On, AI Music, Voice Over & ARKX AUTO Studio', 'Semua provider & smart routing', 'Support WA 1 jam', 'Token generate dibayar terpisah'],
    cta: 'Daftar Pro',
    highlight: true,
    to: '/register',
  },
  {
    name: 'Upgrade Member Lama',
    price: rp(p.proFee),
    sub: 'upgrade sekali bayar · permanen',
    features: ['Khusus akun yang sudah terdaftar', 'Buka ARKX AUTO Studio, Gemini Tools, AI Song Cover & H3 Music Avatar', 'Fitur AI lain tetap terbuka', 'Sekali bayar · permanen', 'Token generate dibayar terpisah'],
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
  { q: 'Apa itu ARKXMotion Studio?', a: 'Platform all-in-one untuk generate video AI. Satu dashboard untuk akses 20 provider — Weavy, Roboneo, RunningHub, CreatePulse, NexaBot, Seavi, Galleri5, Leonardo, OneOver, Framia, Magnific, WaveSpeed, Shotstack, Creatomate dan lainnya — dengan token rotation & smart routing otomatis.' },
  { q: 'Bagaimana sistem token & credits?', a: 'Saldo CreatePulse, NexaBot, dan Seavi diisi lewat halaman Saldo Layanan. Provider lain (Roboneo, Weavy, Framia, dll.) memakai kunci milikmu sendiri — top up-nya diajukan lewat Top Up Manual dan diverifikasi admin. Sistem cek balance realtime sebelum generate dan auto-fallback ke kunci/token lain jika habis atau error.' },
  { q: 'Apakah bisa bulk generate?', a: 'Bisa. Bulk Fashion mendukung 1 karakter + ratusan outfit sekaligus, parallel processing. Cocok untuk katalog fashion & UGC massal.' },
  { q: 'Apakah ada watermark?', a: 'ARKXMotion Studio tidak menambahkan watermark ke hasil generate. Tool Watermark Remover juga tersedia untuk video dari sumber lain — termasuk fitur Pro.' },
  { q: `Saya sudah punya akun, apa tetap bayar ${rp(p.fee)}?`, a: `Tidak. Harga join ${rp(p.fee)} untuk pendaftar baru. Member lama cukup upgrade ${rp(p.proFee)} sekali bayar untuk membuka ARKX AUTO Studio, Gemini Tools, AI Song Cover, dan H3 Music Avatar — fitur AI lainnya tetap terbuka tanpa upgrade. Biaya token generate tetap terpisah sesuai pemakaian.` },
  { q: 'Apa saja yang terbuka setelah jadi Pro?', a: 'Pendaftar baru yang join Pro langsung mendapat semua fitur AI. Member lama yang upgrade membuka empat fitur premium: ARKX AUTO Studio, Gemini Tools, AI Song Cover, dan H3 Music Avatar. Sekali bayar, tanpa biaya bulanan.' },
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
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [memberPricing, setMemberPricing] = useState<MemberPricing>({
    fee: DEFAULT_MEMBERSHIP_FEE,
    proFee: DEFAULT_PRO_FEE,
    originalFee: DEFAULT_MEMBERSHIP_FEE_ORIGINAL,
  })
  const pricing = buildPricing(memberPricing)
  const faqs = buildFaqs(memberPricing)
  // CTA WhatsApp mengambang baru muncul setelah visitor melewati hero supaya
  // tidak menutupi CTA utama saat first impression.
  const [showWaFab, setShowWaFab] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowWaFab(window.scrollY > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // FAQPage JSON-LD: pertanyaan & jawaban diambil dari daftar faqs yang sama
  // dengan yang dirender supaya schema tidak pernah beda dengan isi halaman
  // (harga di FAQ ikut berubah kalau admin mengubah biaya membership).
  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = 'faq-jsonld'
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
    document.head.appendChild(script)
    return () => { script.remove() }
    // faqs berubah hanya kalau harga membership selesai dimuat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberPricing])

  useEffect(() => {
    let alive = true
    fetch('/api/public/pricing')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.providers) setProviderPrices(d.providers as ProviderPrices) })
      .catch(() => { /* opsional: biarkan kosong */ })
    return () => { alive = false }
  }, [])

  // Angka sosial (jumlah video, provider) diambil dari server supaya tidak
  // pernah jadi klaim basi. Kalau endpoint mati, baris ini jatuh ke teks
  // yang tidak menyebut angka.
  useEffect(() => {
    let alive = true
    fetch('/api/public/stats')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d?.ok) setStats({ users: d.users, videos: d.videos, providers: d.providers, active_users: d.active_users, top_pages: d.top_pages }) })
      .catch(() => { /* biarkan null */ })
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
        const originalFee = Number(d.membershipFeeOriginal)
        setMemberPricing({
          fee: Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_MEMBERSHIP_FEE,
          proFee: Number.isFinite(proFee) && proFee > 0 ? proFee : DEFAULT_PRO_FEE,
          originalFee: Number.isFinite(originalFee) && originalFee > 0 ? originalFee : DEFAULT_MEMBERSHIP_FEE_ORIGINAL,
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
        /* Font Inter sudah dimuat via <link> di index.html. @import di sini
           hanya menambah permintaan CSS yang memblokir render. */
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
          <Link to="/" className="flex shrink-0 items-center">
            <img src="/landing/arkx-logo-brand.webp" alt="ARKX Motion Studio" width={640} height={214} className="h-10 w-auto object-contain drop-shadow-[0_0_18px_rgba(0,198,255,0.35)]" />
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
            <Link to="/register" onClick={() => setMobileMenu(false)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0066FF] to-[#8B5CF6] px-3 py-3 text-sm font-bold text-white shadow-[0_0_22px_rgba(0,102,255,0.4)]">
              Daftar Sekarang
            </Link>
          </div>
        )}
      </nav>

      {/* Semua section halaman ada di dalam <main> supaya ada satu landmark
          utama (Lighthouse: "landmark-one-main"). Nav & footer tetap di luar. */}
      <main>
      {/* ===================== B. HERO ===================== */}
      <section id="beranda" className="relative scroll-mt-24 overflow-hidden pb-16 pt-[104px] sm:pt-[120px]">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_18%_-5%,rgba(0,102,255,0.28),transparent_65%),radial-gradient(760px_460px_at_88%_10%,rgba(139,92,246,0.22),transparent_60%),radial-gradient(620px_420px_at_60%_92%,rgba(0,240,255,0.14),transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(120,190,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,190,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_75%_55%_at_50%_0%,black_65%,transparent_105%)]" />
        </div>

        <div className="mx-auto grid max-w-[1240px] items-start gap-10 px-5 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
          <div className="relative z-10">
            <div className="flex items-center">
              <img src="/landing/arkx-logo-brand.webp" alt="ARKX Motion Studio" width={640} height={214} className="h-9 w-auto object-contain drop-shadow-[0_0_16px_rgba(0,198,255,0.4)]" />
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

            <div className="mt-4 flex items-center gap-3">
              {/* Avatar inisial dulu hardcode 'RA','DP',... — keduanya fiktif.
                  Sekarang angka kreator aktif diambil dari log generate. */}
              {stats?.active_users ? (
                <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#050816] bg-gradient-to-br from-[#0066FF]/80 to-[#8B5CF6]/80 text-[9px] font-bold text-white ring-1 ring-cyan-400/20">
                  +{stats.active_users}
                </span>
              ) : (
                <span className="relative flex h-8 w-8 items-center justify-center" aria-hidden="true">
                  <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
              )}
              <p className="text-[12px] leading-tight text-white/60">
                {stats?.videos ? (
                  <>
                    <span className="font-bold text-white/85">{ringkas(stats.videos)} video</span> sudah dibuat
                    {stats?.active_users ? <> oleh <span className="font-bold text-white/85">{stats.active_users} kreator</span></> : null}<br />
                    <span className="text-[10.5px] text-white/55">{stats.providers ?? 20} provider AI · auto rotation & fallback</span>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-white/85">{stats?.providers ?? 20} provider AI</span> terhubung<br />
                    <span className="text-[10.5px] text-white/55">Auto rotation, load balancing & fallback otomatis</span>
                  </>
                )}
              </p>
            </div>

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
              {/* 3 ukuran (480/800/1024): kolom hero di layar besar ~560px dan
                  300–360px di ponsel, jadi 480px sudah cukup untuk DPR 1–2;
                  file 1024px (236 KB) hanya diunduh di desktop hi-DPI. */}
              <img
                src="/landing/hero-fantasy-800.webp"
                srcSet="/landing/hero-fantasy-480.webp 480w, /landing/hero-fantasy-800.webp 800w, /landing/hero-fantasy.webp 1024w"
                sizes="(min-width: 1024px) 560px, calc(100vw - 40px)"
                alt="Ilustrasi sinematik ksatria dan putri dengan naga cahaya biru di langit malam"
                width={1024}
                height={1536}
                fetchPriority="high"
                className="h-full w-full object-cover object-[50%_38%]"
              />
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
          <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 sm:mb-5 sm:text-[11px]">
            {stats?.providers ?? 20} Provider Terhubung • Auto Rotation • Load Balanced
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 md:gap-3">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.04] px-3 py-1.5 transition-all hover:scale-105 hover:border-cyan-400/30 hover:bg-cyan-400/10 sm:px-4 sm:py-2">
                <span className="h-2 w-1.5 rounded-full sm:h-2 sm:w-2" style={{ background: p.dot }} />
                <span className="text-xs font-medium text-white/80 sm:text-sm">{p.name}</span>
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
              <div key={f.title} className={`group relative rounded-[20px] ${glass} p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/45 hover:shadow-[0_14px_44px_rgba(0,240,255,0.14)] sm:p-6`}>
                <div className={`grid h-11 w-11 place-items-center rounded-xl border border-white/5 bg-gradient-to-br ${f.gradient} transition-transform duration-300 group-hover:scale-110 sm:h-12 sm:w-12`}>
                  <svg className="h-5 w-5 text-cyan-300 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={f.icon} /></svg>
                </div>
                <div className="mt-4 flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold sm:text-[17px]">{f.title}</h3>
                  {f.pro && (
                    <span className="shrink-0 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-fuchsia-200">
                      Pro
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-white/65 transition group-hover:text-white/75 sm:text-sm">{f.desc}</p>
                <div className="mt-4 inline-flex translate-y-1 items-center gap-1.5 text-xs font-medium text-cyan-300 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  Coba sekarang <ChevronRight className="h-3.5 w-3.5" />
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
              <Link key={s.title} to="/register" aria-label={`Coba ${s.title}`} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0A1128] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/50 hover:shadow-[0_0_36px_rgba(0,240,255,0.22)]">
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
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== Tutorial: cara kerja + demo ===================== */}
      <section id="tutorial" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[1240px] rounded-[24px] border border-cyan-400/15 bg-slate-900/40 p-6 backdrop-blur-xl sm:rounded-[28px] sm:p-8 md:p-10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">Tutorial</div>
              <h2 className="mt-2 text-[22px] font-black italic tracking-tight sm:text-[26px] md:text-[34px]">3 langkah — jadi</h2>
            </div>
            <p className="max-w-[420px] text-[13px] text-white/65 sm:text-sm">Upload, pilih model, generate. Background polling & notifikasi realtime, tinggal download.</p>
          </div>
          <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-white/[0.06] bg-[#050816]/70 p-5 transition-colors hover:border-cyan-400/30 sm:p-6">
                <div className="font-mono text-[12px] tracking-widest text-cyan-300">{s.n}</div>
                <div className="mt-2 text-[16px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-white/65 sm:text-sm">{s.desc}</div>
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
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[32px] font-black tracking-tight">{p.price}</span>
                  {p.was && (
                    <span className="text-[15px] font-medium text-white/65 line-through decoration-white/40">{p.was}</span>
                  )}
                </div>
                {p.saving && (
                  <span className="mt-2 inline-flex w-fit items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                    {p.saving}
                  </span>
                )}
                <div className="mt-2 text-xs text-white/65">{p.sub}</div>
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

          {/* Blok ini SELALU dirender. CTA "Lihat Harga Provider" menuju anchor
              #provider-prices — kalau bloknya hilang saat fetch harga gagal,
              anchor itu jadi target hantu dan klik tidak melakukan apa-apa. */}
          <div id="provider-prices" className="mt-10 scroll-mt-24 rounded-[22px] border border-white/10 bg-slate-900/50 p-5 backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2 text-xs text-white/65 sm:text-[13px]">
              <span className={`h-1.5 w-1.5 rounded-full bg-cyan-300 ${providerPrices ? 'animate-pulse' : ''}`} />
              Harga provider — tarif aktif dari server
            </div>
            {providerPrices ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {providerPrices.nexabot && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[13px] font-semibold text-white/80">{providerPrices.nexabot.name}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">
                      {rp(providerPrices.nexabot.price_per_generate)}
                      <span className="text-[11px] font-normal text-white/65"> /generate</span>
                    </div>
                    <div className="text-[11px] text-white/65">Semua mode · min top up {rp(providerPrices.nexabot.min_topup)}</div>
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
                    <div className="text-[11px] text-white/65">
                      {hanyaBooster
                        ? `${NEXABOT_BOOSTER_COMING_SOON ? 'Coming soon · ' : ''}NexaDance 3.0 (20 detik 720p), Omni Flash 1.2 & GPT Image tanpa batas · mode lain tetap per generate`
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
                      <span className="text-[11px] font-normal text-white/65"> /generate</span>
                    </div>
                    <div className="text-[11px] text-white/65">Tergantung model · min top up {rp(providerPrices.createpulse.min_topup)}</div>
                  </div>
                )}
                {providerPrices.seavi && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[13px] font-semibold text-white/80">{providerPrices.seavi.name}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">
                      {rp(providerPrices.seavi.price_per_token)}
                      <span className="text-[11px] font-normal text-white/65"> /token</span>
                    </div>
                    <div className="text-[11px] text-white/65">1 token dipakai per generate · min top up {rp(providerPrices.seavi.min_topup)}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-white/60">
                Harga provider belum termuat. Muat ulang halaman, atau tanya langsung ke admin — tarif provider
                berbeda per model dan sering diperbarui.{' '}
                <a href={WA_ADMIN_URL} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline decoration-cyan-300/50 underline-offset-2 hover:decoration-cyan-300">Chat admin di WhatsApp</a>
              </p>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] text-white/60 sm:text-xs">Butuh custom enterprise? <a href={WA_ADMIN_URL} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline decoration-cyan-300/50 underline-offset-2 hover:decoration-cyan-300">Chat admin di WhatsApp</a> — respon &lt; 1 jam.</p>
        </div>
      </section>

      {/* ===================== Komunitas ===================== */}
      {/* Testimoni dulu kutipan fiktif ("Riko", "Sinta", "Faezya Cell") yang
          tidak pernah dikirim user mana pun — berisiko false claim di iklan.
          Diganti angka pemakaian asli dari log platform. */}
      <section id="komunitas" className="scroll-mt-24 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-7 text-center">
            <h2 className="text-[22px] font-black italic tracking-tight sm:text-[28px]">Komunitas <span className="bg-gradient-to-r from-cyan-200 to-[#00F0FF] bg-clip-text text-transparent">Kreatif</span></h2>
            <p className="mt-2 text-[13.5px] text-white/50">Bukan klaim papan bintang — ini angka pemakaian asli dari log platform, diperbarui otomatis.</p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              stats?.videos != null && { label: 'Video AI selesai dibuat', value: ringkas(stats.videos) },
              stats?.active_users != null && { label: 'Kreator yang sudah generate', value: String(stats.active_users) },
              stats?.providers != null && { label: 'Provider AI terhubung', value: String(stats.providers) },
              { label: 'Respon support WA', value: '< 1 jam' },
            ].filter(Boolean).map((s) => (
              <div key={s!.label} className={`rounded-2xl ${glass} p-5 text-center transition hover:border-cyan-300/40`}>
                <div className="text-[28px] font-black tracking-tight text-white sm:text-[32px]">{s!.value}</div>
                <div className="mt-1 text-[12px] text-white/60 sm:text-[13px]">{s!.label}</div>
              </div>
            ))}
          </div>

          {stats?.top_pages && stats.top_pages.length > 0 && (
            <div className="mx-auto mt-5 max-w-[640px] rounded-2xl border border-cyan-400/15 bg-white/[0.03] px-5 py-4">
              <p className="text-center text-[13px] leading-relaxed text-white/65 sm:text-sm">
                Tool paling sering dipakai komunitas:{' '}
                {stats.top_pages.map((t, i) => (
                  <span key={t.page}>
                    {i > 0 && ', '}
                    <span className="font-semibold text-cyan-300">{PAGE_LABEL[t.page] ?? t.page}</span>
                    <span className="text-white/55"> ({ringkas(t.count)})</span>
                  </span>
                ))}
              </p>
            </div>
          )}

          <div className="mt-6 text-center">
            <a href={WA_ADMIN_URL} target="_blank" rel="noopener noreferrer" className={`${ctaUtama} mx-auto`}>
              <Rocket className="h-[18px] w-[18px]" />
              Gabung Komunitas via WhatsApp
            </a>
            <p className="mt-3 text-[11px] text-white/55">Berbagi hasil, tips & update fitur bareng kreator lain.</p>
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
                <button
                  id={`faq-btn-${i}`}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-panel-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.03]"
                >
                  <span className="text-[13px] font-medium sm:text-sm">{f.q}</span>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-300 ${openFaq === i ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-200' : 'border-white/10 text-white/60'}`} aria-hidden="true">{openFaq === i ? '−' : '+'}</span>
                </button>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  aria-labelledby={`faq-btn-${i}`}
                  className={`overflow-hidden transition-all duration-300 ${openFaq === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                >
                  <div className="px-5 pb-5 text-[13px] leading-relaxed text-white/65 sm:text-sm">{f.a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      </main>

      <footer className="border-t border-white/5 px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-4">
            <img src="/landing/arkx-logo-brand.webp" alt="ARKX Motion Studio" width={640} height={214} className="h-8 w-auto object-contain" />
            <span className="hidden text-xs text-white/60 sm:inline">© 2026 • AI video generation platform</span>
          </div>
          <div className="flex items-center gap-5 text-[11px] sm:text-xs">
            <a href="#features" className="text-white/65 transition hover:text-white">Fitur</a>
            <a href="#pricing" className="text-white/65 transition hover:text-white">Harga</a>
            <a href="#faq" className="text-white/65 transition hover:text-white">FAQ</a>
            <Link to="/login" className="text-white/65 transition hover:text-white">Login</Link>
          </div>
        </div>
      </footer>

      {/* CTA WhatsApp mengambang — muncul setelah visitor melewati hero.
          target _blank supaya visitor tidak kehilangan halaman landing. */}
      <a
        href={WA_ADMIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat admin di WhatsApp (tab baru)"
        className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-[#25D366] py-3 pl-4 pr-5 font-semibold text-white shadow-[0_8px_28px_rgba(37,211,102,0.45)] transition-all duration-300 hover:scale-105 hover:bg-[#20bd5a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] sm:bottom-6 sm:right-6 ${showWaFab ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <path d="M12.04 2a9.9 9.9 0 0 0-8.51 14.93L2 22l5.22-1.49A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 1 1-4.13 15.06l-.3-.18-3.1.89.9-3.02-.2-.31A8.1 8.1 0 0 1 12.04 3.8Zm-3.1 4.06c-.17 0-.45.06-.68.31-.24.24-.9.88-.9 2.14 0 1.25.91 2.46 1.04 2.63.13.17 1.79 2.86 4.45 3.89 2.19.85 2.63.7 3.1.65.48-.04 1.53-.63 1.75-1.23.21-.61.21-1.13.15-1.24-.06-.11-.24-.17-.5-.3-.26-.13-1.53-.76-1.77-.85-.24-.09-.41-.13-.59.13-.17.26-.68.85-.83 1.02-.15.18-.31.2-.57.07-.26-.13-1.1-.4-2.1-1.29-.77-.69-1.29-1.54-1.44-1.8-.15-.26-.02-.4.11-.53.11-.11.26-.3.39-.46.13-.15.17-.26.26-.44.09-.17.04-.33-.02-.46-.07-.13-.59-1.4-.81-1.92-.2-.48-.4-.42-.57-.43h-.47Z" />
        </svg>
        Chat Admin
      </a>
    </div>
  )
}
