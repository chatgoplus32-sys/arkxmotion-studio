import { useState, useRef, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Input } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { logAudit } from '@/lib/auditLog'
import {
  ShoppingBag, Upload, Rocket, Trash2, Download, X, Plus, Square, Image, User,
} from 'lucide-react'

const PRODUCT_TYPES = [
  'Fashion (Baju/Dress)', 'Aksesoris (Tas/Jam/Sepatu)', 'Kosmetik/Skincare',
  'Makanan/Minuman', 'Elektronik', 'Home & Living', 'Olahraga', 'Lainnya',
]

const MODEL_STYLES = [
  { value: 'female-casual', label: 'Wanita Casual' },
  { value: 'female-elegant', label: 'Wanita Elegant' },
  { value: 'female-sporty', label: 'Wanita Sporty' },
  { value: 'female-hijab', label: 'Wanita Berhijab' },
  { value: 'male-casual', label: 'Pria Casual' },
  { value: 'male-elegant', label: 'Pria Elegant' },
  { value: 'male-sporty', label: 'Pria Sporty' },
  { value: 'unisex', label: 'Unisex' },
]

const BACKGROUNDS = [
  { value: 'studio', label: 'Studio Clean' },
  { value: 'lifestyle', label: 'Lifestyle / Daily Use' },
  { value: 'outdoor', label: 'Outdoor / Nature' },
  { value: 'minimal', label: 'Minimal White' },
  { value: 'gradient', label: 'Gradient Colorful' },
]

const RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9']

interface ProductImage {
  id: string
  file: File
  preview: string
  name: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'success' | 'error' | 'warn'
}

interface UGCResult {
  id: string
  url: string
  status: 'done' | 'error'
  error?: string
}

export default function UGCPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [modelFile, setModelFile] = useState<File | null>(null)
  const [modelPreview, setModelPreview] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductImage[]>([])
  const [provider, setProvider] = useState('weavy')
  const [productType, setProductType] = useState(PRODUCT_TYPES[0])
  const [modelStyle, setModelStyle] = useState('female-casual')
  const [background, setBackground] = useState('studio')
  const [ratio, setRatio] = useState('4:5')
  const [extraPrompt, setExtraPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<UGCResult[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState({ show: false, text: '', pct: 0, time: '0:00' })

  const modelRef = useRef<HTMLInputElement>(null)
  const productRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const handleModelUpload = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      if (modelPreview) URL.revokeObjectURL(modelPreview)
      setModelFile(file)
      setModelPreview(URL.createObjectURL(file))
    }
  }

  const handleProductUpload = (files: FileList | null) => {
    if (!files) return
    const newProducts: ProductImage[] = Array.from(files).slice(0, 10 - products.length).map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: URL.createObjectURL(f),
      name: f.name,
    }))
    setProducts((prev) => [...prev, ...newProducts])
  }

  const removeProduct = (id: string) => {
    setProducts((prev) => {
      const p = prev.find((x) => x.id === id)
      if (p) URL.revokeObjectURL(p.preview)
      return prev.filter((x) => x.id !== id)
    })
  }

  const buildPrompt = (productName: string) => {
    const styleLabel = MODEL_STYLES.find((s) => s.value === modelStyle)?.label || 'model'
    const bgLabel = BACKGROUNDS.find((b) => b.value === background)?.label || 'studio'
    let prompt = `Professional product UGC photo. A ${styleLabel} model using/wearing ${productName} (${productType}). `
    prompt += `Background: ${bgLabel}. `
    prompt += `High quality, commercial photography, natural lighting, Instagram-style aesthetic. `
    if (extraPrompt) prompt += extraPrompt
    return prompt
  }

  const handleGenerate = async () => {
    if (products.length === 0) return
    setGenerating(true)
    setResults([])
    setLogs([])
    setStatus({ show: true, text: `Memproses ${products.length} produk…`, pct: 5, time: '0:00' })
    addLog(`Mulai generate ${products.length} produk...`, 'info')

    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setStatus({ time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` })
    }, 1000)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { generateWeavyBulkOne } = await import('@/lib/weavy')

      for (let i = 0; i < products.length; i++) {
        if (controller.signal.aborted) break
        const product = products[i]
        setStatus({ text: `#${i + 1}: ${product.name}…`, pct: ((i + 1) / products.length) * 100 })
        addLog(`#${i + 1}: Generate ${product.name}...`, 'info')

        try {
          const prompt = buildPrompt(product.name)
          const charFile = modelFile || product.file

          addLog(`#${i + 1}: Upload & process...`, 'info')
          const imageUrl = await generateWeavyBulkOne({
            modelKey: 'nanobanana2',
            prompt,
            quality: '1K',
            ratio,
            charFile,
            outfitFile: product.file,
          })

          if (!controller.signal.aborted) {
            setResults((prev) => [...prev, { id: product.id, url: imageUrl, status: 'done' }])
            addLog(`#${i + 1}: ✅ Selesai`, 'success')
          }
        } catch (err: any) {
          if (!controller.signal.aborted) {
            setResults((prev) => [...prev, { id: product.id, url: '', status: 'error', error: err.message }])
            addLog(`#${i + 1}: ❌ ${err.message}`, 'error')
          }
        }
      }

      if (!controller.signal.aborted) {
        const doneCount = results.filter((r) => r.status === 'done').length + 1
        setStatus({ pct: 100, text: `✅ Selesai — ${doneCount}/${products.length} sukses` })
        addLog(`Selesai: ${doneCount}/${products.length}`, 'success')
        addToast('UGC generation selesai', 'success')
        logAudit('UGC_GENERATE', `${products.length} produk di-generate`, 'success')
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setStatus({ pct: 100, text: `❌ ${err.message}` })
        addLog(`Fatal: ${err.message}`, 'error')
      }
    } finally {
      clearInterval(timer)
      setGenerating(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setGenerating(false)
    setStatus({ text: '⏹️ Dihentikan', pct: 100 })
    addLog('Dihentikan oleh user', 'warn')
  }

  const handleDownloadSingle = async (url: string, filename: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000)
    } catch {
      window.open(url, '_blank')
    }
  }

  const doneResults = useMemo(() => results.filter((r) => r.status === 'done' && r.url), [results])

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Product UGC"
        highlight="Generator"
        desc="Upload produk (+ model reference) → generate foto model menggunakan produk."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Upload */}
        <div className="space-y-5">
          {/* Model Upload */}
          <Section title="🧑 Model Reference" sub="Upload foto model (opsional)">
            <input ref={modelRef} type="file" accept="image/*" hidden onChange={(e) => handleModelUpload(e.target.files)} />
            {modelPreview ? (
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border border-border">
                <img src={modelPreview} alt="model" className="w-full h-full object-cover" />
                <button
                  onClick={() => { setModelFile(null); setModelPreview(null) }}
                  className="absolute top-2 right-2 rounded-full px-2 py-1 text-xs bg-black/60 text-white flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Hapus
                </button>
              </div>
            ) : (
              <button
                onClick={() => modelRef.current?.click()}
                className="w-full aspect-[3/4] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4"
              >
                <div>
                  <div className="text-3xl">🧑</div>
                  <div className="text-sm mt-1">Tap untuk upload <b>model</b></div>
                  <div className="text-[11px] text-muted-foreground">Foto wajah/tubuh model</div>
                </div>
              </button>
            )}
          </Section>

          {/* Product Upload */}
          <Section title="📦 Foto Produk" sub={`Upload produk (${products.length}/10)`}>
            <input ref={productRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleProductUpload(e.target.files)} />
            {products.length === 0 ? (
              <button
                onClick={() => productRef.current?.click()}
                className="w-full aspect-[4/3] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4"
              >
                <div>
                  <div className="text-3xl">📦</div>
                  <div className="text-sm mt-1">Tap atau tarik <b>foto produk</b></div>
                  <div className="text-[11px] text-muted-foreground">Max 10 file</div>
                </div>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {products.slice(0, 8).map((p) => (
                    <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeProduct(p.id)}
                        className="absolute top-1 right-1 h-5 w-5 grid place-items-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {products.length > 8 && <div className="text-[11px] text-muted-foreground text-center">+{products.length - 8} lainnya</div>}
                {products.length < 10 && (
                  <button onClick={() => productRef.current?.click()} className="w-full py-2 rounded-lg border border-dashed border-border/80 text-sm text-muted-foreground hover:border-primary/60 transition">
                    <Plus className="h-4 w-4 inline mr-1" /> Tambah Produk
                  </button>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Right: Settings + Log */}
        <div className="lg:col-span-2 space-y-5">
          <Section title="⚙️ Pengaturan">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Provider AI</Label>
                <Select value={provider} onChange={(e) => setProvider(e.target.value)} options={[
                  { value: 'weavy', label: 'Weavy (Nano Banana 2)' },
                ]} />
              </div>
              <div>
                <Label>Jenis Produk</Label>
                <Input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Contoh: Tas selempang, Jam tangan, Sepatu sneakers..." />
              </div>
              <div>
                <Label>Model Style</Label>
                <Select value={modelStyle} onChange={(e) => setModelStyle(e.target.value)} options={MODEL_STYLES} />
              </div>
              <div>
                <Label>Background</Label>
                <Input value={background} onChange={(e) => setBackground(e.target.value)} placeholder="Contoh: Cafe aesthetic, Pantai sunset, Kantor modern..." />
              </div>
              <div>
                <Label>Aspek Rasio</Label>
                <Select value={ratio} onChange={(e) => setRatio(e.target.value)} options={RATIOS.map((r) => ({ value: r, label: r }))} />
              </div>
            </div>
            <div className="mt-4">
              <Label>Extra Prompt (opsional)</Label>
              <Textarea rows={2} value={extraPrompt} onChange={(e) => setExtraPrompt(e.target.value)} placeholder="Deskripsi tambahan..." />
            </div>
            <div className="flex items-center gap-3 mt-4">
              {generating ? (
                <button onClick={handleStop} className="inline-flex items-center gap-2 rounded-xl bg-destructive/90 hover:bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium shadow">
                  <Square className="h-4 w-4 fill-current" /> Stop
                </button>
              ) : (
                <Button onClick={handleGenerate} disabled={products.length === 0}>
                  <Rocket className="h-4 w-4" /> Generate ({products.length})
                </Button>
              )}
            </div>
          </Section>

          {/* Status Bar */}
          {status.show && (
            <div className="rounded-xl border border-border/70 bg-card/40 p-3">
              <div className="flex justify-between items-center text-xs mb-1">
                <span>{status.text}</span>
                <span className="font-mono text-muted-foreground">{status.time}</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${status.pct}%`, background: 'var(--gradient-neon)' }} />
              </div>
            </div>
          )}

          {/* Log Panel */}
          <Section title="📋 Log" sub={`${logs.length} entri`}>
            <div className="rounded-xl border border-border/60 bg-black/40 p-2 max-h-48 overflow-y-auto text-[11px] font-mono">
              {logs.length === 0 ? (
                <div className="text-muted-foreground px-1 py-2">Belum ada log. Klik Generate untuk memulai.</div>
              ) : logs.map((log, i) => (
                <div key={i} className={`break-all ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  log.level === 'success' ? 'text-emerald-400' :
                  'text-muted-foreground'
                }`}>
                  [{log.time}] {log.msg}
                </div>
              ))}
            </div>
          </Section>

          {/* Results */}
          {results.length > 0 && (
            <Section title={`🖼️ Hasil UGC (${doneResults.length})`}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {results.map((r) => (
                  <div key={r.id} className="rounded-xl overflow-hidden border border-border bg-black/40">
                    {r.status === 'done' ? (
                      <>
                        <button onClick={() => setPreviewUrl(r.url)} className="block w-full aspect-[4/5] overflow-hidden cursor-zoom-in">
                          <img src={r.url} alt="" className="w-full h-full object-cover" />
                        </button>
                        <div className="p-2 flex justify-between">
                          <button onClick={() => handleDownloadSingle(r.url, `ugc-${Date.now()}.jpg`)} className="text-[11px] text-primary hover:underline">Download</button>
                        </div>
                      </>
                    ) : (
                      <div className="p-3 text-[11px] text-destructive">❌ {r.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 backdrop-blur-sm cursor-zoom-out" onClick={() => setPreviewUrl(null)}>
          <button onClick={(e) => { e.stopPropagation(); setPreviewUrl(null) }} className="absolute top-4 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 text-xs">
            <X className="h-4 w-4" /> Tutup
          </button>
          <img src={previewUrl} alt="Preview" className="w-screen h-screen object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </PageContent>
  )
}
