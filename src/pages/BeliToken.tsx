import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Input } from '@/components/ui'
import { ShoppingCart, Copy, ExternalLink, X, Upload, QrCode, Trash2 } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useProviderManager } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'

interface TokenItem {
  id: number
  provider: string
  name: string
  price: number
  credits?: number | null
  credit_group?: string | null
  status: string
  created_at: string
}

interface OrderItem {
  bulk_id: string
  provider: string
  status: string
  created_at: string
  token_name: string
  total_price: number
  count: number
}

type Provider = 'roboneo' | 'framia' | 'weavy'

const PROVIDERS: { key: Provider; label: string; color: string }[] = [
  { key: 'roboneo', label: 'Roboneo', color: 'text-blue-500' },
  { key: 'framia', label: 'Framia', color: 'text-purple-500' },
  { key: 'weavy', label: 'Weavy', color: 'text-green-500' },
]

const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20order%20token'

export default function BeliTokenPage() {
  const addToast = useToastStore((s) => s.addToast)
  const authStore = useAuthStore()

  const [activeTokenTab, setActiveTokenTab] = useState<Provider>('roboneo')
  const [availableTokens, setAvailableTokens] = useState<TokenItem[]>([])
  const [myOrders, setMyOrders] = useState<OrderItem[]>([])
  const [tokenLoading, setTokenLoading] = useState(false)
  const [buyQty, setBuyQty] = useState('')
  const [selectedBuyQty, setSelectedBuyQty] = useState(0)
  const [selectedBuyPrice, setSelectedBuyPrice] = useState(0)
  const [selectedBuyProvider, setSelectedBuyProvider] = useState<Provider>('roboneo')
  const [paymentMethod, setPaymentMethod] = useState<'dana' | 'qris'>('dana')

  const fetchTokens = useCallback(async () => {
    if (!authStore.token) return
    setTokenLoading(true)
    try {
      const response = await fetch('/api/tokens', {
        headers: { 'Authorization': `Bearer ${authStore.token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setAvailableTokens(data.tokens)
      }
    } catch {
      addToast('Gagal memuat token', 'error')
    } finally {
      setTokenLoading(false)
    }
  }, [authStore.token, addToast])

  const fetchMyOrders = useCallback(async () => {
    if (!authStore.token) return
    try {
      const response = await fetch('/api/tokens/orders/mine', {
        headers: { 'Authorization': `Bearer ${authStore.token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setMyOrders(data.orders)
      }
    } catch {}
  }, [authStore.token])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  useEffect(() => {
    fetchMyOrders()
  }, [fetchMyOrders])

  const handleBuyTokens = (tokenIds: number[], totalPrice: number) => {
    setSelectedBuyQty(tokenIds.length)
    setSelectedBuyPrice(totalPrice / tokenIds.length)
    setSelectedBuyProvider(activeTokenTab)
  }

  const handleConfirmBuy = async () => {
    if (!authStore.token) return
    const providerTokens = availableTokens.filter(t => t.provider === selectedBuyProvider && t.status === 'available')
    const qty = selectedBuyQty
    if (qty < 1 || qty > providerTokens.length) return

    const tokenIds = providerTokens.slice(0, qty).map(t => t.id)

    try {
      const response = await fetch('/api/tokens/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authStore.token}` },
        body: JSON.stringify({ token_ids: tokenIds })
      })
      if (response.ok) {
        addToast(`${qty} token ${PROVIDERS.find(p => p.key === selectedBuyProvider)?.label} berhasil dipesan!`, 'success')
        fetchTokens()
        fetchMyOrders()
        window.open(WHATSAPP_LINK, '_blank')
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal memesan', 'error')
      }
    } catch {
      addToast('Gagal memesan', 'error')
    }

    setSelectedBuyQty(0)
    setBuyQty('')
  }

  const handleCopyNumber = () => {
    navigator.clipboard.writeText('082280204445')
    addToast('Nomor Dana berhasil disalin', 'success')
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Marketplace"
        title="Beli"
        highlight="Token"
        desc="Pilih provider, tentukan jumlah, lalu bayar"
      />

      <Section
        title="🛒 Beli Token"
        sub="Pilih provider, tentukan jumlah, lalu bayar"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
          {PROVIDERS.map((p) => {
            const providerTokens = availableTokens.filter(t => t.provider === p.key && t.status === 'available')
            const stock = providerTokens.length
            const price = providerTokens.length > 0 ? providerTokens[0].price : 0
            const isActive = activeTokenTab === p.key
            return (
              <button
                key={p.key}
                onClick={() => setActiveTokenTab(p.key)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  isActive
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border bg-background/50 hover:bg-accent/30'
                }`}
              >
                <div className="text-sm font-semibold mb-1">{p.label}</div>
                <div className="text-2xl font-bold gold-text">{stock}</div>
                <div className="text-xs text-muted-foreground">token tersedia</div>
                {price > 0 && (
                  <div className="text-sm font-semibold mt-2">Rp {price.toLocaleString('id-ID')} / token</div>
                )}
              </button>
            )
          })}
        </div>

        {tokenLoading ? (
          <div className="text-center py-4 text-muted-foreground text-sm">Memuat stok...</div>
        ) : (() => {
          const providerTokens = availableTokens.filter(t => t.provider === activeTokenTab && t.status === 'available')

          if (providerTokens.length === 0) {
            return (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Stok {PROVIDERS.find(p => p.key === activeTokenTab)?.label} habis
              </div>
            )
          }

          // Group by credit_group for Roboneo
          if (activeTokenTab === 'roboneo') {
            const groups: Record<string, TokenItem[]> = {}
            providerTokens.forEach(t => {
              const group = t.credit_group || 'lainnya'
              if (!groups[group]) groups[group] = []
              groups[group].push(t)
            })

            const sortedGroups = Object.entries(groups).sort((a, b) => {
              const order: Record<string, number> = { '100+': 0, '90-100': 1, '80-90': 2, '70-80': 3, '<70': 4, 'lainnya': 5 }
              return (order[a[0]] ?? 5) - (order[b[0]] ?? 5)
            })

            return (
              <div className="space-y-3">
                {sortedGroups.map(([group, tokens]) => {
                  const price = tokens[0].price
                  const stock = tokens.length
                  return (
                    <div key={group} className="p-4 rounded-xl border border-border bg-background/50">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary font-semibold">{group} cr</span>
                            <span className="text-sm font-medium">{stock} token tersedia</span>
                          </div>
                          <div className="text-lg font-bold gold-text mt-1">Rp {price.toLocaleString('id-ID')} / token</div>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="flex-1">
                          <Label className="text-xs">Jumlah</Label>
                          <Input
                            type="number"
                            min={1}
                            max={stock}
                            placeholder={`1 - ${stock}`}
                            value={selectedBuyProvider === activeTokenTab && selectedBuyPrice === price ? buyQty : ''}
                            onChange={(e) => {
                              setBuyQty(e.target.value)
                              setSelectedBuyProvider(activeTokenTab)
                              setSelectedBuyPrice(price)
                            }}
                          />
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Total</div>
                          <div className="text-lg font-bold gold-text">
                            Rp {((Number(buyQty) || 0) * price).toLocaleString('id-ID')}
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            if (!buyQty || Number(buyQty) < 1) return
                            const tokenIds = tokens.slice(0, Number(buyQty)).map(t => t.id)
                            handleBuyTokens(tokenIds, price * Number(buyQty))
                          }}
                          disabled={!buyQty || Number(buyQty) < 1 || Number(buyQty) > stock}
                        >
                          <ShoppingCart className="h-4 w-4" /> Beli {group}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          }

          // Non-Roboneo: simple display
          const stock = providerTokens.length
          const price = providerTokens[0].price

          return (
            <div className="p-4 rounded-xl border border-border bg-background/50">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="flex-1">
                  <Label>Jumlah Token {PROVIDERS.find(p => p.key === activeTokenTab)?.label}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={stock}
                    placeholder={`1 - ${stock}`}
                    value={buyQty}
                    onChange={(e) => setBuyQty(e.target.value)}
                  />
                  <div className="text-xs text-muted-foreground mt-1">Maks: {stock} token</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground mb-1">Total Bayar</div>
                  <div className="text-xl font-bold gold-text">
                    Rp {((Number(buyQty) || 0) * price).toLocaleString('id-ID')}
                  </div>
                  <div className="text-xs text-muted-foreground">{Number(buyQty) || 0} x Rp {price.toLocaleString('id-ID')}</div>
                </div>
              </div>
              <Button
                className="w-full mt-4"
                disabled={!buyQty || Number(buyQty) < 1 || Number(buyQty) > stock}
                onClick={() => {
                  const qty = Number(buyQty)
                  if (qty < 1 || qty > stock) return
                  setSelectedBuyQty(qty)
                  setSelectedBuyPrice(price)
                  setSelectedBuyProvider(activeTokenTab)
                }}
              >
                <ShoppingCart className="h-4 w-4" />
                Beli {buyQty ? `${buyQty} Token` : ''}
              </Button>
            </div>
          )
        })()}

        {myOrders.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Riwayat Pembelian</div>
              <div className="flex gap-2">
                {myOrders.some(o => o.status === 'confirmed') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      for (const order of myOrders.filter(o => o.status === 'confirmed')) {
                        try {
                          const res = await fetch(`/api/tokens/note/${order.bulk_id}`, {
                            headers: { 'Authorization': `Bearer ${authStore.token}` }
                          })
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `akun_Token_${order.provider}_${order.count}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt`
                          a.click()
                          URL.revokeObjectURL(url)
                          await new Promise(r => setTimeout(r, 500))
                        } catch {}
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Download Semua
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    if (!confirm('Hapus semua riwayat pembelian?')) return
                    try {
                      const res = await fetch('/api/tokens/orders/clear', {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${authStore.token}` }
                      })
                      if (res.ok) {
                        addToast('Riwayat pembelian dihapus', 'success')
                        fetchMyOrders()
                      }
                    } catch {}
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Semua
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {myOrders.map((order) => (
                <div
                  key={order.bulk_id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-background/50"
                >
                  <div>
                    <div className="text-sm font-medium">{order.count} Token {PROVIDERS.find(p => p.key === order.provider)?.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Rp {order.total_price.toLocaleString('id-ID')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {order.status === 'confirmed' && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/tokens/note/${order.bulk_id}`, {
                                headers: { 'Authorization': `Bearer ${authStore.token}` }
                              })
                              const text = await res.text()
                              const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('_v2') || l.length > 50)
                              if (lines.length === 0) {
                                addToast('Tidak ada token ditemukan', 'error')
                                return
                              }
                              const importKeys = useProviderManager.getState().importKeys
                              const count = importKeys(order.provider as any, lines, order.provider)
                              if (count > 0) {
                                addToast(`${count} token berhasil diimport ke Providers!`, 'success')
                              } else {
                                addToast('Semua token sudah ada di Providers', 'info')
                              }
                            } catch {
                              addToast('Gagal import token', 'error')
                            }
                          }}
                        >
                          <Upload className="h-3.5 w-3.5" /> Import ke Providers
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/tokens/note/${order.bulk_id}`, {
                                headers: { 'Authorization': `Bearer ${authStore.token}` }
                              })
                              const blob = await res.blob()
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `akun_Token_${order.provider}_${order.count}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch {}
                          }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Download
                        </Button>
                      </>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      order.status === 'confirmed'
                        ? 'bg-green-500/10 text-green-500'
                        : order.status === 'rejected'
                          ? 'bg-red-500/10 text-red-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                    }`}>
                      {order.status === 'confirmed' ? 'Dikonfirmasi' : order.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {selectedBuyQty > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold">Order Token {PROVIDERS.find(p => p.key === selectedBuyProvider)?.label}</div>
              <button onClick={() => { setSelectedBuyQty(0); setSelectedBuyProvider('roboneo'); setPaymentMethod('dana') }} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-background/50 border border-border">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-muted-foreground">{selectedBuyQty} token x Rp {selectedBuyPrice.toLocaleString('id-ID')}</div>
                  </div>
                  <div className="text-xl font-bold gold-text">Rp {(selectedBuyQty * selectedBuyPrice).toLocaleString('id-ID')}</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setPaymentMethod('dana')}
                  className={`flex-1 p-2.5 rounded-lg border text-sm font-medium transition ${
                    paymentMethod === 'dana'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/30'
                  }`}
                >
                  Dana
                </button>
                <button
                  onClick={() => setPaymentMethod('qris')}
                  className={`flex-1 p-2.5 rounded-lg border text-sm font-medium transition ${
                    paymentMethod === 'qris'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/30'
                  }`}
                >
                  <QrCode className="h-4 w-4 inline mr-1" />
                  QRIS
                </button>
              </div>

              {paymentMethod === 'dana' && (
                <div className="p-4 rounded-xl bg-background/50 border border-border">
                  <div className="text-sm font-medium mb-2">Cara Pembayaran</div>
                  <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>Transfer ke <span className="font-semibold text-foreground">Dana</span></li>
                    <li className="flex items-center gap-2">
                      Nomor: <span className="font-mono font-semibold text-foreground">082280204445</span>
                      <button onClick={handleCopyNumber} className="p-1 rounded hover:bg-accent" title="Salin nomor">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </li>
                    <li>a.n <span className="font-semibold text-foreground">Yusuf Prihandoko</span></li>
                    <li>Transfer sesuai total bayar</li>
                  </ol>
                </div>
              )}

              {paymentMethod === 'qris' && (
                <div className="p-4 rounded-xl bg-background/50 border border-border">
                  <div className="text-sm font-medium mb-3">Scan QRIS untuk Bayar</div>
                  <div className="flex justify-center mb-3">
                    <img
                      src="/qris-faezya.jpg"
                      alt="QRIS Faezya Cell"
                      className="w-64 h-auto rounded-lg border border-border"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        const fallback = target.nextElementSibling as HTMLElement
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                    <div className="hidden flex-col items-center justify-center w-64 h-64 rounded-lg border border-dashed border-border text-center p-4">
                      <QrCode className="h-12 w-12 text-muted-foreground mb-2" />
                      <div className="text-xs text-muted-foreground">
                        QRIS image belum tersedia.
                        <br />Simpan ke <code className="text-primary">public/qris-faezya.jpg</code>
                      </div>
                    </div>
                  </div>
                  <div className="text-center text-sm text-muted-foreground space-y-1">
                    <div className="font-semibold text-foreground">Faezya Cell</div>
                    <div className="text-xs">NMID: ID1025464045240</div>
                    <div className="text-xs">Scan menggunakan aplikasi bank/e-wallet Anda</div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={handleConfirmBuy}>
                  <ExternalLink className="h-4 w-4" />
                  {paymentMethod === 'qris' ? 'Sudah Bayar & Konfirmasi WhatsApp' : 'Transfer & Konfirmasi WhatsApp'}
                </Button>
                <Button variant="outline" onClick={() => { setSelectedBuyQty(0); setSelectedBuyProvider('roboneo'); setPaymentMethod('dana') }}>
                  Batal
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContent>
  )
}
