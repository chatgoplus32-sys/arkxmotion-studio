import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Input } from '@/components/ui'
import { useBulkFashionStore } from '@/stores/bulkFashionStore'
import {
  BULK_FASHION_PROVIDERS,
  calculateBulkCost,
  generateBulkFashion,
} from '@/lib/bulk-fashion'
import { downloadFilesAsZip, getExtensionFromUrl } from '@/lib/download-zip'
import {
  ShoppingBag,
  Upload,
  Rocket,
  Trash2,
  Download,
  X,
  Plus,
  Square,
  Check,
  Repeat,
  Zap,
} from 'lucide-react'

const PRODUCT_TYPES = ['Atasan', 'Blouse', 'Cardigan', 'Kemeja', 'Jaket', 'Croptop']
const RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9']

const DEFAULT_TEMPLATES = [
  { name: 'Hanya Outfit', body: 'Hanya outfit saja, untuk frame, pose dan background tetap sama' },
  { name: 'Style Wanita Berhijab', body: 'Hanya outfit saja dan sesuaikan untuk style wanita berhijab, untuk frame, pose dan background tetap sama' },
  { name: 'Detail Atasan', body: 'Hanya atasan saja ikuti detail, ukuran, kerah leher, kerah tangan, kancing baju atasan image reference 2. Untuk frame, pose dan background tetap sama' },
]

const ROUTING_KEY = 'arkxmotion.routing'

function getRouting(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ROUTING_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function setRoutingValue(cap: string, providerId: string) {
  const routing = getRouting()
  routing[cap] = providerId
  localStorage.setItem(ROUTING_KEY, JSON.stringify(routing))
  window.dispatchEvent(new Event('aatools:routing-changed'))
}

function getActiveProviderForCap(cap: string): string {
  const routing = getRouting()
  return routing[cap] || 'weavy'
}

function aspectToClass(ratio: string): string {
  const map: Record<string, string> = {
    '9:16': 'aspect-[9/16]', '16:9': 'aspect-[16/9]',
    '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '1:1': 'aspect-square',
  }
  return map[ratio] || 'aspect-[3/4]'
}

// ─── Template Manager Dialog ───────────────────────────────────────────────
function TemplateDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string, body: string) => void }) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="neumorph w-full max-w-lg p-5 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" /> Tutup
        </button>
        <div className="font-display text-lg mb-3">+ Tambah Template Prompt</div>
        <Label className="text-xs">Nama Template</Label>
        <Input placeholder="Mis. Studio Katalog" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="h-3" />
        <Label className="text-xs">Isi Prompt</Label>
        <Textarea rows={5} placeholder="Placeholder: {product_type}, {outfit_index}" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => { if (name && body) { onSave(name, body); onClose() } }} disabled={!name || !body}>
            Simpan
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Routing Dialog ────────────────────────────────────────────────────────
function RoutingDialog({ cap, onClose }: { cap: string; onClose: () => void }) {
  const [active, setActive] = useState(() => getActiveProviderForCap(cap))

  const handleSelect = (providerId: string) => {
    setActive(providerId)
    setRoutingValue(cap, providerId)
  }

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border/60 bg-card/95 backdrop-blur p-4">
          <div className="h-10 w-10 rounded-xl grid place-items-center text-primary-foreground shrink-0" style={{ background: 'var(--gradient-neon)' }}>
            <Repeat className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Routing Provider</div>
            <div className="font-display text-lg text-foreground">Bulk Fashion</div>
            <div className="text-xs text-muted-foreground mt-0.5">Pilih provider untuk generate gambar fashion</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full border border-border hover:bg-sidebar-accent/30" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2.5">
          {BULK_FASHION_PROVIDERS.map((provider) => {
            const isActive = active === provider.id
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => handleSelect(provider.id)}
                className={`text-left rounded-xl border p-3 transition ${
                  isActive
                    ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                    : 'border-border bg-card/40 hover:border-primary/50 hover:bg-card/70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="font-display text-sm text-foreground flex-1 truncate">{provider.name}</div>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-primary">
                      <Check className="h-3 w-3" /> aktif
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-0.5">
                  {provider.models.slice(0, 4).map((model) => (
                    <div key={model.key} className="flex items-start gap-2 text-[11px]">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      <span className="text-foreground/80 flex-1 truncate">{model.label}</span>
                      <span className="font-mono text-emerald-300/90 text-[10px] whitespace-nowrap">
                        ~{model.qualities[0]?.cr ?? 0} cr
                      </span>
                    </div>
                  ))}
                  {provider.models.length > 4 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">+{provider.models.length - 4} model lainnya</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="sticky bottom-0 border-t border-border/60 bg-card/95 backdrop-blur p-3 flex items-center justify-end">
          <button onClick={onClose} className="rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground" style={{ background: 'var(--gradient-neon)' }}>
            Selesai
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function BulkFashionPage() {
  const navigate = useNavigate()
  const store = useBulkFashionStore()
  const {
    charUrl, charFile, outfitUrls, outfitFiles, results,
    productType, ratio, model, quality, tplIdx, status, generating,
    setCharUrl, setCharFile, addOutfits, removeOutfit,
    setProductType, setRatio, setProvider, setModel, setQuality,
    setTplIdx, setStatus, setGenerating, addResult, clearResults, removeResult,
  } = store

  const [templates, setTemplates] = useState(() => {
    try {
      const raw = localStorage.getItem('arkxmotion.bf.templates')
      const saved = raw ? JSON.parse(raw) : []
      return [...DEFAULT_TEMPLATES, ...(Array.isArray(saved) ? saved : [])]
    } catch { return [...DEFAULT_TEMPLATES] }
  })
  const [showTplDialog, setShowTplDialog] = useState(false)
  const [showRoutingDialog, setShowRoutingDialog] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const charRef = useRef<HTMLInputElement>(null)
  const outfitRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ─── Routing state ──────────────────────────────────────────────────────
  const [activeProvider, setActiveProvider] = useState(() => getActiveProviderForCap('bulk-fashion'))

  useEffect(() => {
    const handler = () => setActiveProvider(getActiveProviderForCap('bulk-fashion'))
    window.addEventListener('aatools:routing-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('aatools:routing-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  // ─── Provider / Model / Quality resolution ──────────────────────────────
  const providerConfig = useMemo(() => BULK_FASHION_PROVIDERS.find((p) => p.id === activeProvider) || BULK_FASHION_PROVIDERS[0], [activeProvider])
  const models = providerConfig.models
  const currentModel = useMemo(() => models.find((m) => m.key === model) || models[0], [models, model])
  const qualities = currentModel?.qualities || []
  const costInfo = useMemo(() => calculateBulkCost(activeProvider, model, quality, outfitFiles.length), [activeProvider, model, quality, outfitFiles.length])

  // Sync provider/model/quality when routing changes
  useEffect(() => {
    setProvider(activeProvider)
    if (!models.find((m) => m.key === model)) {
      const first = models[0]
      setModel(first?.key || '')
      const def = first?.qualities.find((q) => q.default) || first?.qualities[0]
      setQuality(def?.v || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, models])

  // ─── File handlers ──────────────────────────────────────────────────────
  const handleCharUpload = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setCharUrl(URL.createObjectURL(file))
      setCharFile(file)
    }
  }

  const handleOutfitUpload = (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files).slice(0, 50 - outfitFiles.length)
    const newUrls = newFiles.map((f) => URL.createObjectURL(f))
    addOutfits(newUrls, newFiles)
  }

  // ─── Generate ───────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!charFile || outfitFiles.length === 0) return
    setGenerating(true)
    clearResults()
    setStatus({ show: true, text: `Memproses ${outfitFiles.length} outfit…`, pct: 5, time: '0:00' })

    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setStatus({ time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` })
    }, 1000)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const resultUrls = await generateBulkFashion({
        provider: activeProvider,
        modelKey: model,
        quality: quality,
        ratio,
        charFile,
        outfitFiles,
        promptTemplate: templates[tplIdx]?.body || '',
        productType,
        signal: controller.signal,
        onProgress: (idx, statusText, resultUrl, error) => {
          if (resultUrl) {
            addResult({ url: resultUrl, status: 'done' })
          } else if (error) {
            addResult({ url: '', status: 'error', error })
          }
          setStatus({
            text: error ? `#${idx + 1}: error — ${error}` : `#${idx + 1}: ${statusText}`,
            pct: Math.min(95, ((idx + 1) / outfitFiles.length) * 100),
          })
        },
      })

      if (!controller.signal.aborted) {
        setStatus({
          pct: 100,
          text: `✅ Selesai — ${resultUrls.length}/${outfitFiles.length} sukses`,
        })
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setStatus({ pct: 100, text: `❌ ${err.message || String(err)}` })
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
    setStatus({ text: '⏹️ Dihentikan oleh user', pct: 100 })
  }

  // ─── Template handlers ──────────────────────────────────────────────────
  const handleSaveTemplate = (name: string, body: string) => {
    const newTemplates = [...templates, { name, body }]
    setTemplates(newTemplates)
    localStorage.setItem('arkxmotion.bf.templates', JSON.stringify(newTemplates.slice(DEFAULT_TEMPLATES.length)))
    setTplIdx(newTemplates.length - 1)
  }

  const handleDeleteTemplate = () => {
    if (templates.length <= DEFAULT_TEMPLATES.length) return
    const customPart = templates.slice(DEFAULT_TEMPLATES.length)
    const idx = tplIdx - DEFAULT_TEMPLATES.length
    if (idx < 0 || idx >= customPart.length) return
    const newCustom = customPart.filter((_, i) => i !== idx)
    const newAll = [...DEFAULT_TEMPLATES, ...newCustom]
    setTemplates(newAll)
    localStorage.setItem('arkxmotion.bf.templates', JSON.stringify(newCustom))
    setTplIdx(0)
  }

  // ─── Selection / batch ──────────────────────────────────────────────────
  const doneResults = useMemo(() => results.filter((r) => r.status === 'done' && r.url), [results])
  const allSelected = doneResults.length > 0 && selectedIds.length === doneResults.length

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : doneResults.map((_, i) => String(i)))
  }

  // ─── Download ZIP ───────────────────────────────────────────────────────
  const handleDownloadZip = async () => {
    if (doneResults.length === 0) return
    try {
      await downloadFilesAsZip(
        doneResults.map((r, i) => ({
          url: r.url,
          filename: `outfit_${String(i + 1).padStart(3, '0')}.${getExtensionFromUrl(r.url)}`,
        })),
        `bulk-fashion-${Date.now()}.zip`
      )
    } catch (err: any) {
      setStatus({ text: `❌ ZIP error: ${err.message}`, pct: 100 })
    }
  }

  // ─── Upscale handoff ────────────────────────────────────────────────────
  const handleUpscaleHandoff = () => {
    const selected = doneResults.filter((_, i) => selectedIds.includes(String(i)))
    if (selected.length === 0) return
    try {
      sessionStorage.setItem('upscaler:handoff', JSON.stringify(selected.map((r) => ({ url: r.url }))))
      navigate('/generate/upscaler')
    } catch {}
  }

  const promptPreview = useMemo(() => {
    return (templates[tplIdx]?.body || '')
      .replaceAll('{product_type}', productType)
      .replaceAll('{outfit_index}', 'N')
  }, [templates, tplIdx, productType])

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Bulk Fashion"
        highlight="Generator"
        desc="1 karakter + banyak outfit → generate parallel → download ZIP."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Character Photo */}
        <Section title="🧍 Foto Karakter" sub="1 file (JPG/PNG/WEBP/HEIC)">
          <input ref={charRef} type="file" accept="image/*" hidden onChange={(e) => handleCharUpload(e.target.files)} />
          {charUrl ? (
            <div className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-border">
              <img src={charUrl} alt="karakter" className="w-full h-full object-cover" />
              <button
                onClick={() => charRef.current?.click()}
                className="absolute top-2 right-2 rounded-full px-2 md:px-2.5 py-1 text-xs bg-black/60 text-white flex items-center gap-1"
              >
                <Upload className="h-3 w-3" />
                <span className="hidden md:inline">Ganti</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => charRef.current?.click()}
              className="w-full aspect-[9/16] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4"
            >
              <div>
                <div className="text-3xl">🧍</div>
                <div className="text-sm mt-1">Tap atau tarik <b>foto karakter</b></div>
                <div className="text-[11px] text-muted-foreground">JPG / PNG / WEBP / HEIC</div>
              </div>
            </button>
          )}
        </Section>

        {/* Outfit Photos */}
        <div className="lg:col-span-2">
          <Section
            title={`👚 Outfit Produk ${outfitUrls.length ? `(${outfitUrls.length}/50)` : ''}`}
            sub="max 50 — multi file"
            right={
              outfitUrls.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => outfitRef.current?.click()}>
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </Button>
              ) : undefined
            }
          >
            <input ref={outfitRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleOutfitUpload(e.target.files)} />
            {outfitUrls.length === 0 ? (
              <button
                onClick={() => outfitRef.current?.click()}
                className="w-full aspect-[4/3] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4"
              >
                <div>
                  <div className="text-3xl">👚</div>
                  <div className="text-sm mt-1">Tap atau tarik <b>foto outfit</b> (max 50)</div>
                  <div className="text-[11px] text-muted-foreground">JPG / PNG / WEBP / HEIC — multi-file</div>
                </div>
              </button>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {outfitUrls.map((url, index) => (
                  <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeOutfit(index)}
                      title="Hapus outfit"
                      className="absolute top-1 right-1 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" /> Hapus
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1">
                      #{index + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Settings */}
      <Section title="⚙️ Pengaturan">
        {/* Model AI + Routing Dialog */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 min-h-[20px] mb-1.5">
            <label className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Model AI</label>
            <button
              type="button"
              onClick={() => setShowRoutingDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 hover:bg-primary/20 hover:border-primary/70 transition px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-primary cursor-pointer"
              title={`Klik untuk ubah provider ${providerConfig.name}`}
            >
              <Repeat className="h-3 w-3" />
              <span className="normal-case tracking-normal text-foreground/90">Provider aktif:</span>
              <b className="text-primary normal-case tracking-normal">{providerConfig.name}</b>
              <Zap className="h-3 w-3 text-primary" />
            </button>
          </div>
          <Select
            value={model}
            onChange={(e) => {
              const val = e.target.value
              setModel(val)
              const m = models.find((m) => m.key === val)
              const def = m?.qualities.find((q) => q.default) || m?.qualities[0]
              setQuality(def?.v || '')
            }}
            options={models.map((m) => ({ value: m.key, label: m.label }))}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <Label>Jenis Produk</Label>
            <Select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              options={PRODUCT_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div>
            <Label>Aspek Rasio</Label>
            <Select
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              options={RATIOS.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <div>
            <Label>Kualitas</Label>
            <Select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              options={qualities.map((q) => ({ value: q.v, label: q.label }))}
            />
          </div>
          <div>
            <Label>Template Prompt</Label>
            <div className="flex gap-2">
              <Select
                value={String(tplIdx)}
                onChange={(e) => setTplIdx(Number(e.target.value))}
                options={templates.map((t, i) => ({ value: String(i), label: t.name }))}
                className="flex-1"
              />
              <Button size="sm" variant="outline" onClick={() => setShowTplDialog(true)}>
                <Plus className="h-3.5 w-3.5" /> Template
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteTemplate}
                className="text-destructive hover:text-destructive"
                title="Hapus template"
                disabled={tplIdx < DEFAULT_TEMPLATES.length}
              >
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </Button>
            </div>
          </div>
          <div className="lg:col-span-2">
            <Label>Preview Prompt</Label>
            <Textarea rows={3} readOnly value={promptPreview} className="opacity-85" />
            <div className="text-[10px] text-muted-foreground mt-1">Placeholder: {'{product_type}'}, {'{outfit_index}'}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {generating ? (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-2 rounded-xl bg-destructive/90 hover:bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium shadow"
            >
              <Square className="h-4 w-4 fill-current" /> Stop Generate
            </button>
          ) : (
            <Button onClick={handleGenerate} disabled={!charFile || outfitFiles.length === 0}>
              <Rocket className="h-4 w-4" /> Generate
            </Button>
          )}
          <div className="text-xs text-muted-foreground">
            Cost: <b className="text-foreground font-mono">{costInfo.totalCr}</b> credits ({outfitFiles.length} × {costInfo.crPerImage})
          </div>
        </div>

        {status.show && (
          <div className="mt-4 rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex justify-between items-center text-xs mb-1">
              <span>{status.text}</span>
              <span className="font-mono text-muted-foreground">{status.time}</span>
            </div>
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div
                className="h-full transition-all"
                style={{ width: `${status.pct}%`, background: 'var(--gradient-neon)' }}
              />
            </div>
          </div>
        )}
      </Section>

      {/* Results */}
      <Section
        title={`👗 Hasil Bulk Fashion`}
        sub={`(${doneResults.length})`}
        right={
          <div className="flex flex-wrap gap-2">
            {doneResults.length > 0 && (
              <Button size="sm" variant="outline" onClick={toggleSelectAll}>
                {allSelected ? 'Batal pilih' : 'Pilih semua'}
              </Button>
            )}
            {selectedIds.length > 0 && (
              <Button size="sm" variant="outline" onClick={handleUpscaleHandoff} title="Kirim ke Upscaler">
                Upscale ({selectedIds.length})
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadZip}
              disabled={doneResults.length === 0}
              title="Download semua sebagai ZIP"
            >
              <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Download ZIP</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { clearResults(); setSelectedIds([]) }}
              disabled={results.length === 0}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Hapus All</span>
            </Button>
          </div>
        }
      >
        {results.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" />}
            title="Belum ada hasil"
            description="Generate bulk fashion dari karakter dan outfit"
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {results.map((result, index) => {
              const id = String(index)
              const isSelected = selectedIds.includes(id)
              return (
                <div
                  key={index}
                  className={`relative rounded-xl overflow-hidden border bg-black/40 ${
                    isSelected ? 'border-primary' : 'border-border'
                  }`}
                >
                  {result.status === 'done' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleSelect(id)}
                        title="Pilih untuk di-upscale"
                        className={`absolute z-10 top-2 left-2 h-6 w-6 rounded-md border grid place-items-center transition ${
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-background/70 border-border text-transparent hover:border-primary'
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewUrl(result.url)}
                        className={`block w-full ${aspectToClass(ratio)} overflow-hidden cursor-zoom-in`}
                        title="Klik untuk lihat full screen"
                      >
                        <img src={result.url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <div className="p-2 flex justify-between">
                        <a href={result.url} download className="text-[11px] text-primary hover:underline">Download</a>
                        <button
                          onClick={() => removeResult(index)}
                          className="text-[11px] text-destructive hover:underline"
                        >
                          Hapus
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="p-3 text-[11px] text-destructive">❌ {result.error}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Template Dialog */}
      {showTplDialog && (
        <TemplateDialog onClose={() => setShowTplDialog(false)} onSave={handleSaveTemplate} />
      )}

      {/* Routing Dialog */}
      {showRoutingDialog && (
        <RoutingDialog cap="bulk-fashion" onClose={() => setShowRoutingDialog(false)} />
      )}

      {/* Fullscreen Preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewUrl(null) }}
            className="absolute top-4 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 text-xs"
          >
            <X className="h-4 w-4" /> Tutup
          </button>
          <img src={previewUrl} alt="Preview full" className="w-screen h-screen object-contain" onClick={(e) => e.stopPropagation()} />
          <a
            href={previewUrl}
            download
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow"
          >
            Download
          </a>
        </div>
      )}
    </PageContent>
  )
}
