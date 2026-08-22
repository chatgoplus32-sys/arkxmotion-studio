import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import {
  BarChart3,
  Users,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  TrendingUp,
  Activity,
} from 'lucide-react'

interface AnalyticsData {
  totalUsers: number
  totalLogs: number
  totalCredits: number
  completedCount: number
  failedCount: number
  pendingCount: number
  byProvider: Array<{ provider: string; count: number; credits: number; completed: number }>
  byModel: Array<{ model: string; provider: string; count: number; credits: number }>
  byDay: Array<{ day: string; count: number; credits: number }>
  topUsers: Array<{ name: string; email: string; generations: number; credits: number }>
}

const PROVIDER_ICONS: Record<string, string> = {
  weavy: '🌊', wavespeed: '⚡', magnific: '✨', roboneo: '🤖', createpulse: '💜',
  framia: '🎬', galleri5: '🎬', leonardo: '🎨', oneover: '🔮', firefly: '🔥',
  gemini: '💎', openai: '🟢',
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${color}`}>{icon}</div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const { token } = useAuthStore()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastFetch, setLastFetch] = useState('')

  const fetchAnalytics = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/analytics', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setLastFetch(new Date().toLocaleTimeString('id-ID'))
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  const successRate = data ? (data.completedCount / Math.max(data.totalLogs, 1) * 100).toFixed(1) : '0'

  return (
    <PageContent>
      <PageHeader
        eyebrow="Admin"
        title="Usage"
        highlight="Analytics"
        desc="Statistik penggunaan platform — generate logs, credits, provider usage, top users."
      />

      <div className="flex items-center gap-2 mb-4">
        <Button
          onClick={fetchAnalytics}
          disabled={loading}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {lastFetch && <span className="text-[10px] text-muted-foreground">Terakhir: {lastFetch}</span>}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard icon={<Users className="h-4 w-4" />} label="Total Users" value={data?.totalUsers ?? '—'} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Total Generates" value={data?.totalLogs ?? '—'} color="bg-purple-500/10 text-purple-400" />
        <StatCard icon={<Zap className="h-4 w-4" />} label="Credits Used" value={data?.totalCredits ?? '—'} color="bg-yellow-500/10 text-yellow-400" />
        <StatCard icon={<CheckCircle className="h-4 w-4" />} label="Completed" value={data?.completedCount ?? '—'} color="bg-green-500/10 text-green-400" />
        <StatCard icon={<XCircle className="h-4 w-4" />} label="Failed" value={data?.failedCount ?? '—'} color="bg-red-500/10 text-red-400" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Success Rate" value={`${successRate}%`} color="bg-emerald-500/10 text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Provider */}
        <Section title="📊 Usage by Provider">
          {data?.byProvider && data.byProvider.length > 0 ? (
            <div className="space-y-2">
              {data.byProvider.map((p) => (
                <div key={p.provider} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                  <span className="text-lg">{PROVIDER_ICONS[p.provider] || '🔹'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{p.provider}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.completed}/{p.count} completed · {p.credits.toLocaleString()} credits
                    </div>
                  </div>
                  <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(p.count / Math.max(data!.byProvider[0].count, 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada data</p>
          )}
        </Section>

        {/* Top Models */}
        <Section title="🤖 Top Models">
          {data?.byModel && data.byModel.length > 0 ? (
            <div className="space-y-2">
              {data.byModel.slice(0, 10).map((m, i) => (
                <div key={`${m.provider}-${m.model}`} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                  <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.model}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{m.provider}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold">{m.count}</div>
                    <div className="text-[10px] text-muted-foreground">{m.credits} cr</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada data</p>
          )}
        </Section>

        {/* By Day */}
        <Section title="📅 Daily Usage">
          {data?.byDay && data.byDay.length > 0 ? (
            <div className="space-y-1">
              {data.byDay.slice(0, 14).map((d) => (
                <div key={d.day} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-muted/20 transition-colors">
                  <span className="text-xs font-mono text-muted-foreground w-24">{d.day}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all"
                      style={{ width: `${(d.count / Math.max(data!.byDay[0].count, 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">{d.count}</span>
                  <span className="text-[10px] text-muted-foreground w-16 text-right">{d.credits} cr</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada data</p>
          )}
        </Section>

        {/* Top Users */}
        <Section title="🏆 Top Users by Credits">
          {data?.topUsers && data.topUsers.length > 0 ? (
            <div className="space-y-2">
              {data.topUsers.map((u, i) => (
                <div key={u.email} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                  <span className="text-lg">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{u.name || u.email}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold">{u.generations}</div>
                    <div className="text-[10px] text-muted-foreground">{u.credits.toLocaleString()} cr</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada data</p>
          )}
        </Section>
      </div>
    </PageContent>
  )
}
