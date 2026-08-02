import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { useProviderManager } from '@/stores/providerManager'
import {
  Sparkles, Video, Image, Zap, ShoppingBag, Wand2, Mic, Film,
  Settings, Route, Key, Shield, Activity, Clock, ArrowRight,
  TrendingUp, Layers, Download, AlertTriangle,
} from 'lucide-react'

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
  { icon: <Mic className="h-5 w-5" />, label: 'Dubbing', desc: 'AI voice dubbing', href: '/mixing/dubbing', color: 'silver' },
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

  useEffect(() => {
    fetchMaintenance()
    setActivity(getRecentActivity())
    const interval = setInterval(() => setActivity(getRecentActivity()), 30000)
    return () => clearInterval(interval)
  }, [])

  const stats = useMemo(() => {
    const providers = ['weavy', 'wavespeed', 'magnific', 'framia', 'leonardo'] as const
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
        <Card variant="bordered" className="hover:glow-gold transition-all">
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
        <Card variant="bordered" className="hover:glow-gold transition-all">
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
        <Card variant="bordered" className="hover:glow-gold transition-all">
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
        <Card variant="bordered" className="hover:glow-gold transition-all">
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

      {/* Tools Grid */}
      <Card variant="bordered">
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
        <Card variant="bordered">
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
        <Card variant="bordered">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                <Zap className="h-4 w-4 text-black" />
              </div>
              <span className="gold-text">Provider Status</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(['weavy', 'wavespeed', 'magnific', 'framia', 'leonardo'] as const).map((provider) => {
                const k = keys[provider] || []
                const active = k.filter((k) => k.status === 'active' || k.status === 'unknown').length
                const total = k.length
                const route = routing[provider] || routing['bulk-fashion'] || 'weavy'
                return (
                  <div key={provider} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${active > 0 ? 'bg-emerald-400' : total > 0 ? 'bg-amber-400' : 'bg-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium capitalize">{provider}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {total === 0 ? 'No keys' : `${active}/${total} active`}
                      </div>
                    </div>
                    <a href="/providers" className="text-[11px] text-primary hover:underline">Kelola</a>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContent>
  )
}
