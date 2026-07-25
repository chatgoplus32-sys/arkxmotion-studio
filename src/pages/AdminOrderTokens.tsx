import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { ClipboardCheck, CheckCircle, XCircle, RefreshCw, Clock, ExternalLink } from 'lucide-react'

interface Order {
  id: number
  user_id: number
  token_id: number
  provider: string
  token_name: string
  token_value: string
  price: number
  status: string
  user_email: string
  user_name: string
  created_at: string
}

interface StockInfo {
  provider: string
  total: number
  available: number
  sold: number
}

type Provider = 'roboneo' | 'framia' | 'weavy'

const PROVIDERS: { key: Provider; label: string }[] = [
  { key: 'roboneo', label: 'Roboneo' },
  { key: 'framia', label: 'Framia' },
  { key: 'weavy', label: 'Weavy' },
]

const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20order%20token'

export default function AdminOrderTokensPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [tokens, setTokens] = useState<{ provider: string; total: number; available: number; sold: number }[]>([])
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending')
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchOrders = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/tokens/orders', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setOrders(data.orders)
      }
    } catch {
      addToast('Gagal memuat order', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, addToast])

  const fetchStock = useCallback(async () => {
    if (!token) return
    try {
      const response = await fetch('/api/admin/tokens', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        const stock: StockInfo[] = PROVIDERS.map(p => {
          const providerTokens = data.tokens.filter((t: { provider: string }) => t.provider === p.key)
          return {
            provider: p.key,
            total: providerTokens.length,
            available: providerTokens.filter((t: { status: string }) => t.status === 'available').length,
            sold: providerTokens.filter((t: { status: string }) => t.status === 'sold').length,
          }
        })
        setTokens(stock)
      }
    } catch {}
  }, [token])

  useEffect(() => {
    fetchOrders()
    fetchStock()
  }, [fetchOrders, fetchStock])

  const handleConfirm = async (orderId: number) => {
    if (!token) return
    setActionLoading(orderId)
    try {
      const response = await fetch('/api/admin/tokens/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: orderId, status: 'confirmed' })
      })
      if (response.ok) {
        addToast('Order berhasil dikonfirmasi', 'success')
        fetchOrders()
        fetchStock()
      } else {
        addToast('Gagal konfirmasi order', 'error')
      }
    } catch {
      addToast('Gagal konfirmasi order', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (orderId: number) => {
    if (!token || !confirm('Tolak order ini?')) return
    setActionLoading(orderId)
    try {
      const response = await fetch('/api/admin/tokens/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: orderId, status: 'rejected' })
      })
      if (response.ok) {
        addToast('Order ditolak', 'success')
        fetchOrders()
        fetchStock()
      } else {
        addToast('Gagal menolak order', 'error')
      }
    } catch {
      addToast('Gagal menolak order', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const filteredOrders = activeTab === 'pending'
    ? orders.filter(o => o.status === 'pending')
    : orders

  return (
    <div>
      <PageHeader
        title="Konfirmasi Order Token"
        description="Kelola order token dari user sesuai stok yang diupload"
        icon={<ClipboardCheck className="h-6 w-6" />}
      />
      <PageContent>
        <Section title="Stok Token" description="Jumlah stok token per provider yang telah diupload">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {tokens.map((s) => (
              <div key={s.provider} className="p-4 rounded-xl border border-border bg-background/50">
                <div className="text-sm font-medium mb-2">{PROVIDERS.find(p => p.key === s.provider)?.label}</div>
                <div className="flex gap-3 text-xs">
                  <span className="text-muted-foreground">Total: <span className="font-semibold text-foreground">{s.total}</span></span>
                  <span className="text-green-500">Tersedia: <span className="font-semibold">{s.available}</span></span>
                  <span className="text-red-500">Terjual: <span className="font-semibold">{s.sold}</span></span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Order Masuk"
          sub="Konfirmasi order sesuai dengan stok token yang tersedia"
          className="mt-5"
          right={
            <div className="flex gap-2 items-center">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('pending')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    activeTab === 'pending'
                      ? 'bg-yellow-500/20 text-yellow-500'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5 inline mr-1" />
                  Pending ({orders.filter(o => o.status === 'pending').length})
                </button>
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    activeTab === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Semua ({orders.length})
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={() => { fetchOrders(); fetchStock() }} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        >
          <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20 mb-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Disclaimer:</span> Order hanya bisa dikonfirmasi jika stok token {PROVIDERS.map(p => p.label).join(', ')} masih tersedia. Jika stok habis, tolak order dan informasikan ke user via WhatsApp.
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat order...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {activeTab === 'pending' ? 'Tidak ada order pending' : 'Belum ada order'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">User</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Provider</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Token</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Harga</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Waktu</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-4">
                        <div className="font-medium">{o.user_name}</div>
                        <div className="text-xs text-muted-foreground">{o.user_email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm">{PROVIDERS.find(p => p.key === o.provider)?.label}</span>
                      </td>
                      <td className="py-3 px-4">
                        <code className="text-xs bg-secondary px-2 py-1 rounded-lg font-mono">{o.token_name}</code>
                      </td>
                      <td className="py-3 px-4">Rp {o.price.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          o.status === 'confirmed'
                            ? 'bg-green-500/10 text-green-500'
                            : o.status === 'rejected'
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-yellow-500/10 text-yellow-500'
                        }`}>
                          {o.status === 'confirmed' ? 'Dikonfirmasi' : o.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {o.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={WHATSAPP_LINK}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              title="Chat WhatsApp"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleConfirm(o.id)}
                              disabled={actionLoading === o.id}
                              className="text-green-500 hover:text-green-600 hover:bg-green-500/10"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReject(o.id)}
                              disabled={actionLoading === o.id}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
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
