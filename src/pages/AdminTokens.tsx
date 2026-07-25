import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Key, Plus, RefreshCw, Upload } from 'lucide-react'

interface Token {
  id: number
  provider: string
  name: string
  token_value: string
  price: number
  status: string
  created_at: string
}

type Provider = 'roboneo' | 'framia' | 'weavy'

const PROVIDERS: { key: Provider; label: string }[] = [
  { key: 'roboneo', label: 'Roboneo' },
  { key: 'framia', label: 'Framia' },
  { key: 'weavy', label: 'Weavy' },
]

interface StockInfo {
  total: number
  available: number
  sold: number
  price: number
}

export default function AdminTokensPage() {
  const [stock, setStock] = useState<Record<Provider, StockInfo>>({
    roboneo: { total: 0, available: 0, sold: 0, price: 0 },
    framia: { total: 0, available: 0, sold: 0, price: 0 },
    weavy: { total: 0, available: 0, sold: 0, price: 0 },
  })
  const [activeTab, setActiveTab] = useState<Provider>('roboneo')
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [bulkTokens, setBulkTokens] = useState('')
  const [price, setPrice] = useState('')
  const [uploading, setUploading] = useState(false)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((s) => s.addToast)

  const fetchStock = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/tokens', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        const s: Record<Provider, StockInfo> = {
          roboneo: { total: 0, available: 0, sold: 0, price: 0 },
          framia: { total: 0, available: 0, sold: 0, price: 0 },
          weavy: { total: 0, available: 0, sold: 0, price: 0 },
        }
        for (const t of data.tokens) {
          s[t.provider as Provider].total++
          if (t.status === 'available') {
            s[t.provider as Provider].available++
            s[t.provider as Provider].price = t.price
          }
          if (t.status === 'sold') s[t.provider as Provider].sold++
        }
        setStock(s)
      }
    } catch {
      addToast('Gagal memuat stok', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    fetchStock()
  }, [fetchStock])

  const handleSubmitBulk = async () => {
    if (!bulkTokens.trim() || !price) {
      addToast('Isi token dan harga', 'error')
      return
    }

    const lines = bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) {
      addToast('Tidak ada token yang diisi', 'error')
      return
    }

    setUploading(true)
    const bulkPayload = lines.map((tokenValue, i) => ({
      name: `${PROVIDERS.find(p => p.key === activeTab)?.label} #${stock[activeTab].total + i + 1}`,
      token_value: tokenValue,
    }))

    try {
      const response = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ provider: activeTab, price: Number(price), tokens: bulkPayload })
      })
      if (response.ok) {
        const data = await response.json()
        addToast(`${data.count || lines.length} token berhasil diupload`, 'success')
        fetchStock()
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal upload', 'error')
      }
    } catch {
      addToast('Gagal upload token', 'error')
    }

    setUploading(false)
    setBulkTokens('')
    setPrice('')
    setShowForm(false)
  }

  const tokenCount = bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0).length

  return (
    <div>
      <PageHeader
        title="Upload Token"
        description="Upload stok token Roboneo, Framia, dan Weavy"
        icon={<Key className="h-6 w-6" />}
      />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {PROVIDERS.map((p) => {
            const s = stock[p.key]
            const isActive = activeTab === p.key
            return (
              <button
                key={p.key}
                onClick={() => { setActiveTab(p.key); setShowForm(false); setBulkTokens(''); setPrice('') }}
                className={`p-4 rounded-xl border text-left transition-all ${
                  isActive
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border bg-background/50 hover:bg-accent/30'
                }`}
              >
                <div className="text-sm font-semibold mb-2">{p.label}</div>
                <div className="flex gap-3 text-xs">
                  <div>
                    <div className="text-2xl font-bold gold-text">{s.available}</div>
                    <div className="text-muted-foreground">tersedia</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-sm font-medium">{s.sold}</div>
                    <div className="text-muted-foreground">terjual</div>
                  </div>
                </div>
                {s.price > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">Rp {s.price.toLocaleString('id-ID')} / token</div>
                )}
              </button>
            )
          })}
        </div>

        <Section
          title={`${PROVIDERS.find(p => p.key === activeTab)?.label}`}
          description={`Total: ${stock[activeTab].total} | Tersedia: ${stock[activeTab].available} | Terjual: ${stock[activeTab].sold}`}
          right={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchStock} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              {!showForm && (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4" /> Upload
                </Button>
              )}
            </div>
          }
        >
          {showForm && (
            <div className="mb-4 p-4 rounded-xl border border-border bg-background/50">
              <div className="text-sm font-medium mb-3">Upload Bulk Token</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Label>Token / API Key (satu per baris)</Label>
                  <Textarea
                    placeholder={`token_abc123\ntoken_def456\ntoken_ghi789`}
                    rows={4}
                    value={bulkTokens}
                    onChange={(e) => setBulkTokens(e.target.value)}
                    className="font-mono text-xs"
                  />
                  {bulkTokens.trim() && (
                    <div className="text-xs text-muted-foreground mt-1">{tokenCount} token terdeteksi</div>
                  )}
                </div>
                <div className="flex flex-col">
                  <Label>Harga/Token (Rp)</Label>
                  <Input
                    type="number"
                    placeholder="50000"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="text-lg font-semibold"
                  />
                  {price && tokenCount > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Total: Rp {(Number(price) * tokenCount).toLocaleString('id-ID')}
                    </div>
                  )}
                  <Button
                    className="w-full mt-auto"
                    onClick={handleSubmitBulk}
                    disabled={uploading || !bulkTokens.trim() || !price}
                    loading={uploading}
                  >
                    {uploading ? null : <Upload className="h-4 w-4" />}
                    {uploading ? 'Mengupload...' : `Upload ${tokenCount || ''} Token`}
                  </Button>
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { setShowForm(false); setBulkTokens(''); setPrice('') }}>
                Batal
              </Button>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
