import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select } from '@/components/ui'
import { Shield, Square, Trash2, AlertTriangle, Loader2, ShoppingCart, Copy, ExternalLink, X } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import {
  getActiveTasks,
  forceStopTask,
  forceStopAllTasks,
  clearResults,
  clearLogs,
  clearAllTasks,
  getResults,
  getLogs,
  type ActiveTask,
  type CompletedResult,
  type LogEntry,
} from '@/lib/backgroundTasks'
import { useToastStore } from '@/stores/toastStore'

interface TokenItem {
  id: number
  provider: string
  name: string
  price: number
  status: string
  created_at: string
}

interface OrderItem {
  id: number
  token_id: number
  provider: string
  token_name: string
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

const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20order%20token'

export default function SettingsPage() {
  const [theme, setTheme] = useState('system')
  const [language, setLanguage] = useState('id')
  const [notifications, setNotifications] = useState(true)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [results, setResults] = useState<CompletedResult[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stopping, setStopping] = useState<string | null>(null)
  const [stoppingAll, setStoppingAll] = useState(false)
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

  const refresh = useCallback(() => {
    setActiveTasks(getActiveTasks())
    setResults(getResults())
    setLogs(getLogs())
  }, [])

  const fetchTokens = useCallback(async () => {
    if (!authStore.token) return
    setTokenLoading(true)
    try {
      const response = await fetch(`/api/tokens?provider=${activeTokenTab}`, {
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
  }, [authStore.token, activeTokenTab, addToast])

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

  const handleBuyToken = (token: TokenItem) => {
    setSelectedToken(token)
  }

  const handleConfirmBuy = async () => {
    if (!authStore.token) return
    const providerTokens = availableTokens.filter(t => t.provider === selectedBuyProvider && t.status === 'available')
    const qty = selectedBuyQty
    if (qty < 1 || qty > providerTokens.length) return

    // Create orders for each token
    for (let i = 0; i < qty; i++) {
      try {
        await fetch('/api/tokens/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authStore.token}` },
          body: JSON.stringify({ token_id: providerTokens[i].id })
        })
      } catch {}
    }

    addToast(`${qty} token ${PROVIDERS.find(p => p.key === selectedBuyProvider)?.label} berhasil dipesan!`, 'success')
    fetchTokens()
    fetchMyOrders()
    setSelectedBuyQty(0)
    setBuyQty('')
    window.open(WHATSAPP_LINK, '_blank')
  }

  const handleCopyNumber = () => {
    navigator.clipboard.writeText('082280204445')
    addToast('Nomor Dana berhasil disalin', 'success')
  }

  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener('arkxmotion-tasks-changed', handler)
    const interval = setInterval(refresh, 3000)
    return () => {
      window.removeEventListener('arkxmotion-tasks-changed', handler)
      clearInterval(interval)
    }
  }, [refresh])

  const handleStopTask = async (taskId: string, model: string) => {
    setStopping(taskId)
    await new Promise((r) => setTimeout(r, 300))
    const stopped = forceStopTask(taskId)
    addToast(stopped ? `Task ${model} dihentikan` : `Task ${model} dihapus dari daftar`, stopped ? 'warning' : 'info')
    setStopping(null)
    refresh()
  }

  const handleStopAll = async () => {
    setStoppingAll(true)
    await new Promise((r) => setTimeout(r, 300))
    const count = forceStopAllTasks()
    addToast(`${count} task dihentikan paksa`, 'warning')
    setStoppingAll(false)
    refresh()
  }

  const handleClearResults = () => {
    clearResults()
    addToast('Semua hasil dihapus', 'info')
    refresh()
  }

  const handleClearLogs = () => {
    clearLogs()
    addToast('Semua log dihapus', 'info')
    refresh()
  }

  const handleClearAll = () => {
    forceStopAllTasks()
    clearAllTasks()
    addToast('Semua data proses dihapus', 'warning')
    refresh()
  }

  const formatElapsed = (startedAt: number) => {
    const diff = Date.now() - startedAt
    const min = Math.floor(diff / 60000)
    const sec = Math.floor((diff % 60000) / 1000)
    return `${min}m ${sec}s`
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        highlight=""
        desc="Configure your ARKXMotion Studio preferences."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="🎨 Appearance">
          <div className="space-y-4">
            <div>
              <Label>Theme</Label>
              <Select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </div>
            <div>
              <Label>Language</Label>
              <Select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={[
                  { value: 'id', label: 'Bahasa Indonesia' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="🔔 Notifications">
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm font-medium">Push Notifications</div>
                <div className="text-xs text-muted-foreground">Get notified when generations complete</div>
              </div>
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          </div>
        </Section>

        <Section title="🔐 Security">
          <div className="space-y-4">
            <div>
              <Label>API Keys Storage</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Keys are stored locally in your browser. Never shared with third parties.
              </p>
            </div>
            <Button variant="outline" className="w-full">
              <Shield className="h-4 w-4" /> Export All Keys
            </Button>
          </div>
        </Section>

        <Section title="ℹ️ About">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Build</span>
              <span className="font-mono">2026.07.24</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Framework</span>
              <span>React + Vite + TailwindCSS</span>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="🛒 Beli Token"
        sub="Pilih provider, tentukan jumlah, lalu bayar"
        className="mt-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
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
          const stock = providerTokens.length
          const price = providerTokens.length > 0 ? providerTokens[0].price : 0

          if (stock === 0) {
            return (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Stok {PROVIDERS.find(p => p.key === activeTokenTab)?.label} habis
              </div>
            )
          }

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
            <div className="text-sm font-medium mb-3">Riwayat Pembelian</div>
            <div className="space-y-2">
              {myOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-background/50"
                >
                  <div>
                    <div className="text-sm font-medium">{order.token_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PROVIDERS.find(p => p.key === order.provider)?.label} - Rp {order.price.toLocaleString('id-ID')}
                    </div>
                  </div>
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
              <button onClick={() => { setSelectedBuyQty(0); setSelectedBuyProvider('roboneo') }} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
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

              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={handleConfirmBuy}>
                  <ExternalLink className="h-4 w-4" />
                  Transfer & Konfirmasi WhatsApp
                </Button>
                <Button variant="outline" onClick={() => { setSelectedBuyQty(0); setSelectedBuyProvider('roboneo') }}>
                  Batal
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Section
        title="🔧 Developer Tools — Task Manager"
        sub="Paksa hentikan proses generasi yang macet/ngambang"
        className="mt-5"
        right={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopAll}
              disabled={stoppingAll || activeTasks.length === 0}
              loading={stoppingAll}
            >
              {!stoppingAll && <Square className="h-3.5 w-3.5" />}
              Stop All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear All
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {activeTasks.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <div className="text-2xl mb-2">✅</div>
              Tidak ada proses yang sedang berjalan
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-amber-500 font-medium mb-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {activeTasks.length} proses aktif
              </div>
              {activeTasks.map((task) => (
                <div
                  key={task.taskId}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-background/50 hover:bg-accent/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                      <span className="text-sm font-medium truncate">{task.model}</span>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {formatElapsed(task.startedAt)} ago
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {task.prompt.slice(0, 80)}{task.prompt.length > 80 ? '...' : ''}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1 opacity-60">
                      ID: {task.taskId.slice(0, 30)}...
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleStopTask(task.taskId, task.model)}
                    disabled={stopping === task.taskId}
                    loading={stopping === task.taskId}
                    className="shrink-0"
                  >
                    {stopping !== task.taskId && <Square className="h-3.5 w-3.5" />}
                    End Task
                  </Button>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {results.length} hasil tersimpan
                </span>
                <Button variant="ghost" size="sm" onClick={handleClearResults}>
                  <Trash2 className="h-3 w-3" /> Clear Results
                </Button>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {logs.length} log entries
                </span>
                <Button variant="ghost" size="sm" onClick={handleClearLogs}>
                  <Trash2 className="h-3 w-3" /> Clear Logs
                </Button>
              </div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-background/50 border border-border p-2 space-y-0.5">
                {logs.slice(-15).reverse().map((log, i) => (
                  <div key={i} className="text-[10px] font-mono flex gap-2">
                    <span className="text-muted-foreground shrink-0">{log.time}</span>
                    <span className={log.level === 'error' ? 'text-red-500' : log.level === 'success' ? 'text-green-500' : 'text-muted-foreground'}>
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </PageContent>
  )
}
