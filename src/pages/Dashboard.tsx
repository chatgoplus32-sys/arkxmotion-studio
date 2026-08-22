import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { useProviderManager } from '@/stores/providerManager'
import { calculateStats, DashboardStats } from '@/lib/stats'
import { checkAllProviderHealth, HEALTH_PROVIDERS, ProviderHealth } from '@/lib/providerHealth'
import {
  Sparkles, Video, Image, Zap, ShoppingBag, Wand2,
  Route, Key, Activity, Clock, ArrowRight,
  TrendingUp, BarChart3, Users,
  Target, Clock3, Trophy, Coins, RefreshCw, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Gauge,
  Rocket, Settings, Shield, ChevronRight, Flame,
} from 'lucide-react'

const STATUS_META: Record<string, { dot: string; label: string; text: string; bg: string }> = {
  online: { dot: 'bg-emerald-400', label: 'Online', text: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  busy: { dot: 'bg-amber-400', label: 'Sibuk', text: 'text-amber-400', bg: 'bg-amber-400/10' },
  down: { dot: 'bg-red-400', label: 'Down', text: 'text-red-400', bg: 'bg-red-400/10' },
  nokey: { dot: 'bg-muted', label: 'No key', text: 'text-muted-foreground', bg: 'bg-muted/30' },
}

/* ─── Animated Counter ─────────────────────────────────── */
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
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplay(Math.round(start + diff * eased))
      if (progress < 1) ref.current = requestAnimationFrame(animate)
    }
    ref.current = requestAnimationFrame(animate)
    return () => { if (ref.current) cancelAnimationFrame(ref.current) }
  }, [value, duration])
  return <>{display.toLocaleString('id-ID')}</>
}

/* ─── Mini Bar Chart ────────────────────────────────────── */
function MiniBarChart({ data, maxBars = 7 }: { data: Array<{ date: string; count: number }>; maxBars?: number }) {
  const bars = data.slice(-maxBars)
  const maxVal = Math.max(...bars.map((b) => b.count), 1)
  return (
    <div className="flex items-end gap-1.5 h-24 pt-2">
      {bars.map((bar, i) => {
        const h = Math.max((bar.count / maxVal) * 100, 4)
        const dayLabel = new Date(bar.date).toLocaleDateString('id-ID', { weekday: 'short' })
        const isToday = bar.date === new Date().toISOString().slice(0, 10)
        return (
          <div key={bar.date} className="flex-1 flex flex-col items-center gap-1 group" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="relative w-full flex justify-center">
              <span className="absolute -top-5 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {bar.count}
              </span>
            </div>
            <div
              className={`w-full rounded-t-md transition-all duration-500 ${isToday ? 'bg-gradient-to-t from-amber-500 to-amber-300' : 'bg-gradient-to-t from-primary/40 to-primary/70'}`}
              style={{ height: `${h}%`, minHeight: '4px' }}
            />
            <span className={`text-[9px] ${isToday ? 'text-amber-400 font-medium' : 'text-muted-foreground'}`}>{dayLabel}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Circular Progress ──────────────────────────────────── */
function CircularProgress({ value, size = 56, strokeWidth = 5, color = 'stroke-amber-400' }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/20" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
        className={`${color} transition-all duration-1000`}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  )
}

/* ─── Data ──────────────────────────────────────────────── */
interface RecentActivity {
  id: string; type: string; title: string; time: string; status: 'done' | 'error'; url?: string
}

function getRecentActivity(): RecentActivity[] {
  const items: RecentActivity[] = []
  try {
    const gallery = JSON.parse(localStorage.getItem('arkxmotion.upscaler.gallery') || '[]')
    gallery.slice(0, 5).forEach((g: any) => {
      items.push({ id: g.id, type: 'upscaler', title: `Upscale: ${g.sourceName || 'image'}`, time: g.createdAt, status: 'done', url: g.url })
    })
  } catch {}
  try {
    const raw = localStorage.getItem('arkxmotion.bg_logs')
    if (raw) {
      const logs = JSON.parse(raw)
      logs.slice(-5).reverse().forEach((l: any) => {
        items.push({ id: l.time + l.msg, type: 'background', title: l.msg, time: l.time, status: l.level === 'error' ? 'error' : 'done' })
      })
    }
  } catch {}
  return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8)
}

const TOOLS = [
  { icon: <Video className="h-5 w-5" />, label: 'Motion Control', desc: 'Transfer motion dari video ke karakter', href: '/generate/motion', color: 'gold' },
  { icon: <ShoppingBag className="h-5 w-5" />, label: 'Bulk Fashion', desc: '1 karakter + banyak outfit → generate parallel', href: '/generate/bulk-fashion', color: 'gold' },
  { icon: <Image className="h-5 w-5" />, label: 'Image to Video', desc: 'Animate gambar dengan AI', href: '/generate/image-to-video', color: 'silver' },
  { icon: <Wand2 className="h-5 w-5" />, label: 'AI Upscaler', desc: 'Upscale & enhance gambar', href: '/generate/upscaler', color: 'silver' },
  { icon: <Zap className="h-5 w-5" />, label: 'Providers', desc: 'Kelola API keys & tokens', href: '/providers', color: 'gold' },
]

const COLOR_MAP: Record<string, string> = {
  gold: 'gold-gradient text-black',
  silver: 'silver-gradient text-black',
}

/* ─── Main Component ────────────────────────────────────── */
export default function DashboardPage() {
  const navigate = useNavigate()
  const { keys, routing, fetchMaintenance } = useProviderManager()
  const [activity, setActivity] = useState<RecentActivity[]>([])
  const [genStats, setGenStats] = useState<DashboardStats | null>(null)
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthAt, setHealthAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const runHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const h = await checkAllProviderHealth()
      setHealth(h)
      setHealthAt(Date.now())
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMaintenance()
    setActivity(getRecentActivity())
    setGenStats(calculateStats())
    const interval = setInterval(() => {
      setActivity(getRecentActivity())
      setGenStats(calculateStats())
      setNow(Date.now())
    }, 10000) // refresh setiap 10 detik
    return () => clearInterval(interval)
  }, [fetchMaintenance])

  useEffect(() => {
    runHealth()
    const interval = setInterval(runHealth, 60000)
    return () => clearInterval(interval)
  }, [runHealth])

  /* ── Computed Stats ── */
  const keyStats = useMemo(() => {
    const allProviders = ['weavy', 'wavespeed', 'roboneo', 'framia', 'leonardo', 'galleri5', 'oneover', 'firefly', 'createpulse'] as const
    let activeKeys = 0
    let totalKeys = 0
    let totalCredits = 0
    const providerKeys: Record<string, number> = {}
    allProviders.forEach((p) => {
      const k = keys[p] || []
      totalKeys += k.length
      activeKeys += k.filter((k) => k.status === 'active' || k.status === 'unknown').length
      if (k.length > 0) providerKeys[p] = k.length
    })
    return { activeKeys, totalKeys, totalCredits, providerKeys, providerCount: Object.keys(providerKeys).length }
  }, [keys])

  const healthSummary = useMemo(() => {
    let online = 0, busy = 0, down = 0, nokey = 0
    const allProviders = [...HEALTH_PROVIDERS, 'wavespeed']
    allProviders.forEach((p) => {
      const h = health[p]
      if (!h) {
        const k = keys[p as any] || []
        if (k.length > 0) nokey++
        else nokey++
        return
      }
      if (h.status === 'online') online++
      else if (h.status === 'busy') busy++
      else if (h.status === 'down') down++
      else nokey++
    })
    return { online, busy, down, nokey, total: allProviders.length }
  }, [health, keys])

  const uptimeFormatted = useMemo(() => {
    const up = genStats?.avgDurationSec || 0
    return `${up}s`
  }, [genStats])

  return (
    <PageContent>
      <PageHeader
        eyebrow="Dashboard"
        title="Welcome to"
        highlight="ARKXMotion Studio"
        desc="AI-powered creative content production platform."
      />

      {/* ═══ Top Stats Row ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Generates */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4 hover:border-amber-500/40 transition-all animate-fade-in group" style={{ animationDelay: '0ms' }}>
          <div className="absolute top-3 right-3 opacity-10 group-hover:opacity-20 transition"><BarChart3 className="h-12 w-12" /></div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">
                <AnimatedCounter value={genStats?.totalGenerates || 0} />
              </div>
              <div className="text-[11px] text-muted-foreground">Total Generates</div>
            </div>
          </div>
        </div>

        {/* Active Keys */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent p-4 hover:border-blue-500/40 transition-all animate-fade-in group" style={{ animationDelay: '50ms' }}>
          <div className="absolute top-3 right-3 opacity-10 group-hover:opacity-20 transition"><Key className="h-12 w-12" /></div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Key className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-400">
                <AnimatedCounter value={keyStats.activeKeys} />
                <span className="text-lg text-blue-300/50">/{keyStats.totalKeys}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">Active Keys</div>
            </div>
          </div>
        </div>

        {/* Success Rate */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4 hover:border-emerald-500/40 transition-all animate-fade-in group" style={{ animationDelay: '100ms' }}>
          <div className="absolute top-3 right-3 opacity-10 group-hover:opacity-20 transition"><Target className="h-12 w-12" /></div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Target className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-3xl font-bold text-emerald-400">
                <AnimatedCounter value={genStats?.successRate || 0} />%
              </div>
              <div className="text-[11px] text-muted-foreground">Success Rate</div>
            </div>
          </div>
        </div>

        {/* Credits Used */}
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-4 hover:border-purple-500/40 transition-all animate-fade-in group" style={{ animationDelay: '150ms' }}>
          <div className="absolute top-3 right-3 opacity-10 group-hover:opacity-20 transition"><Coins className="h-12 w-12" /></div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Coins className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">
                <AnimatedCounter value={genStats?.totalCredits || 0} />
              </div>
              <div className="text-[11px] text-muted-foreground">Credits Used</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Provider Health + Generation Chart ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Provider Health — Compact Grid */}
        <Card variant="bordered" className="lg:col-span-2 animate-fade-in" style={{ animationDelay: '200ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                  <Gauge className="h-4 w-4 text-black" />
                </div>
                <span className="gold-text">Provider Health</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-muted-foreground">{healthSummary.online}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="text-[10px] text-muted-foreground">{healthSummary.busy}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-400" />
                  <span className="text-[10px] text-muted-foreground">{healthSummary.down}</span>
                </div>
                {healthAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(healthAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={runHealth}
                  disabled={healthLoading}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:text-primary hover:border-primary/40 disabled:opacity-50"
                >
                  {healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[...HEALTH_PROVIDERS, 'wavespeed'].map((provider) => {
                const h = health[provider]
                const k = keys[provider as any] || []
                const active = k.filter((k) => k.status === 'active' || k.status === 'unknown').length
                const meta = h ? STATUS_META[h.status] : STATUS_META.nokey
                return (
                  <a key={provider} href="/providers" className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border/50 hover:border-primary/30 hover:bg-accent/30 transition group">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${meta.dot} ${h ? '' : 'animate-pulse'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium capitalize truncate">{provider}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {h ? (
                          <span className={meta.text}>{meta.label}{h.latencyMs != null && ` · ${h.latencyMs}ms`}</span>
                        ) : k.length > 0 ? `${active}/${k.length} key` : 'no key'}
                      </div>
                    </div>
                    <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                  </a>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Generation Chart */}
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '250ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg silver-gradient flex items-center justify-center">
                  <Flame className="h-4 w-4 text-black" />
                </div>
                <span className="silver-text">Generates</span>
              </div>
              {genStats && (
                <span className="text-[10px] text-muted-foreground">{genStats.generatesByDay.length}d data</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {genStats && genStats.generatesByDay.length > 0 ? (
              <>
                <MiniBarChart data={genStats.generatesByDay} maxBars={7} />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                  <div className="text-center">
                    <div className="text-lg font-bold gold-text"><AnimatedCounter value={genStats.totalGenerates} /></div>
                    <div className="text-[10px] text-muted-foreground">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-emerald-400"><AnimatedCounter value={genStats.successfulGenerates} /></div>
                    <div className="text-[10px] text-muted-foreground">Success</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-red-400"><AnimatedCounter value={genStats.failedGenerates} /></div>
                    <div className="text-[10px] text-muted-foreground">Failed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold silver-text">{genStats.avgDurationSec}s</div>
                    <div className="text-[10px] text-muted-foreground">Avg Time</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Belum ada data</p>
                <p className="text-xs mt-1">Mulai generate untuk melihat chart</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Quick Stats Row ═══ */}
      {genStats && genStats.totalGenerates > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 animate-fade-in" style={{ animationDelay: '260ms' }}>
            <div className="relative">
              <CircularProgress value={genStats.successRate} color="stroke-emerald-400" />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-emerald-400">{genStats.successRate}%</span>
            </div>
            <div>
              <div className="text-xs font-medium">Success Rate</div>
              <div className="text-[10px] text-muted-foreground">{genStats.successfulGenerates} dari {genStats.totalGenerates}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5 animate-fade-in" style={{ animationDelay: '280ms' }}>
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Clock3 className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-blue-400">{genStats.avgDurationSec}s</div>
              <div className="text-[10px] text-muted-foreground">Avg Duration</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 animate-fade-in" style={{ animationDelay: '300ms' }}>
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Route className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-amber-400">{Object.keys(routing).length}</div>
              <div className="text-[10px] text-muted-foreground">Active Routes</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/20 bg-purple-500/5 animate-fade-in" style={{ animationDelay: '320ms' }}>
            <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <div className="text-lg font-bold text-purple-400">{keyStats.providerCount}</div>
              <div className="text-[10px] text-muted-foreground">Providers Active</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Tools Grid ═══ */}
      <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '350ms' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-black" />
            </div>
            <span className="gold-text">Tools</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {TOOLS.map((tool) => (
              <a
                key={tool.href}
                onClick={() => navigate(tool.href)}
                className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition group cursor-pointer"
              >
                <div className={`h-10 w-10 rounded-lg ${COLOR_MAP[tool.color]} flex items-center justify-center shrink-0`}>
                  {tool.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{tool.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{tool.desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Recent Activity + Top Models ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '400ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg silver-gradient flex items-center justify-center">
                <Clock className="h-4 w-4 text-black" />
              </div>
              <span className="silver-text">Recent Activity</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Belum ada aktivitas</p>
                <p className="text-xs mt-1">Mulai generate untuk melihat aktivitas di sini</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition group">
                    {item.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {item.time ? new Date(item.time).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}
                      </div>
                    </div>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-[11px] opacity-0 group-hover:opacity-100 transition">Lihat</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Models */}
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '450ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                <Trophy className="h-4 w-4 text-black" />
              </div>
              <span className="gold-text">Top Models</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {genStats && genStats.topModels.length > 0 ? (
              <div className="space-y-2">
                {genStats.topModels.map((m, i) => {
                  const maxCount = genStats.topModels[0]?.count || 1
                  const pct = Math.round((m.count / maxCount) * 100)
                  return (
                    <div key={m.model} className="p-2 rounded-lg hover:bg-accent/30 transition">
                      <div className="flex items-center gap-3">
                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'gold-gradient text-black' : i === 1 ? 'silver-gradient text-black' : i === 2 ? 'bg-amber-600/30 text-amber-300' : 'bg-muted text-muted-foreground'}`}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium truncate">{m.model}</div>
                            <div className="text-xs font-mono text-muted-foreground shrink-0 ml-2">{m.count}x</div>
                          </div>
                          <div className="text-[10px] text-muted-foreground capitalize">{m.provider}</div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-gradient-to-r from-amber-500 to-amber-300' : 'bg-primary/50'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Belum ada data model</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Provider Usage ═══ */}
      {genStats && genStats.topProviders.length > 0 && (
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '500ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg silver-gradient flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-black" />
              </div>
              <span className="silver-text">Provider Usage</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {genStats.topProviders.map((p) => {
                const maxCount = genStats.topProviders[0]?.count || 1
                const pct = Math.round((p.count / maxCount) * 100)
                return (
                  <div key={p.provider} className="p-3 rounded-xl border border-border/50 hover:border-primary/20 hover:bg-accent/20 transition">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium capitalize">{p.provider}</div>
                      <div className="text-xs text-muted-foreground">{p.count}x</div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">{p.credits.toLocaleString('id-ID')} credits used</div>
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
