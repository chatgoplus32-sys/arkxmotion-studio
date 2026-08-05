import { useState, useEffect, useCallback, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { checkRoboneoBalance } from '@/lib/roboneo'
import { Key, Plus, RefreshCw, Upload, ShieldCheck, Loader2, CheckCircle2, XCircle, Filter, Trash2, AlertTriangle, Eye, EyeOff, RotateCcw, Pencil } from 'lucide-react'

interface Token {
  id: number
  provider: string
  name: string
  token_value: string
  price: number
  credits?: number | null
  credit_group?: string | null
  status: string
  created_at: string
}

type Provider = 'roboneo' | 'framia' | 'weavy'

const PROVIDERS: { key: Provider; label: string; minCredits: number }[] = [
  { key: 'roboneo', label: 'Roboneo', minCredits: 0 },
  { key: 'framia', label: 'Framia', minCredits: 0 },
  { key: 'weavy', label: 'Weavy', minCredits: 0 },
]

interface StockInfo {
  total: number
  available: number
  sold: number
  price: number
}

interface ValidationResult {
  token: string
  index: number
  status: 'pending' | 'checking' | 'valid' | 'invalid' | 'error'
  balance?: number | null
  error?: string
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
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([])
  const [validating, setValidating] = useState(false)
  const [validationDone, setValidationDone] = useState(false)
  const [validTokenCount, setValidTokenCount] = useState(0)

  const [tokenList, setTokenList] = useState<Token[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [showTokenValues, setShowTokenValues] = useState<Record<number, boolean>>({})
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [confirmDeleteAllText, setConfirmDeleteAllText] = useState('')
  const [showEditPrice, setShowEditPrice] = useState(false)
  const [editPrice, setEditPrice] = useState('')
  const [updatingPrice, setUpdatingPrice] = useState(false)
  const [creditFilter, setCreditFilter] = useState('all')
  const [refreshingCredits, setRefreshingCredits] = useState(false)

  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((s) => s.addToast)
  const addToastRef = useRef(addToast)
  addToastRef.current = addToast

  const currentProvider = PROVIDERS.find(p => p.key === activeTab)!

  function getCreditGroup(credits: number | string): string {
    const b = Number(credits)
    if (isNaN(b)) return '<70'
    if (b >= 100) return '100+'
    if (b >= 90) return '90-100'
    if (b >= 80) return '80-90'
    if (b >= 70) return '70-80'
    return '<70'
  }

  const handleRefreshCreditGroups = async () => {
    if (activeTab !== 'roboneo') return
    setRefreshingCredits(true)
    addToast('Mulai refresh credit groups...', 'info')

    try {
      const tokensToRefresh = tokenList.filter(t => t.status === 'available' && (!t.credits || !t.credit_group))
      if (tokensToRefresh.length === 0) {
        addToast('Semua token sudah punya credit group', 'info')
        setRefreshingCredits(false)
        return
      }

      addToast(`Memvalidasi ${tokensToRefresh.length} token...`, 'info')
      let updated = 0
      for (const t of tokensToRefresh) {
        const check = await checkRoboneoBalance(t.token_value)
        if (check.ok && check.balance !== null && check.balance !== undefined) {
          const group = getCreditGroup(check.balance)
          await fetch('/api/admin/tokens', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ id: t.id, credits: check.balance, credit_group: group })
          })
          updated++
        }
        await new Promise(r => setTimeout(r, 500))
      }

      addToast(`${updated}/${tokensToRefresh.length} token berhasil di-update credit groupnya`, 'success')
      fetchTokenList()
      fetchStock()
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setRefreshingCredits(false)
    }
  }

  const fetchStock = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/tokens', {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      })
      if (response.ok) {
        const data = await response.json()
        const s: Record<Provider, StockInfo> = {
          roboneo: { total: 0, available: 0, sold: 0, price: 0 },
          framia: { total: 0, available: 0, sold: 0, price: 0 },
          weavy: { total: 0, available: 0, sold: 0, price: 0 },
        }
        for (const t of data.tokens) {
          if (s[t.provider as Provider]) {
            s[t.provider as Provider].total++
            if (t.status === 'available') {
              s[t.provider as Provider].available++
              s[t.provider as Provider].price = t.price
            }
            if (t.status === 'sold') s[t.provider as Provider].sold++
          }
        }
        setStock(s)
      }
    } catch {
      addToastRef.current('Gagal memuat stok', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  const fetchTokenList = useCallback(async () => {
    if (!token) return
    setLoadingTokens(true)
    try {
      const res = await fetch(`/api/admin/tokens?provider=${activeTab}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      })
      if (res.ok) {
        const data = await res.json()
        setTokenList(data.tokens || [])
      }
    } catch {
      // silent
    } finally {
      setLoadingTokens(false)
    }
  }, [token, activeTab])

  useEffect(() => {
    fetchStock()
  }, [fetchStock])

  useEffect(() => {
    fetchTokenList()
  }, [fetchTokenList])

  const handleDeleteToken = async (tokenId: number, tokenName: string) => {
    if (!confirm(`Hapus token "${tokenName}"?`)) return
    setDeletingId(tokenId)
    try {
      const res = await fetch(`/api/admin/tokens/${tokenId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        addToast(`Token "${tokenName}" dihapus`, 'success')
        fetchTokenList()
        fetchStock()
      } else {
        const data = await res.json()
        addToast(data.error || 'Gagal hapus', 'error')
      }
    } catch {
      addToast('Gagal hapus token', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteAllAvailable = async () => {
    if (confirmDeleteAllText !== 'HAPUS') {
      addToast('Ketik "HAPUS" untuk konfirmasi', 'error')
      return
    }
    setDeletingAll(true)
    try {
      const res = await fetch('/api/admin/tokens/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ provider: activeTab, status: 'available' })
      })
      if (res.ok) {
        const data = await res.json()
        addToast(`${data.count || 0} token available dihapus`, 'success')
        fetchTokenList()
        fetchStock()
        setShowDeleteAll(false)
        setConfirmDeleteAllText('')
      } else {
        const data = await res.json()
        addToast(data.error || 'Gagal hapus', 'error')
      }
    } catch {
      addToast('Gagal hapus token', 'error')
    } finally {
      setDeletingAll(false)
    }
  }

  const handleDeleteAllByProvider = async () => {
    if (confirmDeleteAllText !== 'HAPUS') {
      addToast('Ketik "HAPUS" untuk konfirmasi', 'error')
      return
    }
    setDeletingAll(true)
    try {
      const res = await fetch('/api/admin/tokens/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ provider: activeTab })
      })
      if (res.ok) {
        const data = await res.json()
        addToast(`${data.count || 0} token dihapus`, 'success')
        fetchTokenList()
        fetchStock()
        setShowDeleteAll(false)
        setConfirmDeleteAllText('')
      } else {
        const data = await res.json()
        addToast(data.error || 'Gagal hapus', 'error')
      }
    } catch {
      addToast('Gagal hapus token', 'error')
    } finally {
      setDeletingAll(false)
    }
  }

  const handleBulkUpdatePrice = async () => {
    if (!editPrice) return
    setUpdatingPrice(true)
    try {
      const res = await fetch('/api/admin/tokens/bulk-update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ provider: activeTab, price: Number(editPrice) })
      })
      if (res.ok) {
        const data = await res.json()
        addToast(`Harga ${data.count || 0} token ${currentProvider.label} berhasil diupdate ke Rp ${Number(editPrice).toLocaleString('id-ID')}`, 'success')
        setShowEditPrice(false)
        setEditPrice('')
        fetchTokenList()
        fetchStock()
      } else {
        const data = await res.json()
        addToast(data.error || 'Gagal update harga', 'error')
      }
    } catch {
      addToast('Gagal update harga token', 'error')
    } finally {
      setUpdatingPrice(false)
    }
  }

  const handleValidateTokens = async () => {
    const lines = bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) {
      addToast('Tidak ada token yang diisi', 'error')
      return
    }

    setValidating(true)
    setValidationDone(false)
    const results: ValidationResult[] = lines.map((t, i) => ({ token: t, index: i, status: 'pending' }))
    setValidationResults([...results])

    let validCount = 0

    if (activeTab === 'roboneo') {
      for (let i = 0; i < lines.length; i++) {
        results[i] = { ...results[i], status: 'checking' }
        setValidationResults([...results])

        const check = await checkRoboneoBalance(lines[i])

        if (check.ok && check.balance !== null && check.balance !== undefined) {
          if (check.isValidUser === false) {
            results[i] = { ...results[i], status: 'invalid', balance: check.balance, error: `Token tidak valid (is_valid_user=false)` }
          } else if (check.balance >= currentProvider.minCredits) {
            results[i] = { ...results[i], status: 'valid', balance: check.balance }
            validCount++
          } else {
            results[i] = { ...results[i], status: 'invalid', balance: check.balance, error: `Credit ${check.balance} < ${currentProvider.minCredits} minimum` }
          }
        } else {
          results[i] = { ...results[i], status: 'error', error: check.error || 'Unknown error' }
        }
        setValidationResults([...results])

        if (i < lines.length - 1) {
          await new Promise(r => setTimeout(r, 800))
        }
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        results[i] = { ...results[i], status: 'valid' }
        validCount++
        setValidationResults([...results])
      }
    }

    setValidTokenCount(validCount)
    setValidationDone(true)
    setValidating(false)
  }

  const handleSubmitBulk = async (filteredTokens?: Array<{ token: string; credits?: number | null }>) => {
    const lines = filteredTokens || bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0).map(t => ({ token: t, credits: undefined as number | null | undefined }))
    console.log('[admin-tokens] handleSubmitBulk called:', { lines: lines.length, price, filteredTokens: !!filteredTokens })
    if (lines.length === 0) {
      addToast('Tidak ada token valid untuk diupload', 'error')
      return
    }
    if (!price) {
      addToast('Isi harga token', 'error')
      return
    }

    setUploading(true)
    const bulkPayload = lines.map((item, i) => ({
      name: `${currentProvider.label} #${stock[activeTab].total + i + 1}`,
      token_value: item.token,
      credits: item.credits ?? null,
      credit_group: item.credits != null ? getCreditGroup(item.credits) : null,
    }))

    try {
      const response = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ provider: activeTab, price: Number(price), tokens: bulkPayload })
      })
      const data = await response.json()
      if (response.ok) {
        addToast(`${data.count || lines.length} token berhasil diupload`, 'success')
        fetchStock()
        fetchTokenList()
      } else {
        addToast(data.error || 'Gagal upload', 'error')
        console.error('[admin-tokens] upload error:', data)
      }
    } catch (err: any) {
      addToast('Gagal upload token', 'error')
      console.error('[admin-tokens] upload exception:', err)
    }

    setUploading(false)
    setBulkTokens('')
    setPrice('')
    setShowForm(false)
    setValidationResults([])
    setValidationDone(false)
  }

  const handleUploadValidOnly = () => {
    const validTokens = validationResults
      .filter(r => r.status === 'valid')
      .map(r => ({ token: r.token, credits: r.balance }))
    handleSubmitBulk(validTokens)
  }

  const handleUploadFiltered = () => {
    const filtered = validationResults
      .filter(r => {
        if (r.status !== 'valid') return false
        const b = r.balance ?? 0
        if (creditFilter === '70-80') return b >= 70 && b <= 80
        if (creditFilter === '80-90') return b >= 80 && b <= 90
        if (creditFilter === '90-100') return b >= 90 && b <= 100
        if (creditFilter === '100+') return b >= 100
        if (creditFilter === '0-70') return b < 70
        return true
      })
      .map(r => ({ token: r.token, credits: r.balance }))
    handleSubmitBulk(filtered)
  }

  const tokenCount = bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0).length

  const availableTokens = tokenList.filter(t => t.status === 'available')
  const soldTokens = tokenList.filter(t => t.status === 'sold')

  return (
    <div>
      <PageHeader
        title="Kelola Token"
        desc="Upload, lihat, dan hapus stok token Roboneo, Framia, dan Weavy"
      />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
          {PROVIDERS.map((p) => {
            const s = stock[p.key]
            const isActive = activeTab === p.key
            return (
              <button
                key={p.key}
                onClick={() => { setActiveTab(p.key); setShowForm(false); setBulkTokens(''); setPrice(''); setValidationResults([]); setValidationDone(false); setShowDeleteAll(false); setConfirmDeleteAllText('') }}
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
                {p.minCredits > 0 && (
                  <div className="text-[10px] text-amber-500 mt-1">Min. {p.minCredits} credits/token</div>
                )}
              </button>
            )
          })}
        </div>

        <Section
          title={`${currentProvider.label}`}
          sub={`Total: ${stock[activeTab].total} | Tersedia: ${stock[activeTab].available} | Terjual: ${stock[activeTab].sold}`}
          right={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { fetchStock(); fetchTokenList() }} disabled={isLoading || loadingTokens}>
                <RefreshCw className={`h-4 w-4 ${(isLoading || loadingTokens) ? 'animate-spin' : ''}`} />
              </Button>
              {activeTab === 'roboneo' && availableTokens.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleRefreshCreditGroups} disabled={refreshingCredits}>
                  {refreshingCredits ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh CR
                </Button>
              )}
              {!showForm && (
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4" /> Upload
                </Button>
              )}
              {availableTokens.length > 0 && !showForm && (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setShowEditPrice(!showEditPrice); setEditPrice(stock[activeTab].price.toString()); setShowDeleteAll(false); setConfirmDeleteAllText('') }}>
                    <Pencil className="h-4 w-4" /> Edit Harga
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => { setShowDeleteAll(!showDeleteAll); setConfirmDeleteAllText(''); setShowEditPrice(false); setEditPrice('') }}>
                    <Trash2 className="h-4 w-4" /> Hapus Stok
                  </Button>
                </>
              )}
            </div>
          }
        >
          {/* Edit All Price Section */}
          {showEditPrice && (
            <div className="mb-4 p-4 rounded-xl border border-primary/30 bg-primary/5">
              <div className="text-sm font-medium mb-3 flex items-center gap-2">
                <Pencil className="h-4 w-4" />
                Edit Harga Semua Token {currentProvider.label}
                {stock[activeTab].available > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">({stock[activeTab].available} token tersedia)</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Rp</span>
                    <Input
                      type="number"
                      placeholder="50000"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="text-lg font-semibold max-w-[200px]"
                    />
                    <span className="text-xs text-muted-foreground">/ token</span>
                  </div>
                  {editPrice && stock[activeTab].available > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Total: Rp {(Number(editPrice) * stock[activeTab].available).toLocaleString('id-ID')} untuk {stock[activeTab].available} token
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-5">
                  <Button
                    size="sm"
                    onClick={handleBulkUpdatePrice}
                    disabled={updatingPrice || !editPrice || Number(editPrice) < 0}
                    loading={updatingPrice}
                  >
                    {updatingPrice ? null : <CheckCircle2 className="h-4 w-4" />}
                    {updatingPrice ? 'Menyimpan...' : 'Simpan Semua'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowEditPrice(false); setEditPrice('') }}
                    disabled={updatingPrice}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Delete All Section */}
          {showDeleteAll && (
            <div className="mb-4 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
              <div className="text-sm font-medium text-red-500 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Hapus Stok Token {currentProvider.label}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <button
                  onClick={handleDeleteAllAvailable}
                  disabled={deletingAll || confirmDeleteAllText !== 'HAPUS'}
                  className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-left hover:bg-amber-500/10 transition disabled:opacity-50"
                >
                  <div className="text-xs font-medium text-amber-500">Hapus Semua Available</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{availableTokens.length} token akan dihapus (tidak termasuk yang sudah terjual)</div>
                </button>
                <button
                  onClick={handleDeleteAllByProvider}
                  disabled={deletingAll || confirmDeleteAllText !== 'HAPUS'}
                  className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-left hover:bg-red-500/10 transition disabled:opacity-50"
                >
                  <div className="text-xs font-medium text-red-500">Hapus SEMUA (Available + Sold)</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{stock[activeTab].total} token akan dihapus permanen</div>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder='Ketik "HAPUS" untuk konfirmasi'
                  value={confirmDeleteAllText}
                  onChange={(e) => setConfirmDeleteAllText(e.target.value)}
                  className="text-xs max-w-[200px]"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteAllAvailable}
                  disabled={deletingAll || confirmDeleteAllText !== 'HAPUS'}
                  loading={deletingAll}
                >
                  {deletingAll ? null : <Trash2 className="h-3.5 w-3.5" />}
                  {deletingAll ? 'Menghapus...' : 'Hapus'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowDeleteAll(false); setConfirmDeleteAllText('') }}>
                  Batal
                </Button>
              </div>
            </div>
          )}

          {/* Upload Form */}
          {showForm && (
            <div className="mb-4 p-4 rounded-xl border border-border bg-background/50">
              <div className="text-sm font-medium mb-3">
                Upload Bulk Token
                {currentProvider.minCredits > 0 && (
                  <span className="ml-2 text-xs text-amber-500 font-normal">
                    (Wajib validasi — min. {currentProvider.minCredits} credits)
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Label>Token / API Key (satu per baris)</Label>
                  <Textarea
                    placeholder={`token_abc123\ntoken_def456\ntoken_ghi789`}
                    rows={4}
                    value={bulkTokens}
                    onChange={(e) => { setBulkTokens(e.target.value); setValidationResults([]); setValidationDone(false) }}
                    className="font-mono text-xs"
                  />
                  {bulkTokens.trim() && (
                    <div className="text-xs text-muted-foreground mt-1">{tokenCount} token terdeteksi</div>
                  )}

                  {bulkTokens.trim() && !validationDone && !validating && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={handleValidateTokens}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {currentProvider.minCredits > 0
                        ? `Validasi & Filter (min. ${currentProvider.minCredits} cr)`
                        : 'Validasi Token'}
                    </Button>
                  )}

                  {validating && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Memvalidasi token... ({validationResults.filter(r => r.status !== 'pending' && r.status !== 'checking').length}/{validationResults.length})
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${(validationResults.filter(r => r.status !== 'pending' && r.status !== 'checking').length / validationResults.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {validationDone && validationResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <div className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {validationResults.filter(r => r.status === 'valid').length} valid
                        </div>
                        <div className="flex items-center gap-1 text-red-500">
                          <XCircle className="h-3.5 w-3.5" />
                          {validationResults.filter(r => r.status === 'invalid' || r.status === 'error').length} ditolak
                        </div>
                        {currentProvider.minCredits > 0 && (
                          <div className="flex items-center gap-1 text-amber-500">
                            <Filter className="h-3.5 w-3.5" />
                            Min. {currentProvider.minCredits} cr
                          </div>
                        )}
                        {activeTab === 'roboneo' && (
                          <select
                            value={creditFilter}
                            onChange={(e) => setCreditFilter(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2 py-1 text-[11px]"
                          >
                            <option value="all">Semua Credit</option>
                            <option value="70-80">70–80 cr</option>
                            <option value="80-90">80–90 cr</option>
                            <option value="90-100">90–100 cr</option>
                            <option value="100+">100+ cr</option>
                            <option value="0-70">{'< 70 cr'}</option>
                          </select>
                        )}
                      </div>

                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/80 text-[11px] font-mono">
                        {validationResults
                          .filter(r => {
                            if (creditFilter === 'all') return true
                            if (activeTab !== 'roboneo') return true
                            const b = r.balance ?? 0
                            if (creditFilter === '70-80') return b >= 70 && b <= 80
                            if (creditFilter === '80-90') return b >= 80 && b <= 90
                            if (creditFilter === '90-100') return b >= 90 && b <= 100
                            if (creditFilter === '100+') return b >= 100
                            if (creditFilter === '0-70') return b < 70
                            return true
                          })
                          .map((r, i) => (
                          <div
                            key={i}
                            className={`flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50 last:border-0 ${
                              r.status === 'valid' ? 'text-emerald-500' :
                              r.status === 'invalid' || r.status === 'error' ? 'text-red-500' :
                              r.status === 'checking' ? 'text-amber-400' :
                              'text-muted-foreground'
                            }`}
                          >
                            <span className="w-5 text-right shrink-0">{i + 1}.</span>
                            <span className="truncate flex-1">{r.token.slice(0, 40)}{r.token.length > 40 ? '...' : ''}</span>
                            {r.status === 'valid' && <span className="text-emerald-500 shrink-0">✓ {r.balance != null ? `${r.balance} cr` : 'OK'}</span>}
                            {r.status === 'invalid' && <span className="text-red-500 shrink-0">✗ {r.balance != null ? `${r.balance} cr` : r.error}</span>}
                            {r.status === 'error' && <span className="text-red-500 shrink-0">✗ {r.error}</span>}
                            {r.status === 'checking' && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                            {r.status === 'pending' && <span className="text-muted-foreground shrink-0">menunggu</span>}
                          </div>
                        ))}
                      </div>
                    </div>
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

                  {validationDone ? (
                    <div className="mt-auto space-y-2">
                      {validTokenCount > 0 && (
                        <Button
                          className="w-full"
                          onClick={handleUploadValidOnly}
                          disabled={uploading || !price}
                          loading={uploading}
                        >
                          {uploading ? null : <Upload className="h-4 w-4" />}
                          {uploading ? 'Mengupload...' : `Upload ${validTokenCount} Token Valid`}
                        </Button>
                      )}
                      {activeTab === 'roboneo' && creditFilter !== 'all' && validTokenCount > 0 && (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={handleUploadFiltered}
                          disabled={uploading || !price}
                          loading={uploading}
                        >
                          {uploading ? null : <Upload className="h-4 w-4" />}
                          {uploading ? 'Mengupload...' : `Upload Filter (${creditFilter})`}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => { setValidationResults([]); setValidationDone(false); setBulkTokens(''); setPrice(''); setCreditFilter('all') }}
                      >
                        Reset
                      </Button>
                    </div>
                  ) : currentProvider.minCredits > 0 ? (
                    <div className="mt-auto">
                      <div className="text-xs text-amber-500 mb-2">
                        Wajib validasi dulu sebelum upload
                      </div>
                      <Button
                        className="w-full"
                        disabled
                      >
                        <Upload className="h-4 w-4" />
                        Upload {tokenCount || ''} Token
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="w-full mt-auto"
                      onClick={() => handleSubmitBulk()}
                      disabled={uploading || !bulkTokens.trim() || !price || validating}
                      loading={uploading}
                    >
                      {uploading ? null : <Upload className="h-4 w-4" />}
                      {uploading ? 'Mengupload...' : `Upload ${tokenCount || ''} Token`}
                    </Button>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { setShowForm(false); setBulkTokens(''); setPrice(''); setValidationResults([]); setValidationDone(false) }}>
                Batal
              </Button>
            </div>
          )}

          {/* Token List */}
          {!showForm && (
            <div className="space-y-4">
              {/* Available Tokens */}
              {availableTokens.length > 0 && (
                <div>
                  {/* Credit Group Summary */}
                  {activeTab === 'roboneo' && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {['100+', '90-100', '80-90', '70-80', '<70'].map((group) => {
                        const count = availableTokens.filter(t => {
                          const b = (t as any).credits ?? 0
                          if (group === '100+') return b >= 100
                          if (group === '90-100') return b >= 90 && b < 100
                          if (group === '80-90') return b >= 80 && b < 90
                          if (group === '70-80') return b >= 70 && b < 80
                          return b < 70
                        }).length
                        if (count === 0) return null
                        return (
                          <div key={group} className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono text-primary">
                            {group} cr: {count} token
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Tersedia ({availableTokens.length})
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    {availableTokens.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-accent/20 transition text-xs"
                      >
                        <span className="font-medium truncate w-28 shrink-0">{t.name}</span>
                        {(t as any).credits != null && (
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-mono shrink-0">
                            {(t as any).credits} cr
                          </span>
                        )}
                        <span className="font-mono text-muted-foreground truncate flex-1" title={showTokenValues[t.id] ? t.token_value : undefined}>
                          {showTokenValues[t.id] ? t.token_value : t.token_value.slice(0, 20) + '••••'}
                        </span>
                        <span className="text-muted-foreground shrink-0">Rp {t.price.toLocaleString('id-ID')}</span>
                        <button
                          onClick={() => setShowTokenValues(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                          className="text-muted-foreground hover:text-foreground transition shrink-0"
                          title={showTokenValues[t.id] ? 'Sembunyikan' : 'Tampilkan'}
                        >
                          {showTokenValues[t.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteToken(t.id, t.name)}
                          disabled={deletingId === t.id}
                          className="text-muted-foreground hover:text-red-500 transition shrink-0 disabled:opacity-50"
                          title="Hapus token"
                        >
                          {deletingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sold Tokens */}
              {soldTokens.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Terjual ({soldTokens.length})
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    {soldTokens.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-accent/20 transition text-xs opacity-60"
                      >
                        <span className="font-medium truncate w-28 shrink-0">{t.name}</span>
                        <span className="font-mono text-muted-foreground truncate flex-1">
                          {t.token_value.slice(0, 20)}••••
                        </span>
                        <span className="text-amber-500 text-[10px] shrink-0">TERJUAL</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tokenList.length === 0 && !loadingTokens && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Belum ada token. Klik "Upload" untuk menambah stok.
                </div>
              )}
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
