import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { useProviderManager } from '@/stores/providerManager'
import { useAuthStore } from '@/stores/authStore'
import { calculateStats, DashboardStats } from '@/lib/stats'
import { checkAllProviderHealth, HEALTH_PROVIDERS, ProviderHealth } from '@/lib/providerHealth'
import {
  Video, Image, Zap, ShoppingBag, Wand2,
  Route, Key, Clock, ArrowRight,
  BarChart3, Target, Clock3, Trophy, Coins, RefreshCw, Loader2,
  CheckCircle2, XCircle, Gauge, Sparkles, ChevronRight, Flame, Play, TrendingUp, Activity, ShieldCheck, ArrowUpRight
} from 'lucide-react'

const STATUS_META: Record<string, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]', label: 'Online', text: 'text-emerald-400' },
  busy: { dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]', label: 'Sibuk', text: 'text-amber-400' },
  down: { dot: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]', label: 'Down', text: 'text-red-400' },
  nokey: { dot: 'bg-white/20', label: 'No key', text: 'text-white/40' },
}

function AnimatedCounter({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<number | null>(null)
  useEffect(() => {
    const start = display
    const diff = value - start
    if (diff === 0) return
    const startTime = performance.now()
    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + diff * eased))
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
            <div className={`w-full rounded-t-lg transition-all duration-700 ${isToday ? 'bg-gradient-to-t from-amber-500 to-yellow-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]' : 'bg-gradient-to-t from-white/10 to-white/20 group-hover:from-[#d4a017]/40 group-hover:to-[#ffd700]/60'}`} style={{ height: `${h}%`, minHeight: '6px', transitionDelay: `${i * 40}ms` }} />
            <span className={`text-[11px] font-mono ${isToday ? 'text-amber-300 font-bold' : 'text-white/35'}`}>{dayLabel}</span>
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
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold">{value}%</span>
    </div>
  )
}

interface RecentActivity { id: string; type: string; title: string; time: string; status: 'done' | 'error'; url?: string }

function getRecentActivity(): RecentActivity[] {
  const items: RecentActivity[] = []
  try {
    const gallery = JSON.parse(localStorage.getItem('arkxmotion.upscaler.gallery') || '[]')
    gallery.slice(0, 5).forEach((g: any) => items.push({ id: g.id, type: 'upscaler', title: `Upscale: ${g.sourceName || 'image'}`, time: g.createdAt, status: 'done', url: g.url }))
  } catch {}
  try {
    const raw = localStorage.getItem('arkxmotion.bg_logs')
    if (raw) {
      const logs = JSON.parse(raw)
      logs.slice(-5).reverse().forEach((l: any) => items.push({ id: l.time + l.msg, type: 'background', title: l.msg, time: l.time, status: l.level === 'error' ? 'error' : 'done' }))
    }
  } catch {}
  return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8)
}

const TOOLS = [
  { icon: <Video className="h-[18px] w-[18px]" />, label: 'Motion Control', desc: 'Transfer motion video → karakter', href: '/generate/motion', accent: 'from-amber-500 to-yellow-400' },
  { icon: <ShoppingBag className="h-[18px] w-[18px]" />, label: 'Bulk Fashion', desc: '1 model + 100 outfit parallel', href: '/generate/bulk-fashion', accent: 'from-orange-500 to-amber-400' },
  { icon: <Image className="h-[18px] w-[18px]" />, label: 'Image to Video', desc: 'Foto jadi video sinematik', href: '/generate/image-to-video', accent: 'from-violet-500 to-purple-400' },
  { icon: <Wand2 className="h-[18px] w-[18px]" />, label: 'AI Upscaler', desc: 'Upscale 4K enhance detail', href: '/generate/upscaler', accent: 'from-cyan-500 to-blue-400' },
  { icon: <Zap className="h-[18px] w-[18px]" />, label: 'Providers', desc: 'Kelola API keys & tokens', href: '/providers', accent: 'from-emerald-500 to-teal-400' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const { keys, routing, fetchMaintenance } = useProviderManager()
  const user = useAuthStore((s) => s.user)
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

  return (
    <PageContent className="space-y-5">
      <div className="relative overflow-hidden rounded-[24px] border border-white/[0.06] bg-gradient-to-br from-[#d4a017]/15 via-[#1a1a1a] to-[#0a0a0a] p-6 md:p-7">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_60%,transparent_100%)]" />
        <div className="absolute -top-16 -right-16 w-[420px] h-[420px] bg-gradient-to-br from-[#d4a017]/20 to-transparent rounded-full blur-[50px]" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]" /> System Operational
              <span className="text-white/20">•</span>
              <span className="text-white/60">{healthSummary.online}/{healthSummary.total} providers online</span>
            </div>
            <h1 className="mt-3 text-[26px] md:text-[30px] font-black tracking-tight leading-none">
              {greeting}, <span className="bg-gradient-to-r from-[#d4a017] to-[#ffd700] bg-clip-text text-transparent">{user?.name?.split(' ')[0] || 'Creator'}</span> 👋
            </h1>
            <p className="mt-2 text-sm text-white/50 max-w-[560px]">AI-powered creative content production platform. Generate lebih cepat dengan smart routing & token rotation otomatis.</p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button onClick={() => navigate('/generate/motion')} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#d4a017] to-[#ffd700] text-black font-semibold text-sm hover:shadow-[0_10px_24px_rgba(212,160,23,0.4)] hover:-translate-y-0.5 transition-all">
              <Play className="h-4 w-4" /> Generate Sekarang
            </button>
            <button onClick={() => navigate('/generate/image-to-video')} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition">
              <Image className="h-4 w-4" /> Image to Video
            </button>
          </div>
        </div>
        {!hasData && (
          <div className="relative mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 grid place-items-center"><Sparkles className="h-4 w-4 text-amber-400" /></div>
            <div className="text-sm"><span className="font-semibold text-amber-300">Mulai perjalananmu</span><span className="text-white/60"> — coba generate pertama dan lihat stats live di dashboard ini.</span></div>
            <button onClick={() => navigate('/generate/motion')} className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200">Coba <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Generates', value: genStats?.totalGenerates || 0, suffix: '', sub: hasData ? '+12% minggu ini' : 'Mulai generate', icon: BarChart3, grad: 'from-amber-500/15 to-yellow-500/5', border: 'border-amber-500/20', iconBg: 'bg-amber-500/15', iconColor: 'text-amber-400', trend: hasData ? 'up' : '' },
          { label: 'Active Keys', value: keyStats.activeKeys, suffix: `/${keyStats.totalKeys}`, sub: `${keyStats.providerCount} providers`, icon: Key, grad: 'from-blue-500/15 to-cyan-500/5', border: 'border-blue-500/20', iconBg: 'bg-blue-500/15', iconColor: 'text-blue-400', trend: '' },
          { label: 'Success Rate', value: genStats?.successRate || 0, suffix: '%', sub: hasData ? `${genStats?.successfulGenerates} sukses` : 'Belum ada data', icon: Target, grad: 'from-emerald-500/15 to-teal-500/5', border: 'border-emerald-500/20', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-400', trend: '' },
          { label: 'Credits Used', value: genStats?.totalCredits || 0, suffix: '', sub: hasData ? 'Total terpakai' : '0 credits', icon: Coins, grad: 'from-violet-500/15 to-purple-500/5', border: 'border-violet-500/20', iconBg: 'bg-violet-500/15', iconColor: 'text-violet-400', trend: '' },
        ].map((c, i) => (
          <div key={c.label} className={`relative overflow-hidden rounded-2xl border ${c.border} bg-gradient-to-br ${c.grad} p-4 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition-all group animate-fade-in`} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="absolute top-3 right-3 opacity-[0.06] group-hover:opacity-[0.10] transition"><c.icon className="h-10 w-10" /></div>
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl ${c.iconBg} grid place-items-center shrink-0`}><c.icon className={`h-5 w-5 ${c.iconColor}`} /></div>
              <div className="min-w-0">
                <div className={`text-2xl font-black tracking-tight ${c.iconColor} flex items-baseline gap-1`}>
                  <AnimatedCounter value={c.value} /><span className="text-base font-semibold opacity-60">{c.suffix}</span>
                  {c.trend === 'up' && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"><TrendingUp className="h-3 w-3" /> +12%</span>}
                </div>
                <div className="text-[11px] font-medium text-white/40 tracking-wide uppercase">{c.label}</div>
                <div className="text-[11px] text-white/30 truncate">{c.sub}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card variant="bordered" className="lg:col-span-2 overflow-hidden bg-gradient-to-b from-card to-card/50 animate-fade-in" style={{ animationDelay: '240ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#d4a017] to-[#ffd700] grid place-items-center shadow-[0_4px_12px_rgba(212,160,23,0.3)]"><Gauge className="h-4 w-4 text-black" /></div>
                <span className="font-bold tracking-tight">Provider Health</span>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-full bg-white/[0.04] border border-white/5 text-white/40"><Activity className="h-3 w-3" /> LIVE</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />{healthSummary.online}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />{healthSummary.busy}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" />{healthSummary.down}</span>
                </div>
                {healthAt && <span className="text-[11px] font-mono text-white/30 hidden sm:inline">{new Date(healthAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>}
                <button onClick={runHealth} disabled={healthLoading} className="h-7 w-7 grid place-items-center rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[#d4a017]/30 transition disabled:opacity-50">
                  {healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[...HEALTH_PROVIDERS, 'wavespeed'].map((provider) => {
                const h = health[provider]
                const k = (keys as any)[provider] || []
                const active = k.filter((x: any) => x.status === 'active' || x.status === 'unknown').length
                const meta = h ? STATUS_META[h.status] : STATUS_META.nokey
                const latencyColor = h?.latencyMs != null ? (h.latencyMs < 400 ? 'text-emerald-400' : h.latencyMs < 900 ? 'text-amber-400' : 'text-red-400') : 'text-white/30'
                return (
                  <a key={provider} href="/providers" className="group flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#d4a017]/20 hover:-translate-y-0.5 transition-all">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${meta.dot} group-hover:scale-110 transition`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold capitalize truncate leading-none">{provider}</div>
                      <div className="text-[11px] truncate mt-0.5">
                        {h ? <span className={`${meta.text} font-medium`}>{meta.label} <span className={`${latencyColor} font-mono`}>· {h.latencyMs ?? '—'}ms</span></span> : <span className="text-white/40 font-mono">{k.length > 0 ? `${active}/${k.length} keys` : 'no key'}</span>}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition" />
                  </a>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card variant="bordered" className="overflow-hidden animate-fade-in" style={{ animationDelay: '280ms' }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2.5"><span className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-400 grid place-items-center"><Flame className="h-4 w-4 text-white" /></span><span className="font-bold">Generates</span></span>
              {genStats && <span className="text-[11px] font-mono px-2 py-1 rounded-full bg-white/[0.04] border border-white/5 text-white/40">{genStats.generatesByDay.length}d</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {genStats && genStats.generatesByDay.length > 0 ? (
              <>
                <MiniBarChart data={genStats.generatesByDay} maxBars={7} />
                <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-white/5">
                  <div className="text-center"><div className="text-base font-black"><AnimatedCounter value={genStats.totalGenerates} /></div><div className="text-[11px] text-white/35 uppercase tracking-wide">Total</div></div>
                  <div className="text-center"><div className="text-base font-black text-emerald-400"><AnimatedCounter value={genStats.successfulGenerates} /></div><div className="text-[11px] text-white/35 uppercase tracking-wide">Sukses</div></div>
                  <div className="text-center"><div className="text-base font-black text-red-400"><AnimatedCounter value={genStats.failedGenerates} /></div><div className="text-[11px] text-white/35 uppercase tracking-wide">Gagal</div></div>
                  <div className="text-center"><div className="text-base font-black text-white">{genStats.avgDurationSec}s</div><div className="text-[11px] text-white/35 uppercase tracking-wide">Avg</div></div>
                </div>
              </>
            ) : (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/5 grid place-items-center mx-auto"><BarChart3 className="h-6 w-6 text-white/20" /></div>
                <p className="text-sm font-medium mt-3">Belum ada data</p>
                <p className="text-xs text-white/35 mt-1">Generate pertamamu akan muncul di sini</p>
                <button onClick={() => navigate('/generate/motion')} className="mt-4 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-white/90 transition">Mulai Generate</button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {hasData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent animate-fade-in" style={{ animationDelay: '300ms' }}>
            <div className="relative shrink-0"><CircularProgress value={genStats?.successRate || 0} color="stroke-emerald-400" /><span className="absolute inset-0 grid place-items-center text-[11px] font-black text-emerald-400">{genStats?.successRate}%</span></div>
            <div><div className="text-[13px] font-semibold leading-none">Success Rate</div><div className="text-[11px] text-white/40 mt-1">{genStats?.successfulGenerates} / {genStats?.totalGenerates} sukses</div></div>
          </div>
          <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-blue-500/20 bg-blue-500/5 animate-fade-in" style={{ animationDelay: '320ms' }}>
            <div className="h-11 w-11 rounded-xl bg-blue-500/15 grid place-items-center"><Clock3 className="h-5 w-5 text-blue-400" /></div>
            <div><div className="text-xl font-black text-blue-400 leading-none">{genStats?.avgDurationSec}s</div><div className="text-[11px] text-white/40 uppercase tracking-wide">Avg Duration</div></div>
          </div>
          <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 animate-fade-in" style={{ animationDelay: '340ms' }}>
            <div className="h-11 w-11 rounded-xl bg-amber-500/15 grid place-items-center"><Route className="h-5 w-5 text-amber-400" /></div>
            <div><div className="text-xl font-black text-amber-400 leading-none">{Object.keys(routing).length}</div><div className="text-[11px] text-white/40 uppercase tracking-wide">Active Routes</div></div>
          </div>
          <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-violet-500/20 bg-violet-500/5 animate-fade-in" style={{ animationDelay: '360ms' }}>
            <div className="h-11 w-11 rounded-xl bg-violet-500/15 grid place-items-center"><ShieldCheck className="h-5 w-5 text-violet-400" /></div>
            <div><div className="text-xl font-black text-violet-400 leading-none">{keyStats.providerCount}</div><div className="text-[11px] text-white/40 uppercase tracking-wide">Providers</div></div>
          </div>
        </div>
      )}

      <Card variant="bordered" className="overflow-hidden animate-fade-in" style={{ animationDelay: '380ms' }}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#d4a017] to-[#ffd700] grid place-items-center shadow-[0_4px_12px_rgba(212,160,23,0.25)]"><Sparkles className="h-4 w-4 text-black" /></span>
            <span className="font-bold">Tools</span>
            <span className="ml-auto text-[11px] font-mono px-2 py-1 rounded-full bg-white/[0.04] border border-white/5 text-white/30 hidden sm:inline">Pilih workflow → generate</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {TOOLS.map((tool) => (
              <button key={tool.href} onClick={() => navigate(tool.href)} className="group text-left flex items-center gap-3 p-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#d4a017]/30 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition-all">
                <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${tool.accent} grid place-items-center text-white shadow-md group-hover:scale-105 transition`}>{tool.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold leading-none truncate">{tool.label}</div>
                  <div className="text-[11px] text-white/40 truncate mt-1">{tool.desc}</div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-white/20 group-hover:text-[#d4a017] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition shrink-0" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="bordered" className="overflow-hidden animate-fade-in" style={{ animationDelay: '420ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-400 grid place-items-center"><Clock className="h-4 w-4 text-white" /></span>
              <span className="font-bold">Recent Activity</span>
              <span className="ml-auto text-[11px] font-mono text-white/30">{activity.length} items</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/5 grid place-items-center mx-auto"><Clock className="h-6 w-6 text-white/20" /></div>
                <p className="text-sm font-medium mt-3">Belum ada aktivitas</p>
                <p className="text-xs text-white/35 mt-1">Mulai generate untuk melihat timeline di sini</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.04] border border-transparent hover:border-white/5 transition group">
                    {item.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] truncate font-medium">{item.title}</div>
                      <div className="text-[11px] font-mono text-white/35">{item.time ? new Date(item.time).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}</div>
                    </div>
                    {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-xs font-medium px-2.5 py-1 rounded-full bg-white text-black opacity-0 group-hover:opacity-100 transition">Lihat</a>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card variant="bordered" className="overflow-hidden animate-fade-in" style={{ animationDelay: '460ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 grid place-items-center"><Trophy className="h-4 w-4 text-black" /></span>
              <span className="font-bold">Top Models</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {genStats && genStats.topModels.length > 0 ? (
              <div className="space-y-2.5">
                {genStats.topModels.map((m, i) => {
                  const maxCount = genStats.topModels[0]?.count || 1
                  const pct = Math.round((m.count / maxCount) * 100)
                  return (
                    <div key={m.model} className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-xl grid place-items-center text-xs font-black shrink-0 ${i === 0 ? 'bg-gradient-to-br from-amber-500 to-yellow-300 text-black shadow-[0_4px_12px_rgba(245,158,11,0.3)]' : i === 1 ? 'bg-gradient-to-br from-zinc-300 to-zinc-400 text-black' : i === 2 ? 'bg-gradient-to-br from-amber-700 to-amber-600 text-white' : 'bg-white/5 text-white/50 border border-white/5'}`}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[13px] font-semibold truncate">{m.model}</div>
                            <div className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/5 text-white/60">{m.count}x</div>
                          </div>
                          <div className="text-[11px] font-mono text-white/35 capitalize">{m.provider}</div>
                          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mt-2">
                            <div className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-gradient-to-r from-amber-500 to-yellow-300' : 'bg-white/20'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/5 grid place-items-center mx-auto"><Trophy className="h-6 w-6 text-white/20" /></div>
                <p className="text-sm font-medium mt-3">Belum ada data model</p>
                <p className="text-xs text-white/35 mt-1">Top model favorit akan muncul di sini</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {genStats && genStats.topProviders.length > 0 && (
        <Card variant="bordered" className="overflow-hidden animate-fade-in" style={{ animationDelay: '500ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 grid place-items-center"><TrendingUp className="h-4 w-4 text-white" /></span>
              <span className="font-bold">Provider Usage</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {genStats.topProviders.map((p) => {
                const maxCount = genStats.topProviders[0]?.count || 1
                const pct = Math.round((p.count / maxCount) * 100)
                return (
                  <div key={p.provider} className="p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#d4a017]/20 hover:-translate-y-0.5 transition-all group">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-semibold capitalize">{p.provider}</div>
                      <span className="text-xs font-mono px-2 py-1 rounded-full bg-white/[0.06] border border-white/5">{p.count}x</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden mt-3">
                      <div className="h-full bg-gradient-to-r from-[#d4a017] to-[#ffd700] rounded-full transition-all duration-700 group-hover:shadow-[0_0_10px_rgba(212,160,23,0.4)]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[11px] font-mono text-white/35 mt-2">{p.credits.toLocaleString('id-ID')} credits used</div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </PageContent>
  )
}
