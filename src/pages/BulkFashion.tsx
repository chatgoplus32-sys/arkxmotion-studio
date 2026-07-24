import { useState, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState } from '@/components/ui'
import { ShoppingBag, Upload, Rocket, Loader2, Trash2, Download, X, Plus, Square } from 'lucide-react'

const PRODUCT_TYPES = ['Atasan', 'Blouse', 'Cardigan', 'Kemeja', 'Jaket', 'Croptop']
const RATIOS = ['1:1', '4:5', '3:4', '9:16', '16:9']

const TEMPLATES = [
  { name: 'Hanya Outfit', body: 'Hanya outfit saja, untuk frame, pose dan background tetap sama' },
  { name: 'Style Wanita Berhijab', body: 'Hanya outfit saja dan sesuaikan untuk style wanita berhijab, untuk frame, pose dan background tetap sama' },
  { name: 'Detail Atasan', body: 'Hanya atasan saja ikuti detail, ukuran, kerah leher, kerah tangan, kancing baju atasan image reference 2. Untuk frame, pose dan background tetap sama' },
]

export default function BulkFashionPage() {
  const [charUrl, setCharUrl] = useState<string | null>(null)
  const [charFile, setCharFile] = useState<File | null>(null)
  const [outfitUrls, setOutfitUrls] = useState<string[]>([])
  const [outfitFiles, setOutfitFiles] = useState<File[]>([])
  const [results, setResults] = useState<Array<{ url: string; status: 'done' | 'error'; error?: string }>>([])
  const [productType, setProductType] = useState(PRODUCT_TYPES[0])
  const [ratio, setRatio] = useState('9:16')
  const [tplIdx, setTplIdx] = useState(0)
  const [status, setStatus] = useState({ show: false, text: '', pct: 0, time: '0:00' })
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const charRef = useRef<HTMLInputElement>(null)
  const outfitRef = useRef<HTMLInputElement>(null)

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
    setOutfitFiles([...outfitFiles, ...newFiles])
    setOutfitUrls([...outfitUrls, ...newUrls])
  }

  const removeOutfit = (index: number) => {
    setOutfitFiles(outfitFiles.filter((_, i) => i !== index))
    setOutfitUrls(outfitUrls.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (!charFile || outfitFiles.length === 0) return
    setGenerating(true)
    setResults([])
    setStatus({ show: true, text: `Memproses ${outfitFiles.length} outfit…`, pct: 5, time: '0:00' })

    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setStatus((s) => ({
        ...s,
        time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
      }))
    }, 1000)

    for (let i = 0; i < outfitFiles.length; i++) {
      setStatus((s) => ({ ...s, text: `#${i + 1}: processing`, pct: Math.min(95, ((i + 1) / outfitFiles.length) * 100) }))
      await new Promise((r) => setTimeout(r, 1500))
      setResults((prev) => [...prev, { url: 'https://placehold.co/400x600', status: 'done' }])
    }

    clearInterval(timer)
    setStatus((s) => ({ ...s, pct: 100, text: `✅ Selesai — ${outfitFiles.length}/${outfitFiles.length} sukses` }))
    setGenerating(false)
  }

  const promptPreview = TEMPLATES[tplIdx]?.body
    .replaceAll('{product_type}', productType)
    .replaceAll('{outfit_index}', 'N') || ''

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
            <Label>Template Prompt</Label>
            <Select
              value={String(tplIdx)}
              onChange={(e) => setTplIdx(Number(e.target.value))}
              options={TEMPLATES.map((t, i) => ({ value: String(i), label: t.name }))}
            />
          </div>
          <div>
            <Label>Preview Prompt</Label>
            <Textarea rows={3} readOnly value={promptPreview} className="opacity-85" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          {generating ? (
            <button
              onClick={() => setGenerating(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-destructive/90 hover:bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium shadow"
            >
              <Square className="h-4 w-4 fill-current" /> Stop Generate
            </button>
          ) : (
            <Button onClick={handleGenerate} disabled={!charFile || outfitFiles.length === 0}>
              <Rocket className="h-4 w-4" /> Generate
            </Button>
          )}
        </div>

        {status.show && (
          <div className="mt-4 rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex justify-between items-center text-xs mb-1">
              <span>{status.text}</span>
              <span className="font-mono text-muted-foreground">{status.time}</span>
            </div>
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div
                className="h-full transition-all bg-primary"
                style={{ width: `${status.pct}%` }}
              />
            </div>
          </div>
        )}
      </Section>

      {/* Results */}
      <Section
        title={`👗 Hasil Bulk Fashion (${results.filter((r) => r.status === 'done').length})`}
        right={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setResults([])}
              disabled={results.length === 0}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Hapus All</span>
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
            {results.map((result, index) => (
              <div key={index} className="rounded-xl overflow-hidden border border-border bg-black/40">
                {result.status === 'done' ? (
                  <>
                    <button
                      onClick={() => setPreviewUrl(result.url)}
                      className="block w-full aspect-[3/4] overflow-hidden cursor-zoom-in"
                    >
                      <img src={result.url} alt="" className="w-full h-full object-cover" />
                    </button>
                    <div className="p-2 flex justify-between">
                      <a href={result.url} download className="text-[11px] text-primary hover:underline">Download</a>
                      <button
                        onClick={() => setResults(results.filter((_, i) => i !== index))}
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
            ))}
          </div>
        )}
      </Section>

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
