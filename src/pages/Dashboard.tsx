import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { useProviderManager } from '@/stores/providerManager'
import { useAuthStore } from '@/stores/authStore'
import { calculateStats, DashboardStats } from '@/lib/stats'
import { checkAllProviderHealth, HEALTH_PROVIDERS, ProviderHealth } from '@/lib/providerHealth'
import {
  Video, Image, Zap, Wand2, Route, Key, ArrowRight, Music,
  BarChart3, Target, Clock3, Trophy, Coins, RefreshCw, Loader2,
  CheckCircle2, XCircle, Gauge, ChevronRight, Flame, TrendingUp, Activity,
  Play, Crown, Sparkles, Gift, Headphones, ShoppingBag, ArrowUpRight, Scissors,
  HelpCircle, MessageCircle, ArrowUp, BookOpen, Shield
} from 'lucide-react'

const STATUS_META: Record<string, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]', label: 'Online', text: 'text-emerald-400' },
  busy: { dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]', label: 'Sibuk', text: 'text-amber-400' },
  down: { dot: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]', label: 'Down', text: 'text-red-400' },
  nokey: { dot: 'bg-white/20', label: 'No key', text: 'text-white/40' },
}

function AnimatedCounter({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const displayRef = useRef(0)
  const ref = useRef<number | null>(null)
  useEffect(() => {
    const start = displayRef.current
    const diff = value - start
    if (diff === 0) return
    const startTime = performance.now()
    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = Math.round(start + diff * eased)
      displayRef.current = next
      setDisplay(next)
      if (progress < 1) ref.current = requestAnimationFrame(animate)
    }
    ref.current = requestAnimationFrame(animate)
    return () => { if (ref.current) cancelAnimationFrame(ref.current) }
  }, [value, duration])
  return <>{display.toLocaleString('id-ID')}</>
}

function MiniBarChart({ data, maxBars = 7 }: { data: Array<{ date: string; count: number }>; maxBars?: number }) {
  const bars = data.slice(-maxBars)
  const maxVal = Math.max(...bars.map((b) => b.count), 1)
  return (
    <div className="flex items-end gap-1.5 h-[88px] pt-2">
      {bars.map((bar, i) => {
        const h = Math.max((bar.count / maxVal) * 100, 6)
        const dayLabel = new Date(bar.date).toLocaleDateString('id-ID', { weekday: 'short' })
        const isToday = bar.date === new Date().toISOString().slice(0, 10)
        return (
          <div key={bar.date} className="flex-1 flex flex-col items-center gap-1.5 group">
            <span className="text-[11px] font-medium text-white/70 opacity-0 group-hover:opacity-100 transition bg-black/60 px-1.5 py-0.5 rounded-full border border-white/10">{bar.count}</span>
            <div className={`w-full rounded-t-lg transition-all duration-700 ${isToday ? 'bg-gradient-to-t from-[#00A8FF] to-cyan-300 shadow-[0_0_12px_rgba(0,168,255,0.4)]' : 'bg-gradient-to-t from-cyan-500/20 to-cyan-500/40 group-hover:from-[#00A8FF]/50 group-hover:to-cyan-400/60'}`} style={{ height: `${h}%`, minHeight: '6px', transitionDelay: `${i * 40}ms` }} />
            <span className={`text-[10px] font-mono ${isToday ? 'text-cyan-300 font-bold' : 'text-white/35'}`}>{dayLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

function CircularProgress({ value, size = 52, strokeWidth = 4, color = 'stroke-emerald-400' }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-white/10" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeLinecap="round" className={`${color} transition-all duration-1000 drop-shadow-[0_0_6px_currentColor]`} strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-black text-white">{value}%</span>
    </div>
  )
}

interface RecentActivity { id: string; type: string; title: string; time: string; status: 'done' | 'error'; url?: string }

function getRecentActivity(): RecentActivity[] {
  const items: RecentActivity[] = []
  try {
    const gallery = JSON.parse(localStorage.getItem('arkxmotion.upscaler.gallery') || '[]')
    gallery.slice(0, 5).forEach((g: any) => items.push({ id: g.id, type: 'upscaler', title: `Upscale: ${g.sourceName || 'image'}`, time: g.createdAt, status: 'done', url: g.url }))
  } catch (e) { console.warn('[Dashboard] Failed to load upscaler gallery:', e) }
  try {
    const raw = localStorage.getItem('arkxmotion.bg_logs')
    if (raw) {
      const logs = JSON.parse(raw)
      logs.slice(-5).reverse().forEach((l: any) => items.push({ id: l.time + l.msg, type: 'background', title: l.msg, time: l.time, status: l.level === 'error' ? 'error' : 'done' }))
    }
  } catch (e) { console.warn('[Dashboard] Failed to load background logs:', e) }
  return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8)
}

const QUICK_TOOLS = [
  { label: 'Motion Control', desc: 'Video gerakan → karakter AI', icon: <Scissors className="h-6 w-6" />, href: '/generate/motion', grad: 'from-[#0066FF] to-[#00A8FF]' },
  { label: 'Image to Video', desc: 'Foto jadi video sinematik', icon: <Video className="h-6 w-6" />, href: '/generate/image-to-video', grad: 'from-[#7B2FFF] to-[#B14DFF]' },
  { label: 'Text to Image', desc: 'Prompt → gambar AI', icon: <Image className="h-6 w-6" />, href: '/generate/image', grad: 'from-[#00C853] to-[#00E676]' },
  { label: 'Video Upscale', desc: '4K / HD · 30 fps', icon: <ArrowUp className="h-6 w-6" />, href: '/generate/video-upscaler', grad: 'from-[#0066FF] to-[#00D4FF]' },
  { label: 'Bulk Fashion', desc: '1 model · 100 outfit', icon: <ShoppingBag className="h-6 w-6" />, href: '/generate/bulk-fashion', grad: 'from-[#FF6B35] to-[#FF3D68]' },
  { label: 'Voice Over', desc: 'AI voice · podcast & karaoke', icon: <Music className="h-6 w-6" />, href: '/generate/voice-over', grad: 'from-[#00A8FF] to-[#7B2FFF]' },
  { label: 'AI Upscaler', desc: 'Upscale & retouch foto', icon: <Wand2 className="h-6 w-6" />, href: '/generate/upscaler', grad: 'from-[#8B5CF6] to-[#C084FC]' },
  { label: 'Song Cover', desc: 'Reimagine lagu kamu', icon: <Zap className="h-6 w-6" />, href: '/generate/song-cover', grad: 'from-[#FFB020] to-[#FF8A00]' },
]

const HELP_LINKS = [
  { label: 'Pusat Bantuan', icon: <BookOpen className="h-4 w-4" />, href: '/quick-start' },
  { label: 'Top Up & Saldo', icon: <Coins className="h-4 w-4" />, href: '/saldo' },
  { label: 'Hubungi Support', icon: <MessageCircle className="h-4 w-4" />, href: '/settings' },
  { label: 'Request Fitur', icon: <Sparkles className="h-4 w-4" />, href: '/plugins' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const { keys, routing, fetchMaintenance } = useProviderManager()
  const user = useAuthStore((s) => s.user)
  const isPro = user?.role === 'admin' || user?.plan === 'pro'
  const [activity, setActivity] = useState<RecentActivity[]>([])
  const [genStats, setGenStats] = useState<DashboardStats | null>(null)
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthAt, setHealthAt] = useState<number | null>(null)

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 11) return 'Selamat pagi'
    if (h < 15) return 'Selamat siang'
    if (h < 19) return 'Selamat sore'
    return 'Selamat malam'
  }, [])

  const runHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const h = await checkAllProviderHealth()
      setHealth(h)
      setHealthAt(Date.now())
    } finally { setHealthLoading(false) }
  }, [])

  useEffect(() => {
    fetchMaintenance()
    setActivity(getRecentActivity())
    setGenStats(calculateStats())
    const interval = setInterval(() => { setActivity(getRecentActivity()); setGenStats(calculateStats()) }, 10000)
    return () => clearInterval(interval)
  }, [fetchMaintenance])

  useEffect(() => {
    runHealth()
    const interval = setInterval(runHealth, 60000)
    return () => clearInterval(interval)
  }, [runHealth])

  const keyStats = useMemo(() => {
    const allProviders = ['weavy', 'wavespeed', 'roboneo', 'framia', 'leonardo', 'galleri5', 'oneover', 'firefly', 'createpulse'] as const
    let activeKeys = 0, totalKeys = 0
    const providerKeys: Record<string, number> = {}
    allProviders.forEach((p) => {
      const k = (keys as any)[p] || []
      totalKeys += k.length
      activeKeys += k.filter((kk: any) => kk.status === 'active' || kk.status === 'unknown').length
      if (k.length > 0) providerKeys[p] = k.length
    })
    return { activeKeys, totalKeys, providerKeys, providerCount: Object.keys(providerKeys).length }
  }, [keys])

  const healthSummary = useMemo(() => {
    let online = 0, busy = 0, down = 0
    const allProviders = [...HEALTH_PROVIDERS, 'wavespeed']
    allProviders.forEach((p) => {
      const h = health[p]
      if (!h) return
      if (h.status === 'online') online++
      else if (h.status === 'busy') busy++
      else if (h.status === 'down') down++
    })
    return { online, busy, down, total: allProviders.length }
  }, [health])

  const hasData = (genStats?.totalGenerates || 0) > 0
  const planName = user?.role === 'admin' ? 'Unlimited Member Pro' : user?.plan === 'pro' ? 'Pro Plan' : 'Free Plan'

  return (
    <PageContent className="space-y-4 sm:space-y-5">

      {/* ============ HERO BANNER ============ */}
      <section className="relative overflow-hidden rounded-[26px] border border-cyan-400/25 bg-[#050A15] shadow-[0_0_60px_rgba(0,102,255,0.35)]">
        {/* Artwork */}
        <img
          src="/landing/hero-fantasy.webp"
          alt="ARKXMotion Studio — ksatria & putri di dunia fantasi"
          className="pointer-events-none absolute inset-y-0 right-[-20%] hidden h-full w-[62%] object-cover object-[60%_38%] opacity-90 sm:block lg:right-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#050A15] via-[#050A15]/85 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[45%] bg-gradient-to-l from-[#050A15]/10 via-transparent to-transparent" />
        <div className="pointer-events-none absolute -right-10 top-1/3 h-64 w-64 rounded-full bg-[#00A8FF]/10 blur-[80px]" />

        <div className="relative p-5 sm:p-7 lg:p-8 max-w-[560px]">
          <div className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">
            <Sparkles className="h-4 w-4" /> ARKXMOTION STUDIO
          </div>
          <h1 className="mt-3 text-[30px] font-black italic leading-[0.98] tracking-tight sm:text-[38px] lg:text-[42px]">
            <span className="bg-gradient-to-r from-white via-cyan-100 to-cyan-200 bg-clip-text text-transparent">AI Creative Suite</span><br />
            <span className="bg-gradient-to-r from-[#00A8FF] via-cyan-300 to-[#7B2FFF] bg-clip-text text-transparent">All-in-One</span>
          </h1>
          <p className="mt-3 max-w-[420px] text-[13px] leading-relaxed text-cyan-100/60 sm:text-[14px]">
            Buat Video, Gambar, Animasi, Lip-Sync, hingga Upscale dengan Teknologi AI Generasi Terbaru.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button onClick={() => navigate('/generate/motion')} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#00A8FF] to-[#00D4FF] px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_28px_rgba(0,168,255,0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(0,212,255,0.7)]">
              <Play className="h-4 w-4" fill="currentColor" /> Mulai Generate
            </button>
            <button onClick={() => navigate('/quick-start')} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white/85 backdrop-blur transition hover:border-cyan-400/40 hover:bg-white/[0.1]">
              <BookOpen className="h-4 w-4" /> Lihat Tutorial
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-cyan-100/45">
            <Shield className="h-3.5 w-3.5 text-emerald-400" /> {healthSummary.online}/{healthSummary.total} providers online · 2.400+ kreator terdaftar
          </div>
        </div>
      </section>

      {/* ============ STATS ROW ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {[
          { label: 'Credits Terpakai', value: genStats?.totalCredits || 0, icon: Coins, text: 'text-amber-400', grad: 'from-amber-500/15 to-yellow-500/5', border: 'border-amber-400/20' },
          { label: 'Paket Aktif', value: planName, isText: true, icon: Crown, text: 'text-purple-300', grad: 'from-[#7B2FFF]/20 to-[#8B5CF6]/5', border: 'border-purple-400/25' },
          { label: 'Total Generate', value: genStats?.totalGenerates || 0, icon: Video, text: 'text-cyan-300', grad: 'from-cyan-500/15 to-blue-500/5', border: 'border-cyan-400/20', trend: true },
          { label: 'Success Rate', value: genStats?.successRate || 0, suffix: '%', icon: Target, text: 'text-emerald-400', grad: 'from-emerald-500/15 to-teal-500/5', border: 'border-emerald-400/20' },
        ].map((c, i) => (
          <div key={c.label} className={`relative overflow-hidden rounded-2xl border ${c.border} bg-gradient-to-br ${c.grad} p-3.5 sm:p-4 transition hover:-translate-y-0.5`} style={{ animationDelay: `${i * 50}ms` }}>
            <div className={`flex items-center gap-2.5 ${c.isText ? '' : ''}`}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] border border-white/10"><c.icon className={`h-4 w-4 ${c.text}`} /></div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40">{c.label}</div>
                <div className={`text-lg font-black leading-tight ${c.text} truncate`}>
                  {c.isText ? c.value : <><AnimatedCounter value={c.value as number} />{c.suffix || ''}</>}
                </div>
              </div>
            </div>
            {c.trend && hasData && <div className="absolute right-3 top-3 inline-flex items-center gap-0.5 rounded-full border border-emerald-400/25 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400"><TrendingUp className="h-2.5 w-2.5" /> +{Math.round((genStats?.successRate || 0) * 0.2 + 1)}%</div>}
          </div>
        ))}
      </div>

      {/* ============ MAIN GRID ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">

          {/* QUICK GENERATE */}
          <Card variant="bordered" className="overflow-hidden border-cyan-400/15 bg-gradient-to-b from-[#0B1526] to-[#0A1128]">
            <CardHeader className="pb-2.5">
              <CardTitle className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#00A8FF] to-[#00D4FF] shadow-[0_0_16px_rgba(0,168,255,0.45)]"><Zap className="h-4 w-4 text-black" /></span>
                <span className="font-bold">Quick Generate</span>
                <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-cyan-300/70">Semua Mode</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {QUICK_TOOLS.map((tool) => (
                  <button key={tool.label} onClick={() => navigate(tool.href)} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-3 text-left transition-all hover:-translate-y-0.5 hover:border-cyan-400/30 hover:shadow-[0_8px_28px_rgba(0,168,255,0.18)]">
                    <div className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${tool.grad} text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-110`}>{tool.icon}</div>
                    <div className="mt-2.5 text-[12px] font-bold leading-tight text-white">{tool.label}</div>
                    <div className="mt-0.5 text-[9px] leading-tight text-white/45">{tool.desc}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* RIWAYAT GENERAT TERBARU */}
          <Card variant="bordered" className="overflow-hidden border-cyan-400/15 bg-[#0B1526]/60">
            <CardHeader className="pb-2.5">
              <CardTitle className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#00A8FF]/25 to-cyan-400/10 text-cyan-300"><Clock3 className="h-4 w-4" /></span>
                <span className="font-bold">Riwayat Generate Terbaru</span>
                <button onClick={() => navigate('/hasil')} className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-cyan-300 transition hover:text-cyan-200">Semua <ChevronRight className="h-3 w-3" /></button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <div className="py-6 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]"><Clock3 className="h-6 w-6 text-white/25" /></div>
                  <p className="mt-3 text-sm font-medium">Belum ada riwayat</p>
                  <p className="mt-1 text-xs text-white/35">Generate pertamamu akan muncul di sini</p>
                  <button onClick={() => navigate('/generate/motion')} className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-white/90">Mulai Generate</button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {activity.slice(0, 6).map((item) => (
                    <div key={item.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#13233C] to-[#0A1128] p-2">
                      <div className="grid aspect-square w-full place-items-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-600/20">
                        {item.status === 'done' ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <XCircle className="h-6 w-6 text-red-400" />}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-1">
                        <span className="truncate text-[8px] font-medium text-white/55">{item.title}</span>
                        <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold text-emerald-400">Selesai</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* STATS CHART + PROVIDER HEALTH */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            {/* Statistics */}
            <Card variant="bordered" className="overflow-hidden border-cyan-400/15 bg-[#0B1526]/60 md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#7B2FFF]/30 to-purple-600/20 text-purple-300"><BarChart3 className="h-4 w-4" /></span>
                  <span className="font-bold text-sm">Statistik Generate</span>
                  <span className="ml-auto text-[10px] font-mono text-white/30">30 hari terakhir</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {genStats && genStats.generatesByDay.length > 0 ? (
                  <>
                    <div className="flex items-end justify-between">
                      <div><div className="text-2xl font-black text-white"><AnimatedCounter value={genStats.totalGenerates} /></div><div className="text-[9px] font-bold uppercase tracking-widest text-white/40">Total Generate</div></div>
                      {hasData && <div className="text-right text-emerald-400"><span className="flex items-center justify-end gap-0.5 text-sm font-black"><TrendingUp className="h-4 w-4" />+{Math.max(genStats.successRate - 70, 1).toFixed(0)}%</span><span className="text-[9px] text-white/35">Success rate</span></div>}
                    </div>
                    <MiniBarChart data={genStats.generatesByDay} maxBars={10} />
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
                      <div><div className="text-base font-black text-emerald-400"><AnimatedCounter value={genStats.successfulGenerates} /></div><div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Sukses</div></div>
                      <div><div className="text-base font-black text-red-400"><AnimatedCounter value={genStats.failedGenerates} /></div><div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Gagal</div></div>
                      <div><div className="text-base font-black text-white">{genStats.avgDurationSec}s</div><div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Rata-rata</div></div>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center"><BarChart3 className="mx-auto h-8 w-8 text-white/15" /><p className="mt-2 text-xs font-medium text-white/35">Belum ada data 30 hari terakhir</p></div>
                )}
              </CardContent>
            </Card>

            {/* Provider Health */}
            <Card variant="bordered" className="overflow-hidden border-cyan-400/15 bg-[#0B1526]/60 md:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-500/25 to-teal-500/15 text-emerald-400"><Gauge className="h-4 w-4" /></span>
                  <span className="font-bold text-sm">Status Provider AI</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="hidden items-center gap-1.5 sm:flex text-[10px]"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" /><span className="font-bold text-emerald-400">{healthSummary.online}</span></span>
                    <span className="hidden items-center gap-1.5 sm:flex text-[10px]"><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="font-bold text-amber-400">{healthSummary.busy}</span></span>
                    <span className="hidden items-center gap-1.5 sm:flex text-[10px]"><span className="h-2 w-2 rounded-full bg-red-400" /><span className="font-bold text-red-400">{healthSummary.down}</span></span>
                    <button onClick={runHealth} disabled={healthLoading} className="h-7 w-7 grid place-items-center rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition disabled:opacity-50">{healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-1.5">
                  {[...HEALTH_PROVIDERS, 'wavespeed'].slice(0, 10).map((provider) => {
                    const h = health[provider]
                    const k = (keys as any)[provider] || []
                    const active = k.filter((x: any) => x.status === 'active' || x.status === 'unknown').length
                    const meta = h ? STATUS_META[h.status] : STATUS_META.nokey
                    const latencyColor = h?.latencyMs != null ? (h.latencyMs < 400 ? 'text-emerald-400' : h.latencyMs < 900 ? 'text-amber-400' : 'text-red-400') : 'text-white/30'
                    return (
                      <a key={provider} href="/providers" className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 transition-all hover:border-cyan-400/20 hover:bg-white/[0.04]">
                        <span className="text-[10px] font-semibold text-white/75 truncate">{provider}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {h ? <span className={`text-[9px] font-bold ${meta.text}`}>{meta.label}</span> : <span className="text-[9px] font-mono text-white/35">{k.length > 0 ? `${active}/${k.length}` : 'no key'}</span>}
                          <span className={`text-[9px] font-mono ${latencyColor}`}>{h?.latencyMs ?? '—'}ms</span>
                          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                        </span>
                      </a>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ============ RIGHT RAIL ============ */}
        <aside className="space-y-4">
          {/* Paket Anda */}
          <div className="relative overflow-hidden rounded-2xl border border-purple-400/25 bg-gradient-to-br from-[#1A1033] via-[#150E29] to-[#0A1128] p-5 shadow-[0_0_34px_rgba(123,47,255,0.22)]">
            <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#7B2FFF]/25 blur-2xl" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2"><Crown className="h-4 w-4 text-yellow-400" fill="currentColor" /><span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-400/90">Paket Saya</span></div>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400">Aktif</span>
            </div>
            <div className="relative mt-3">
              <div className="text-lg font-black leading-tight text-white">{planName}</div>
              <div className="text-[11px] text-purple-300/60">{isPro ? 'Generasi Unlimited · Akses fitur premium terbuka' : 'Upgrade ke Pro untuk akses tanpa batas'}</div>
              <ul className="mt-3 space-y-1.5 text-[11px] text-purple-100/70">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Generate Tanpa Batas</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Akses Semua Model Premium</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Prioritas & Kualitas 4K</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Prioritas Server</li>
              </ul>
              {!isPro && <button onClick={() => navigate('/upgrade-pro')} className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#7B2FFF] to-[#B44DFF] px-4 py-2 text-xs font-bold text-white shadow-[0_0_24px_rgba(123,47,255,0.5)] transition hover:-translate-y-0.5">Upgrade Sekarang</button>}
            </div>
          </div>

          {/* Update & Informasi */}
          <Card variant="bordered" className="border-cyan-400/15 bg-[#0B1526]/60">
            <CardHeader className="pb-2.5">
              <CardTitle className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-cyan-500/25 to-teal-500/15 text-cyan-300"><Gift className="h-4 w-4" /></span>
                <span className="font-bold text-sm">Update & Informasi</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <button onClick={() => navigate('/saldo')} className="flex w-full items-center gap-2.5 rounded-xl border border-purple-400/20 bg-gradient-to-r from-purple-500/15 to-pink-500/10 p-2.5 text-left transition hover:border-purple-400/35">
                <Gift className="h-5 w-5 shrink-0 text-pink-400" />
                <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-wider text-pink-300">Promo Spesial</div><div className="text-[10px] leading-tight text-white/60 truncate">Unlimited Mingguan — Rp 250.000an</div></div>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/30" />
              </button>
              <button onClick={() => navigate('/generate/video-upscaler')} className="flex w-full items-center gap-2.5 rounded-xl border border-cyan-400/15 bg-cyan-500/10 p-2.5 text-left transition hover:border-cyan-400/30">
                <ArrowUp className="h-5 w-5 shrink-0 text-cyan-400" />
                <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Fitur Baru</div><div className="text-[10px] leading-tight text-white/60 truncate">Video Upscale 2K/4K · HD · 30fps</div></div>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/30" />
              </button>
              <button onClick={() => navigate('/quick-start')} className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-left transition hover:border-white/20">
                <BookOpen className="h-5 w-5 shrink-0 text-amber-400" />
                <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-wider text-amber-300">Panduan</div><div className="text-[10px] leading-tight text-white/60 truncate">Cara generate video AI pertama kamu</div></div>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/30" />
              </button>
            </CardContent>
          </Card>

          {/* Bantuan Cepat */}
          <Card variant="bordered" className="border-cyan-400/15 bg-[#0B1526]/60">
            <CardHeader className="pb-2.5">
              <CardTitle className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-500/25 to-cyan-500/15 text-emerald-400"><Headphones className="h-4 w-4" /></span>
                <span className="font-bold text-sm">Bantuan Cepat</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {HELP_LINKS.map((h) => (
                <button key={h.label} onClick={() => navigate(h.href)} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition-all hover:border-cyan-400/25 hover:bg-white/[0.04]">
                  <span className="text-cyan-300">{h.icon}</span>
                  <span className="text-[10px] font-semibold text-white/70 leading-tight">{h.label}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageContent>
  )
}
