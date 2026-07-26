import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Key, Plus, RefreshCw, Upload, ShieldCheck, ShieldAlert, Loader2, CheckCircle2, XCircle, Filter } from 'lucide-react'

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

const PROVIDERS: { key: Provider; label: string; minCredits: number }[] = [
  { key: 'roboneo', label: 'Roboneo', minCredits: 150 },
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

async function checkRoboneoBalanceApi(accessToken: string): Promise<{ ok: boolean; balance?: number | null; error?: string }> {
  try {
    const res = await fetch('/api/public/roboneo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Roboneo-Token': accessToken },
      body: JSON.stringify({
        path: 'vipshow',
        parameter: {
          token: '45C30555F10E49629098A75F95828DA6',
          gid: Math.random().toString(36).slice(2),
          uid: '0',
          trace_id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
          client_id: '1189857684',
          app_scene: 'roboneo',
          area_code: 'ID',
          lang: 'en',
          time_zone: 'Asia/Jakarta',
          features: '',
          later_face: 0,
        },
      }),
    })
    const proxyResp = await res.json().catch(() => null)
    const data = proxyResp?.data
    if (!data || data.error_code !== 0) {
      return { ok: false, error: data?.error_msg || `error_code=${data?.error_code}` }
    }
    const param = data.parameter || data
    const balanceKeys = ['credit', 'balance', 'remain', 'quota', 'point', 'coin', 'energy']
    let balance: number | null = null
    function findBalance(obj: any, depth = 0): number | null {
      if (depth > 5 || !obj || typeof obj !== 'object') return null
      for (const [k, v] of Object.entries(obj)) {
        const kl = k.toLowerCase()
        if (typeof v === 'number' && balanceKeys.some((bk) => kl.includes(bk))) return v
        if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && balanceKeys.some((bk) => kl.includes(bk))) return Number(v)
        if (typeof v === 'object' && v !== null) {
          const found = findBalance(v, depth + 1)
          if (found !== null) return found
        }
      }
      return null
    }
    balance = findBalance(param)
    return { ok: true, balance }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
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
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((s) => s.addToast)

  const currentProvider = PROVIDERS.find(p => p.key === activeTab)!

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

        const check = await checkRoboneoBalanceApi(lines[i])

        if (check.ok && check.balance !== null && check.balance !== undefined) {
          if (check.balance >= currentProvider.minCredits) {
            results[i] = { ...results[i], status: 'valid', balance: check.balance }
            validCount++
          } else {
            results[i] = { ...results[i], status: 'invalid', balance: check.balance, error: `Credit ${check.balance} < ${currentProvider.minCredits} minimum` }
          }
        } else {
          results[i] = { ...results[i], status: 'error', error: check.error || 'Token tidak valid' }
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

  const handleSubmitBulk = async (filteredTokens?: string[]) => {
    const lines = filteredTokens || bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) {
      addToast('Tidak ada token valid untuk diupload', 'error')
      return
    }
    if (!price) {
      addToast('Isi harga token', 'error')
      return
    }

    setUploading(true)
    const bulkPayload = lines.map((tokenValue, i) => ({
      name: `${currentProvider.label} #${stock[activeTab].total + i + 1}`,
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
    setValidationResults([])
    setValidationDone(false)
  }

  const handleUploadValidOnly = () => {
    const validTokens = validationResults
      .filter(r => r.status === 'valid')
      .map(r => r.token)
    handleSubmitBulk(validTokens)
  }

  const tokenCount = bulkTokens.split('\n').map(l => l.trim()).filter(l => l.length > 0).length

  return (
    <div>
      <PageHeader
        title="Upload Token"
        desc="Upload stok token Roboneo, Framia, dan Weavy"
      />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {PROVIDERS.map((p) => {
            const s = stock[p.key]
            const isActive = activeTab === p.key
            return (
              <button
                key={p.key}
                onClick={() => { setActiveTab(p.key); setShowForm(false); setBulkTokens(''); setPrice(''); setValidationResults([]); setValidationDone(false) }}
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

                  {/* Validation Button */}
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

                  {/* Validation Progress */}
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

                  {/* Validation Results */}
                  {validationDone && validationResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-3 text-xs">
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
                      </div>

                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background/80 text-[11px] font-mono">
                        {validationResults.map((r, i) => (
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

                  {/* Upload Buttons */}
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
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => { setValidationResults([]); setValidationDone(false); setBulkTokens(''); setPrice('') }}
                      >
                        Reset
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
        </Section>
      </PageContent>
    </div>
  )
}
