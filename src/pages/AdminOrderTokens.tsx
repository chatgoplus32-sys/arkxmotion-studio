import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { ClipboardCheck, CheckCircle, XCircle, RefreshCw, Clock } from 'lucide-react'

interface BulkOrder {
  bulk_id: string
  user_name: string
  user_email: string
  provider: string
  status: string
  created_at: string
  tokens: { id: number; name: string; token_value: string; price: number }[]
  total_price: number
}

type Provider = 'roboneo' | 'framia' | 'weavy'

const PROVIDERS: { key: Provider; label: string }[] = [
  { key: 'roboneo', label: 'Roboneo' },
  { key: 'framia', label: 'Framia' },
  { key: 'weavy', label: 'Weavy' },
]

export default function AdminOrderTokensPage() {
  const [orders, setOrders] = useState<BulkOrder[]>([])
  const [stock, setStock] = useState<{ provider: string; total: number; available: number; sold: number }[]>([])
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending')
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
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
        const s = PROVIDERS.map(p => {
          const providerTokens = data.tokens.filter((t: { provider: string }) => t.provider === p.key)
          return {
            provider: p.key,
            total: providerTokens.length,
            available: providerTokens.filter((t: { status: string }) => t.status === 'available').length,
            sold: providerTokens.filter((t: { status: string }) => t.status === 'sold').length,
          }
        })
        setStock(s)
      }
    } catch {}
  }, [token])

  useEffect(() => {
    fetchOrders()
    fetchStock()
  }, [fetchOrders, fetchStock])

  const handleConfirm = async (bulkId: string) => {
    if (!token) return
    setActionLoading(bulkId)
    try {
      const response = await fetch('/api/admin/tokens/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ bulk_id: bulkId, status: 'confirmed' })
      })
      if (response.ok) {
        addToast('Order dikonfirmasi', 'success')
        fetchOrders()
        fetchStock()
      } else {
        addToast('Gagal konfirmasi', 'error')
      }
    } catch {
      addToast('Gagal konfirmasi', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleConfirmAll = async () => {
    if (!token) return
    const pendingOrders = orders.filter(o => o.status === 'pending')
    if (pendingOrders.length === 0) return

    setActionLoading('all')
    let success = 0
    for (const order of pendingOrders) {
      try {
        const response = await fetch('/api/admin/tokens/orders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ bulk_id: order.bulk_id, status: 'confirmed' })
        })
        if (response.ok) success++
      } catch {}
    }
    setActionLoading(null)
    addToast(`${success} order berhasil dikonfirmasi semua`, 'success')
    fetchOrders()
    fetchStock()
  }

  const handleReject = async (bulkId: string) => {
    if (!token || !confirm('Tolak order ini?')) return
    setActionLoading(bulkId)
    try {
      const response = await fetch('/api/admin/tokens/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ bulk_id: bulkId, status: 'rejected' })
      })
      if (response.ok) {
        addToast('Order ditolak', 'success')
        fetchOrders()
        fetchStock()
      } else {
        addToast('Gagal menolak', 'error')
      }
    } catch {
      addToast('Gagal menolak', 'error')
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
        desc="Kelola order token dari user sesuai stok yang diupload"
      />
      <PageContent>
        <Section title="Stok Token" sub="Jumlah stok token per provider">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {stock.map((s) => (
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
              {orders.filter(o => o.status === 'pending').length > 0 && (
                <Button size="sm" onClick={handleConfirmAll} disabled={actionLoading === 'all'} loading={actionLoading === 'all'}>
                  <CheckCircle className="h-4 w-4" /> Konfirmasi Semua
                </Button>
              )}
            </div>
          }
        >
          <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20 mb-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Disclaimer:</span> Order hanya bisa dikonfirmasi jika stok token tersedia. Jika stok habis, tolak order.
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
            <div className="space-y-3">
              {filteredOrders.map((o) => (
                <div key={o.bulk_id} className="p-4 rounded-xl border border-border bg-background/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold">{o.user_name}</span>
                        <span className="text-xs text-muted-foreground">{o.user_email}</span>
                      </div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {o.tokens.length} Token {PROVIDERS.find(p => p.key === o.provider)?.label} — Rp {o.total_price.toLocaleString('id-ID')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString('id-ID')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        o.status === 'confirmed'
                          ? 'bg-green-500/10 text-green-500'
                          : o.status === 'rejected'
                            ? 'bg-red-500/10 text-red-500'
                            : 'bg-yellow-500/10 text-yellow-500'
                      }`}>
                        {o.status === 'confirmed' ? 'Dikonfirmasi' : o.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                      </span>
                      {o.status === 'pending' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConfirm(o.bulk_id)}
                            disabled={actionLoading === o.bulk_id}
                            className="text-green-500 hover:text-green-600 hover:bg-green-500/10"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReject(o.bulk_id)}
                            disabled={actionLoading === o.bulk_id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </>
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
