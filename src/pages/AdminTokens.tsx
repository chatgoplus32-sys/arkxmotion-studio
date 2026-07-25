import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Key, Plus, Trash2, RefreshCw, Edit2, Check, X } from 'lucide-react'

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

const PROVIDERS: { key: Provider; label: string; color: string }[] = [
  { key: 'roboneo', label: 'Roboneo', color: 'text-blue-500' },
  { key: 'framia', label: 'Framia', color: 'text-purple-500' },
  { key: 'weavy', label: 'Weavy', color: 'text-green-500' },
]

export default function AdminTokensPage() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [activeTab, setActiveTab] = useState<Provider>('roboneo')
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', token_value: '', price: '' })
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

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

  const handleSubmit = async () => {
    if (!form.name || !form.token_value || !form.price) {
      addToast('Semua field harus diisi', 'error')
      return
    }

    try {
      const url = editingId ? `/api/admin/tokens/${editingId}` : '/api/admin/tokens'
      const method = editingId ? 'PATCH' : 'POST'
      const body = editingId
        ? { name: form.name, token_value: form.token_value, price: Number(form.price) }
        : { provider: activeTab, name: form.name, token_value: form.token_value, price: Number(form.price) }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        addToast(editingId ? 'Token berhasil diupdate' : 'Token berhasil ditambahkan', 'success')
        setForm({ name: '', token_value: '', price: '' })
        setShowForm(false)
        setEditingId(null)
        fetchTokens()
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal menyimpan token', 'error')
      }
    } catch {
      addToast('Gagal menyimpan token', 'error')
    }
  }

  const handleEdit = (t: Token) => {
    setForm({ name: t.name, token_value: t.token_value, price: String(t.price) })
    setEditingId(t.id)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Hapus token ini?')) return
    setActionLoading(id)
    try {
      const response = await fetch(`/api/admin/tokens/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        addToast('Token berhasil dihapus', 'success')
        fetchTokens()
      }
    } catch {
      addToast('Gagal menghapus token', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'available' ? 'sold' : 'available'
    setActionLoading(id)
    try {
      const response = await fetch(`/api/admin/tokens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus })
      })
      if (response.ok) {
        addToast(`Status diubah ke ${newStatus}`, 'success')
        fetchTokens()
      }
    } catch {
      addToast('Gagal mengubah status', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', token_value: '', price: '' })
  }

  return (
    <div>
      <PageHeader
        title="Upload Token"
        description="Kelola token untuk Roboneo, Framia, dan Weavy"
        icon={<Key className="h-6 w-6" />}
      />
      <PageContent>
        <div className="flex gap-2 mb-5">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setActiveTab(p.key); cancelForm() }}
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
          title={`Token ${PROVIDERS.find(p => p.key === activeTab)?.label}`}
          description="Upload dan kelola token yang akan dijual"
          right={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchTokens} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              {!showForm && (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4" /> Tambah Token
                </Button>
              )}
            </div>
          }
        >
          {showForm && (
            <div className="mb-5 p-4 rounded-xl border border-border bg-background/50">
              <div className="text-sm font-medium mb-3">{editingId ? 'Edit Token' : 'Tambah Token Baru'}</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Nama Akun</Label>
                  <Input
                    placeholder="Nama akun"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Token / API Key</Label>
                  <Input
                    placeholder="Token atau API key"
                    value={form.token_value}
                    onChange={(e) => setForm({ ...form, token_value: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Harga (Rp)</Label>
                  <Input
                    type="number"
                    placeholder="50000"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleSubmit}>
                  <Check className="h-4 w-4" /> {editingId ? 'Update' : 'Simpan'}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelForm}>
                  <X className="h-4 w-4" /> Batal
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat token...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Belum ada token {PROVIDERS.find(p => p.key === activeTab)?.label}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Nama</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Token</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Harga</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-4 font-medium">{t.name}</td>
                      <td className="py-3 px-4">
                        <code className="text-xs bg-secondary px-2 py-1 rounded-lg font-mono">
                          {t.token_value.slice(0, 12)}...
                        </code>
                      </td>
                      <td className="py-3 px-4">Rp {t.price.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleToggleStatus(t.id, t.status)}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                            t.status === 'available'
                              ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                              : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                          }`}
                        >
                          {t.status === 'available' ? 'Tersedia' : 'Terjual'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(t)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(t.id)}
                            disabled={actionLoading === t.id}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
