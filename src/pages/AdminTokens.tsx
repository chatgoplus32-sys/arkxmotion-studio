import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Key, Plus, Trash2, RefreshCw, Upload } from 'lucide-react'

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

export default function AdminTokensPage() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [activeTab, setActiveTab] = useState<Provider>('roboneo')
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [bulkTokens, setBulkTokens] = useState('')
  const [price, setPrice] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((s) => s.addToast)

  const fetchTokens = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/admin/tokens?provider=${activeTab}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setTokens(data.tokens)
      }
    } catch {
      addToast('Gagal memuat token', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, activeTab, addToast])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

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
      name: `${PROVIDERS.find(p => p.key === activeTab)?.label} #${tokens.length + i + 1}`,
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
        fetchTokens()
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal upload token', 'error')
      }
    } catch {
      addToast('Gagal upload token', 'error')
    }

    setUploading(false)
    setBulkTokens('')
    setPrice('')
    setShowForm(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Hapus token ini?')) return
    setActionLoading(id)
    try {
      const response = await fetch(`/api/admin/tokens?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        addToast('Token dihapus', 'success')
        fetchTokens()
      }
    } catch {
      addToast('Gagal menghapus', 'error')
    } finally {
      setActionLoading(null)
    }
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
        <div className="flex gap-2 mb-5">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setActiveTab(p.key); setShowForm(false); setBulkTokens(''); setPrice('') }}
              className={`px-4 py-2 text-sm rounded-xl transition-colors font-medium ${
                activeTab === p.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <Section
          title={`${PROVIDERS.find(p => p.key === activeTab)?.label} — Stok Token`}
          description={`${tokens.length} token total, ${tokens.filter(t => t.status === 'available').length} tersedia`}
          right={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchTokens} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              {!showForm && (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4" /> Upload Bulk
                </Button>
              )}
            </div>
          }
        >
          {showForm && (
            <div className="mb-5 p-4 rounded-xl border border-border bg-background/50">
              <div className="text-sm font-medium mb-3">Upload Bulk Token {PROVIDERS.find(p => p.key === activeTab)?.label}</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="md:col-span-2">
                  <Label>Token / API Key (satu per baris)</Label>
                  <Textarea
                    placeholder={`temp_token_abc123\ntemp_token_def456\ntemp_token_ghi789`}
                    rows={5}
                    value={bulkTokens}
                    onChange={(e) => setBulkTokens(e.target.value)}
                    className="font-mono text-xs"
                  />
                  {bulkTokens.trim() && (
                    <div className="text-xs text-muted-foreground mt-1">{tokenCount} token terdeteksi</div>
                  )}
                </div>
                <div>
                  <Label>Harga per Token (Rp)</Label>
                  <Input
                    type="number"
                    placeholder="50000"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="text-lg font-semibold"
                  />
                  {price && tokenCount > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      Total: Rp {(Number(price) * tokenCount).toLocaleString('id-ID')}
                    </div>
                  )}
                  <Button
                    className="w-full mt-4"
                    onClick={handleSubmitBulk}
                    disabled={uploading || !bulkTokens.trim() || !price}
                    loading={uploading}
                  >
                    {uploading ? null : <Upload className="h-4 w-4" />}
                    {uploading ? 'Mengupload...' : `Upload ${tokenCount || ''} Token`}
                  </Button>
                  <Button variant="outline" className="w-full mt-2" onClick={() => { setShowForm(false); setBulkTokens(''); setPrice('') }}>
                    Batal
                  </Button>
                </div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat token...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Belum ada token</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">#</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Token</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Harga</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t, i) => (
                    <tr key={t.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-4">
                        <code className="text-xs bg-secondary px-2 py-1 rounded-lg font-mono">
                          {t.token_value.slice(0, 16)}...
                        </code>
                      </td>
                      <td className="py-3 px-4">Rp {t.price.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.status === 'available'
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-red-500/10 text-red-500'
                        }`}>
                          {t.status === 'available' ? 'Tersedia' : 'Terjual'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(t.id)}
                          disabled={actionLoading === t.id}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
