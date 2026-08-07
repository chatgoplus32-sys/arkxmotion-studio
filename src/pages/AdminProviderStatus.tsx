import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'
import {
  Activity,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wifi,
  Wrench,
  AlertCircle,
  Save,
  Loader2,
} from 'lucide-react'

interface ProviderStatus {
  name: string
  status: 'online' | 'slow' | 'offline' | 'no_config'
  latency: number | null
  message: string
  lastCheck: string
}

const ALL_PROVIDERS: ProviderId[] = [
  'weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse',
  'framia', 'firefly', 'leonardo', 'gemini',
  'openai', 'shotstack', 'creatomate',
]

export default function AdminProviderStatusPage() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [overall, setOverall] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastCheck, setLastCheck] = useState('')
  const [maintenanceMap, setMaintenanceMap] = useState<Record<string, { isMaintenance: boolean; message: string }>>({})
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [savingMaintenance, setSavingMaintenance] = useState(false)

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

  const fetchMaintenance = useCallback(async () => {
    if (!token) return
    try {
      const response = await fetch('/api/admin/maintenance', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        const map: Record<string, { isMaintenance: boolean; message: string }> = {}
        for (const m of data.maintenance) {
          map[m.provider] = { isMaintenance: m.isMaintenance, message: m.message }
        }
        setMaintenanceMap(map)
      }
    } catch {}
  }, [token])

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  const handleToggleMaintenance = useCallback(async (provider: string) => {
    if (!token) return
    const current = maintenanceMap[provider]
    const newState = !current?.isMaintenance
    setSavingMaintenance(true)
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          isMaintenance: newState,
          message: current?.message || '',
        }),
      })
      if (response.ok) {
        setMaintenanceMap(prev => ({
          ...prev,
          [provider]: { isMaintenance: newState, message: current?.message || '' },
        }))
        addToast(`${PROVIDER_CONFIGS[provider as ProviderId]?.name || provider} ${newState ? 'dimasukkan ke maintenance' : 'dikeluarkan dari maintenance'}`, 'success')
      } else {
        addToast('Gagal update maintenance', 'error')
      }
    } catch {
      addToast('Gagal update maintenance', 'error')
    } finally {
      setSavingMaintenance(false)
    }
  }, [token, maintenanceMap, addToast])

  const handleSaveMessage = useCallback(async (provider: string) => {
    if (!token) return
    const current = maintenanceMap[provider]
    setSavingMaintenance(true)
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          isMaintenance: current?.isMaintenance || false,
          message: editMessage,
        }),
      })
      if (response.ok) {
        setMaintenanceMap(prev => ({
          ...prev,
          [provider]: { isMaintenance: current?.isMaintenance || false, message: editMessage },
        }))
        setEditingProvider(null)
        addToast('Pesan maintenance diperbarui', 'success')
      } else {
        addToast('Gagal update pesan', 'error')
      }
    } catch {
      addToast('Gagal update pesan', 'error')
    } finally {
      setSavingMaintenance(false)
    }
  }, [token, maintenanceMap, editMessage, addToast])

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

  const maintenanceCount = Object.values(maintenanceMap).filter(m => m.isMaintenance).length

  return (
    <div>
      <PageHeader
        title="Cek Server Provider"
        desc="Monitor status server dan kelola maintenance provider"
      />
      <PageContent>
        {/* Server Health Check Section */}
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

        {/* Maintenance Management Section */}
        <Section
          title="Maintenance Provider"
          sub={maintenanceCount > 0 ? `${maintenanceCount} provider dalam mode maintenance` : 'Tidak ada provider dalam maintenance'}
          right={
            <Button variant="outline" onClick={fetchMaintenance} size="sm">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          }
        >
          <div className="space-y-3">
            {ALL_PROVIDERS.map((providerId) => {
              const config = PROVIDER_CONFIGS[providerId]
              const maintenance = maintenanceMap[providerId]
              const isMaintenance = maintenance?.isMaintenance || false
              const message = maintenance?.message || ''
              const isEditing = editingProvider === providerId

              return (
                <div
                  key={providerId}
                  className={`p-4 rounded-xl border transition-all ${
                    isMaintenance
                      ? 'border-orange-500/50 bg-orange-500/5'
                      : 'border-border bg-background/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg">{config.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{config.name}</span>
                          {isMaintenance && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                              <Wrench className="h-3 w-3" />
                              MAINTENANCE
                            </span>
                          )}
                        </div>
                        {message && !isEditing && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                            {message}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setEditingProvider(isEditing ? null : providerId)
                          setEditMessage(message)
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-accent transition-colors"
                        title="Edit pesan maintenance"
                      >
                        {isEditing ? 'Batal' : 'Edit Pesan'}
                      </button>
                      <button
                        onClick={() => handleToggleMaintenance(providerId)}
                        disabled={savingMaintenance}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isMaintenance ? 'bg-orange-500' : 'bg-muted'
                        }`}
                        title={isMaintenance ? 'Matikan maintenance' : 'Nyalakan maintenance'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isMaintenance ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                        Pesan Maintenance (ditampilkan ke user)
                      </div>
                      <Textarea
                        value={editMessage}
                        onChange={(e) => setEditMessage(e.target.value)}
                        placeholder="Contoh: Provider sedang dalam pemeliharaan. Estimasi selesai 2 jam lagi."
                        rows={2}
                        className="text-xs"
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => handleSaveMessage(providerId)}
                          disabled={savingMaintenance}
                        >
                          {savingMaintenance ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Simpan
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {maintenanceCount > 0 && (
            <div className="mt-4 p-3 rounded-xl border border-orange-500/30 bg-orange-500/5">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                <div className="text-xs text-orange-300/80 leading-relaxed">
                  <strong>Info:</strong> Provider yang dalam mode maintenance akan menampilkan banner peringatan di halaman Providers dan Routing Provider. User akan melihat pesan maintenance yang Anda atur.
                </div>
              </div>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
