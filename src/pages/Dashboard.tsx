import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { useProviderManager } from '@/stores/providerManager'
import { calculateStats, DashboardStats } from '@/lib/stats'
import { checkAllProviderHealth, HEALTH_PROVIDERS, ProviderHealth } from '@/lib/providerHealth'
import {
  Sparkles, Video, Image, Zap, ShoppingBag, Wand2,
  Route, Key, Activity, Clock, ArrowRight,
  TrendingUp, BarChart3,
  Target, Clock3, Trophy, Coins, RefreshCw, Loader2,
} from 'lucide-react'

const STATUS_META: Record<string, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-emerald-400', label: 'Online', text: 'text-emerald-400' },
  busy: { dot: 'bg-amber-400', label: 'Sibuk', text: 'text-amber-400' },
  down: { dot: 'bg-red-400', label: 'Down', text: 'text-red-400' },
  nokey: { dot: 'bg-muted', label: 'No key', text: 'text-muted-foreground' },
}

interface RecentActivity {
  id: string
  type: string
  title: string
  time: string
  status: 'done' | 'error'
  url?: string
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
  return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10)
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

export default function DashboardPage() {
  const navigate = useNavigate()
  const { keys, routing, fetchMaintenance } = useProviderManager()
  const [activity, setActivity] = useState<RecentActivity[]>([])
  const [genStats, setGenStats] = useState<DashboardStats | null>(null)
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthAt, setHealthAt] = useState<number | null>(null)

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
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchMaintenance])

  // Poll status provider live (probe read-only) setiap 60 detik
  useEffect(() => {
    runHealth()
    const interval = setInterval(runHealth, 60000)
    return () => clearInterval(interval)
  }, [runHealth])

  const stats = useMemo(() => {
    const providers = ['weavy', 'wavespeed', 'magnific', 'framia', 'leonardo', 'roboneo', 'galleri5'] as const
    let activeKeys = 0
    let totalKeys = 0
    providers.forEach((p) => {
      const k = keys[p] || []
      totalKeys += k.length
      activeKeys += k.filter((k) => k.status === 'active' || k.status === 'unknown').length
    })
    const activeRoutes = Object.keys(routing).length
    return { activeKeys, totalKeys, activeRoutes, providers: providers.length }
  }, [keys, routing])

  return (
    <PageContent>
      <PageHeader
        eyebrow="Dashboard"
        title="Welcome to"
        highlight="ARKXMotion Studio"
        desc="AI-powered creative content production platform."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '0ms' }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg gold-gradient flex items-center justify-center">
                <Key className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-2xl font-bold gold-text">{stats.activeKeys}</div>
                <div className="text-[11px] text-muted-foreground">{stats.totalKeys} total keys</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '50ms' }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg silver-gradient flex items-center justify-center">
                <Route className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-2xl font-bold silver-text">{stats.activeRoutes}</div>
                <div className="text-[11px] text-muted-foreground">Active routes</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '100ms' }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg gold-gradient flex items-center justify-center">
                <Zap className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-2xl font-bold gold-text">{stats.providers}</div>
                <div className="text-[11px] text-muted-foreground">AI Providers</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '150ms' }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg silver-gradient flex items-center justify-center">
                <Activity className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-2xl font-bold silver-text">{activity.length}</div>
                <div className="text-[11px] text-muted-foreground">Recent activities</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generation Stats */}
      {genStats && genStats.totalGenerates > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '50ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg gold-gradient flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-black" />
                </div>
                <div>
                  <div className="text-2xl font-bold gold-text">{genStats.totalGenerates}</div>
                  <div className="text-[11px] text-muted-foreground">Total Generates</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '100ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg silver-gradient flex items-center justify-center">
                  <Coins className="h-5 w-5 text-black" />
                </div>
                <div>
                  <div className="text-2xl font-bold silver-text">{genStats.totalCredits.toLocaleString('id-ID')}</div>
                  <div className="text-[11px] text-muted-foreground">Credits Used</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '150ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg gold-gradient flex items-center justify-center">
                  <Target className="h-5 w-5 text-black" />
                </div>
                <div>
                  <div className="text-2xl font-bold gold-text">{genStats.successRate}%</div>
                  <div className="text-[11px] text-muted-foreground">Success Rate</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card variant="bordered" className="hover:glow-gold transition-all animate-fade-in" style={{ animationDelay: '200ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg silver-gradient flex items-center justify-center">
                  <Clock3 className="h-5 w-5 text-black" />
                </div>
                <div>
                  <div className="text-2xl font-bold silver-text">{genStats.avgDurationSec}s</div>
                  <div className="text-[11px] text-muted-foreground">Avg Duration</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tools Grid */}
      <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '200ms' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-black" />
            </div>
            <span className="gold-text">Tools</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '300ms' }}>
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
              <div className="space-y-2">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${item.status === 'done' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground">{item.time}</div>
                    </div>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-[11px]">Lihat</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider Status */}
        <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '350ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                  <Zap className="h-4 w-4 text-black" />
                </div>
                <span className="gold-text">Provider Status</span>
              </div>
              <div className="flex items-center gap-2">
                {healthAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(healthAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={runHealth}
                  disabled={healthLoading}
                  title="Cek ulang status provider sekarang"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:text-primary hover:border-primary/40 disabled:opacity-50"
                >
                  {healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {HEALTH_PROVIDERS.map((provider) => {
                const h = health[provider]
                const k = keys[provider as any] || []
                const active = k.filter((k) => k.status === 'active' || k.status === 'unknown').length
                const meta = h ? STATUS_META[h.status] : STATUS_META.nokey
                const keysTxt = k.length === 0 ? '' : ` · ${active}/${k.length} key`
                const detail = h?.detail ? ` · ${h.detail}` : ''
                return (
                  <div key={provider} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${meta.dot} ${h ? '' : 'animate-pulse'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium capitalize">{provider}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {h ? (
                          <>
                            <span className={meta.text}>{meta.label}</span>
                            {h.latencyMs != null && ` · ${h.latencyMs}ms`}
                            {keysTxt}
                            {detail}
                          </>
                        ) : (
                          'mengecek…'
                        )}
                      </div>
                    </div>
                    <a href="/providers" className="text-[11px] text-primary hover:underline">Kelola</a>
                  </div>
                )
              })}
              {/* wavespeed: belum ada probe live → tampilkan status key */}
              {(() => {
                const k = keys.wavespeed || []
                const active = k.filter((k) => k.status === 'active' || k.status === 'unknown').length
                return (
                  <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${active > 0 ? 'bg-emerald-400' : k.length > 0 ? 'bg-amber-400' : 'bg-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium capitalize">wavespeed</div>
                      <div className="text-[11px] text-muted-foreground">
                        {k.length === 0 ? 'No keys' : `${active}/${k.length} active`}
                      </div>
                    </div>
                    <a href="/providers" className="text-[11px] text-primary hover:underline">Kelola</a>
                  </div>
                )
              })()}
            </div>
           </CardContent>
        </Card>
      </div>

      {/* Top Models & Providers */}
      {genStats && genStats.totalGenerates > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '400ms' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                  <Trophy className="h-4 w-4 text-black" />
                </div>
                <span className="gold-text">Top Models</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {genStats.topModels.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada data model</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {genStats.topModels.map((m, i) => (
                    <div key={m.model} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition">
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold ${i === 0 ? 'gold-gradient text-black' : i === 1 ? 'silver-gradient text-black' : 'bg-muted text-muted-foreground'}`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{m.model}</div>
                        <div className="text-[11px] text-muted-foreground">{m.provider}</div>
                      </div>
                      <div className="text-sm font-mono font-medium">{m.count}x</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card variant="bordered" className="animate-fade-in" style={{ animationDelay: '450ms' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg silver-gradient flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-black" />
                </div>
                <span className="silver-text">Provider Usage</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {genStats.topProviders.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada data provider</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {genStats.topProviders.map((p) => {
                    const maxCount = genStats.topProviders[0]?.count || 1
                    const pct = Math.round((p.count / maxCount) * 100)
                    return (
                      <div key={p.provider} className="p-2 rounded-lg hover:bg-accent/30 transition">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-sm font-medium capitalize">{p.provider}</div>
                          <div className="text-xs text-muted-foreground">{p.count} generates · {p.credits.toLocaleString('id-ID')} cr</div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageContent>
  )
}
