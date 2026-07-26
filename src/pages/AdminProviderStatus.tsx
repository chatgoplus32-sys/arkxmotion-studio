import { useState, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Activity, RefreshCw, CheckCircle, XCircle, AlertTriangle, Wifi } from 'lucide-react'

interface ProviderStatus {
  name: string
  status: 'online' | 'slow' | 'offline' | 'no_config'
  latency: number | null
  message: string
  lastCheck: string
}

export default function AdminProviderStatusPage() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [overall, setOverall] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastCheck, setLastCheck] = useState('')
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const checkAll = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setStatuses(data.providers)
        setOverall(data.overall)
        setLastCheck(data.checkedAt)
        addToast('Status provider diperbarui', 'success')
      } else {
        addToast('Gagal cek status', 'error')
      }
    } catch {
      addToast('Gagal cek status server', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, addToast])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'slow': return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case 'offline': return <XCircle className="h-5 w-5 text-red-500" />
      default: return <Wifi className="h-5 w-5 text-muted-foreground" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'border-green-500/30 bg-green-500/5'
      case 'slow': return 'border-yellow-500/30 bg-yellow-500/5'
      case 'offline': return 'border-red-500/30 bg-red-500/5'
      default: return 'border-border bg-background/50'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online': return 'Online'
      case 'slow': return 'Lambat'
      case 'offline': return 'Offline'
      case 'no_config': return 'Belum Dikonfigurasi'
      default: return status
    }
  }

  return (
    <div>
      <PageHeader
        title="Cek Server Provider"
        desc="Monitor status server Roboneo, Framia, dan Weavy"
      />
      <PageContent>
        <Section
          title="Status Server"
          sub={lastCheck ? `Terakhir dicek: ${new Date(lastCheck).toLocaleString('id-ID')}` : 'Belum dicek'}
          right={
            <Button onClick={checkAll} disabled={isLoading} loading={isLoading}>
              {!isLoading && <RefreshCw className="h-4 w-4" />}
              {isLoading ? 'Mengecek...' : 'Cek Sekarang'}
            </Button>
          }
        >
          {statuses.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Activity className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <div className="text-sm">Klik "Cek Sekarang" untuk melihat status server provider</div>
            </div>
          ) : (
            <div className="space-y-3">
              {overall && (
                <div className={`p-3 rounded-xl border text-sm font-medium ${
                  overall === 'online'
                    ? 'border-green-500/30 bg-green-500/5 text-green-500'
                    : overall === 'degraded'
                      ? 'border-red-500/30 bg-red-500/5 text-red-500'
                      : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-500'
                }`}>
                  {overall === 'online' ? 'Semua provider online' : overall === 'degraded' ? 'Ada provider offline' : 'Sebagian provider bermasalah'}
                </div>
              )}

              {statuses.map((s) => (
                <div key={s.name} className={`p-4 rounded-xl border ${getStatusColor(s.status)}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(s.status)}
                      <div>
                        <div className="text-sm font-semibold">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.message}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs font-medium ${
                        s.status === 'online' ? 'text-green-500' :
                        s.status === 'slow' ? 'text-yellow-500' :
                        s.status === 'offline' ? 'text-red-500' : 'text-muted-foreground'
                      }`}>
                        {getStatusLabel(s.status)}
                      </div>
                      {s.latency !== null && (
                        <div className="text-xs text-muted-foreground font-mono">{s.latency}ms</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
