import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Zap,
} from 'lucide-react'

interface NexabotPricing {
  price: number
  unlimitedPrice: number
  unlimitedDays: number
}

interface AppSettings {
  [key: string]: string
}

interface Maintenance {
  provider: string
  is_maintenance: boolean
  message: string
}

const ALL_PROVIDERS = [
  'weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse',
  'framia', 'firefly', 'leonardo', 'oneover', 'gemini', 'riverside',
]

export default function AdminSystemSettings() {
  const [settings, setSettings] = useState<AppSettings>({})
  const [maintenance, setMaintenance] = useState<Maintenance[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Harga NexaBot punya jalur sendiri (`/api/admin/nexabot/config`) karena
  // nilainya dipakai langsung oleh perhitungan charge di server.
  const [nbForm, setNbForm] = useState({ price: '', unlimitedPrice: '', unlimitedDays: '' })
  const [nbDefaults, setNbDefaults] = useState<NexabotPricing>({ price: 250, unlimitedPrice: 35000, unlimitedDays: 7 })
  const [nbActive, setNbActive] = useState<NexabotPricing | null>(null)
  const [nbSaving, setNbSaving] = useState(false)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings || {})
        setMaintenance(data.maintenance || [])
      }
    } catch {
      addToast('Failed to fetch settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchNexabotPricing = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/nexabot/config', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      const pricing: NexabotPricing = data.pricing
      setNbActive(pricing)
      if (data.defaults) setNbDefaults(data.defaults)
      // Input diisi nilai efektif sekarang supaya admin lihat angka aslinya.
      setNbForm({
        price: String(pricing.price),
        unlimitedPrice: String(pricing.unlimitedPrice),
        unlimitedDays: String(pricing.unlimitedDays),
      })
    } catch { /* biarkan nilai lama kalau request gagal */ }
  }, [token])

  useEffect(() => { fetchNexabotPricing() }, [fetchNexabotPricing])

  const handleSaveNexabotPricing = async () => {
    if (!token) return
    setNbSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(nbForm),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Harga NexaBot disimpan', 'success')
        setNbActive(data.pricing)
        setNbForm({
          price: String(data.pricing.price),
          unlimitedPrice: String(data.pricing.unlimitedPrice),
          unlimitedDays: String(data.pricing.unlimitedDays),
        })
      } else {
        addToast(data.error || 'Gagal menyimpan harga NexaBot', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga NexaBot', 'error')
    } finally {
      setNbSaving(false)
    }
  }

  const handleSave = async () => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings, maintenance }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Settings saved', 'success')
      } else {
        addToast(data.error || 'Save failed', 'error')
      }
    } catch {
      addToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleMaintenance = (provider: string) => {
    setMaintenance(prev => {
      const existing = prev.find(m => m.provider === provider)
      if (existing) {
        return prev.map(m => m.provider === provider ? { ...m, is_maintenance: !m.is_maintenance } : m)
      }
      return [...prev, { provider, is_maintenance: true, message: '' }]
    })
  }

  const setMaintenanceMessage = (provider: string, message: string) => {
    setMaintenance(prev =>
      prev.map(m => m.provider === provider ? { ...m, message } : m)
    )
  }

  const maintenanceCount = maintenance.filter(m => m.is_maintenance).length

  if (loading) {
    return (
      <div>
        <PageHeader title="System Settings" desc="Configure global application settings" />
        <PageContent>
          <div className="text-center py-8 text-muted-foreground">Loading settings...</div>
        </PageContent>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="System Settings"
        desc="Configure global application settings and provider maintenance"
      />
      <PageContent>
        {/* Maintenance Status Banner */}
        {maintenanceCount > 0 && (
          <div className="mb-6 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-500 font-medium">
              {maintenanceCount} provider(s) dalam mode maintenance
            </span>
          </div>
        )}

        {/* App Settings */}
        <Section title="Application Settings" sub="General settings for the application">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Membership Fee (Rp)</label>
                <input
                  type="number"
                  value={settings.membership_fee || ''}
                  onChange={e => setSettings(prev => ({ ...prev, membership_fee: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="150000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">App Name</label>
                <input
                  type="text"
                  value={settings.app_name || ''}
                  onChange={e => setSettings(prev => ({ ...prev, app_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="ARKXMotion Studio"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Default Credits per User</label>
                <input
                  type="number"
                  value={settings.default_credits || ''}
                  onChange={e => setSettings(prev => ({ ...prev, default_credits: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Max Credits per Generate</label>
                <input
                  type="number"
                  value={settings.max_credits_per_gen || ''}
                  onChange={e => setSettings(prev => ({ ...prev, max_credits_per_gen: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="50"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.maintenance_mode === 'true'}
                  onChange={e => setSettings(prev => ({ ...prev, maintenance_mode: e.target.checked ? 'true' : 'false' }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Global Maintenance Mode</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.registration_open === 'true'}
                  onChange={e => setSettings(prev => ({ ...prev, registration_open: e.target.checked ? 'true' : 'false' }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Registration Open</span>
              </label>
            </div>
          </div>
        </Section>

        {/* NexaBot Pricing */}
        <Section
          title="Harga NexaBot"
          sub="Tarif per generate dan paket Unlimited — berlaku langsung tanpa deploy ulang"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Harga per Generate (Rp)
              </label>
              <input
                type="number"
                value={nbForm.price}
                onChange={e => setNbForm(prev => ({ ...prev, price: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                placeholder={String(nbDefaults.price)}
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Dipotong dari saldo user tiap 1 generate (semua mode).
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Harga Paket Unlimited (Rp)
              </label>
              <input
                type="number"
                value={nbForm.unlimitedPrice}
                onChange={e => setNbForm(prev => ({ ...prev, unlimitedPrice: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                placeholder={String(nbDefaults.unlimitedPrice)}
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Sekali bayar, generate gratis selama masa berlaku paket.
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Masa Berlaku Paket (hari)
              </label>
              <input
                type="number"
                value={nbForm.unlimitedDays}
                onChange={e => setNbForm(prev => ({ ...prev, unlimitedDays: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                placeholder={String(nbDefaults.unlimitedDays)}
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                1–365 hari. Beli lagi saat aktif → masa berlaku ditumpuk.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Button size="sm" onClick={handleSaveNexabotPricing} disabled={nbSaving}>
              <Zap className={`h-4 w-4 mr-2 ${nbSaving ? 'animate-pulse' : ''}`} />
              {nbSaving ? 'Menyimpan...' : 'Simpan Harga NexaBot'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Aktif sekarang:{' '}
              {nbActive
                ? `Rp ${nbActive.price.toLocaleString('id-ID')}/generate · Paket Rp ${nbActive.unlimitedPrice.toLocaleString('id-ID')} / ${nbActive.unlimitedDays} hari`
                : 'memuat...'}
            </span>
          </div>
        </Section>

        {/* Provider Maintenance */}
        <Section title="Provider Maintenance" sub="Toggle maintenance mode for individual providers">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALL_PROVIDERS.map(provider => {
              const m = maintenance.find(x => x.provider === provider)
              const isMaint = m?.is_maintenance ?? false
              return (
                <div key={provider} className={`rounded-xl border p-4 transition-colors ${
                  isMaint ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border bg-card'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{provider}</span>
                    <button
                      onClick={() => toggleMaintenance(provider)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        isMaint ? 'bg-yellow-500' : 'bg-secondary'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        isMaint ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  {isMaint && (
                    <input
                      type="text"
                      value={m?.message || ''}
                      onChange={e => setMaintenanceMessage(provider, e.target.value)}
                      placeholder="Maintenance message..."
                      className="w-full px-2 py-1 text-xs rounded border border-yellow-500/30 bg-yellow-500/10"
                    />
                  )}
                  <div className="mt-2 flex items-center gap-1">
                    {isMaint ? (
                      <><AlertTriangle className="h-3 w-3 text-yellow-500" /><span className="text-[12px] text-yellow-500">Maintenance</span></>
                    ) : (
                      <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-[12px] text-green-500">Active</span></>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* Save Button */}
        <div className="flex items-center gap-3 mt-6">
          <Button onClick={handleSave} disabled={saving}>
            <Save className={`h-4 w-4 mr-2 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </PageContent>
    </div>
  )
}
