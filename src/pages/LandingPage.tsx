import { Link } from 'react-router-dom'

const features = [
  {
    title: 'Motion Control',
    desc: 'Transfer motion dari video ke karakter. Kling V3 Pro, V2.6, Wan Motion - semua provider dalam satu platform.',
    icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  },
  {
    title: 'Image to Video',
    desc: 'Ubah foto jadi video bergerak. Gemini, Wan 2.7, Grok Imagine, Seedance - pilih model favoritmu.',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: 'Multi-Provider',
    desc: 'Weavy, Roboneo, Galleri5, Leonardo, OneOver, Framia - token rotation otomatis, load balancing cerdas.',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  },
  {
    title: 'Bulk Generation',
    desc: 'Generate ratusan video sekaligus. Upload CSV, set model, langsung jalan.',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
  {
    title: 'Smart Routing',
    desc: 'Otomatis pilih provider termurah & tercepat. Balance check real-time, auto-fallback saat error.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    title: 'UGC Studio',
    desc: 'Product photography & UGC content generation. Upload produk, pilih style, langsung hasil.',
    icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  },
]

const providers = [
  { name: 'Weavy', color: '#8b5cf6' },
  { name: 'Roboneo', color: '#ec4899' },
  { name: 'Galleri5', color: '#f59e0b' },
  { name: 'Leonardo', color: '#06b6d4' },
  { name: 'OneOver', color: '#a78bfa' },
  { name: 'Framia', color: '#10b981' },
  { name: 'Magnific', color: '#f43f5e' },
  { name: 'CreatePulse', color: '#3b82f6' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white overflow-hidden">
      <nav className="fixed top-0 w-full z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/arkx-logo.svg" alt="ARKXMotion" className="w-9 h-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight">ARKXMotion Studio</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="px-4 py-2 text-sm text-white/70 hover:text-white transition-colors">
              Login
            </Link>
            <Link
              to="/register"
              className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-orange-500 to-amber-400 text-black rounded-lg hover:opacity-90 transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 px-6">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-gradient-to-br from-orange-500/15 via-amber-400/8 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative">
          <div className="mb-10 flex justify-center">
            <img src="/arkx-logo.svg" alt="ARKXMotion Studio" className="w-40 h-40 md:w-52 md:h-52 drop-shadow-[0_0_60px_rgba(255,106,0,0.3)]" />
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            AI Video Generation Platform
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6">
            <span className="bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              Create Motion
            </span>
            <br />
            <span className="text-white/90">With AI Power</span>
          </h1>

          <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
            Satu platform untuk semua kebutuhan video AI - motion control, image-to-video, text-to-video.
            Multi-provider, smart routing, token rotation otomatis.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/register"
              className="px-8 py-3.5 text-base font-semibold bg-gradient-to-r from-orange-500 to-amber-400 text-black rounded-xl hover:shadow-lg hover:shadow-orange-500/25 transition-all"
            >
              Mulai Gratis
            </Link>
            <a
              href="#features"
              className="px-8 py-3.5 text-base font-medium text-white/60 border border-white/10 rounded-xl hover:bg-white/5 transition-all"
            >
              Pelajari Lebih Lanjut
            </a>
          </div>
        </div>
      </section>

      <section className="py-12 px-6 border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm text-white/30 mb-8 uppercase tracking-widest">Supported Providers</p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-12">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-sm font-medium text-white/70">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Semua yang Kamu Butuhkan</h2>
            <p className="text-white/40 max-w-xl mx-auto">
              Dari motion control hingga bulk production - ARKXMotion Studio punya semuanya.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={i}
                className="group p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-orange-500/30 hover:bg-orange-500/[0.03] transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-400/10 flex items-center justify-center mb-4 group-hover:from-orange-500/30 group-hover:to-amber-400/20 transition-all">
                  <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-white/90">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative p-12 rounded-3xl bg-gradient-to-b from-orange-500/10 to-transparent border border-orange-500/20">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <img src="/arkx-logo.svg" alt="ARKXMotion" className="w-20 h-20 rounded-2xl drop-shadow-lg" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mt-8 mb-4">Siap Berkreasi?</h2>
            <p className="text-white/40 mb-8 max-w-md mx-auto">
              Mulai generate video AI sekarang. Gratis untuk mulai, bayar sesuai pakai.
            </p>
            <Link
              to="/register"
              className="inline-block px-10 py-4 text-base font-semibold bg-gradient-to-r from-orange-500 to-amber-400 text-black rounded-xl hover:shadow-lg hover:shadow-orange-500/25 transition-all"
            >
              Daftar Sekarang
            </Link>
          </div>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/arkx-logo.svg" alt="ARKXMotion" className="w-6 h-6 rounded-md" />
            <span className="text-sm font-medium text-white/50">ARKXMotion Studio</span>
          </div>
          <p className="text-xs text-white/30">AI-powered creative content production platform</p>
        </div>
      </footer>
    </div>
  )
}
