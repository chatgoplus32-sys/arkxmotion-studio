import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Textarea, Select, Label, EmptyState } from '@/components/ui'
import { Clapperboard, Rocket, Loader2, Download, Trash2, Search, Check, AlertCircle } from 'lucide-react'

const FRAMING_OPTIONS = [
  { value: 'normal', label: 'Normal (full scene + model)' },
  { value: 'no-head', label: 'Tanpa kepala (crop leher ke bawah)' },
  { value: 'product-only', label: 'Zoom produk saja (no human)' },
  { value: 'hands-only', label: 'Hanya tangan memegang produk' },
  { value: 'detail-macro', label: 'Detail macro / close-up produk' },
]

const CTA_OPTIONS = [
  { value: 'tiktok', label: 'TikTok Shop (keranjang kuning)' },
  { value: 'facebook-shopee', label: 'Facebook Ads → Shopee' },
  { value: 'facebook-tokopedia', label: 'Facebook Ads → Tokopedia' },
  { value: 'tokopedia', label: 'Tokopedia' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'instagram', label: 'Instagram (link in bio)' },
  { value: 'whatsapp', label: 'WhatsApp (chat admin)' },
  { value: 'custom', label: 'Custom (tulis sendiri)' },
]

interface ProductRow {
  id: string
  url: string
  info: any | null
  selectedImages: string[]
  status: 'idle' | 'loading' | 'ok' | 'err'
  error: string
}

interface StoryboardResult {
  id: string
  title: string
  status: 'pending' | 'brain' | 'image' | 'done' | 'err'
  prompt?: string
  imgUrl?: string
  error?: string
}

export default function StoryboardPage() {
  const [rows, setRows] = useState<ProductRow[]>([{
    id: 'r' + Math.random().toString(36).slice(2, 8),
    url: '',
    info: null,
    selectedImages: [],
    status: 'idle',
    error: '',
  }])
  const [sceneCount, setSceneCount] = useState('6')
  const [ratio, setRatio] = useState('9:16')
  const [framing, setFraming] = useState('normal')
  const [ctaTarget, setCtaTarget] = useState('tiktok')
  const [ctaCustom, setCtaCustom] = useState('')
  const [prompt, setPrompt] = useState('')
  const [results, setResults] = useState<StoryboardResult[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const addRow = () => {
    setRows([...rows, {
      id: 'r' + Math.random().toString(36).slice(2, 8),
      url: '',
      info: null,
      selectedImages: [],
      status: 'idle',
      error: '',
    }])
  }

  const removeRow = (id: string) => {
    if (rows.length > 1) {
      setRows(rows.filter((r) => r.id !== id))
    }
  }

  const updateRow = (id: string, updates: Partial<ProductRow>) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...updates } : r)))
  }

  const handleScrape = async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row?.url.trim()) return

    updateRow(id, { status: 'loading', error: '' })
    await new Promise((r) => setTimeout(r, 2000))

    updateRow(id, {
      status: 'ok',
      info: {
        title: 'Sample Product',
        description: 'This is a sample product description.',
        images: [],
      },
      selectedImages: [],
    })
  }

  const handleGenerate = async () => {
    const validRows = rows.filter((r) => r.status === 'ok' && r.info)
    if (validRows.length === 0) return

    setBusy(true)
    setResults([])
    setLogs([])

    addLog(`🚀 Mulai generate ${validRows.length} storyboard`)

    for (const row of validRows) {
      const resultId = `${row.id}_${Date.now()}`
      setResults((prev) => [...prev, {
        id: resultId,
        title: row.info?.title || '(tanpa judul)',
        status: 'brain',
      }])

      addLog(`🧠 [${row.info?.title}] Brain menyusun prompt storyboard…`)
      await new Promise((r) => setTimeout(r, 1500))

      setResults((prev) => prev.map((r) => r.id === resultId ? { ...r, status: 'image', prompt: 'Generated storyboard prompt...' } : r))
      addLog(`🎨 [${row.info?.title}] Generate gambar…`)
      await new Promise((r) => setTimeout(r, 2000))

      setResults((prev) => prev.map((r) => r.id === resultId ? { ...r, status: 'done', imgUrl: 'https://placehold.co/400x600' } : r))
      addLog(`✅ [${row.info?.title}] Storyboard selesai`)
    }

    addLog('🏁 Semua produk selesai diproses')
    setBusy(false)
  }

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 200))
  }

  const validRows = rows.filter((r) => r.status === 'ok' && r.info).length

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Produk"
        highlight="Storyboard"
        desc="Link produk → scrape info → ChatGPT brain → 1 gambar grid storyboard."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Product Links */}
        <div className="lg:col-span-2 order-1 lg:order-none">
          <Section
            title={`Link Produk (${rows.length}/12)`}
            sub="Tempel URL e-commerce, klik scrape, pilih hingga 6 gambar per produk"
            right={
              <div className="flex gap-2 shrink-0">
                <Button size="icon" variant="outline" onClick={addRow} title="Tambah link produk">
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setRows([{
                    id: 'r' + Math.random().toString(36).slice(2, 8),
                    url: '',
                    info: null,
                    selectedImages: [],
                    status: 'idle',
                    error: '',
                  }])}
                  className="text-destructive hover:text-destructive"
                  title="Hapus semua"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            }
          >
            <div className="grid gap-3">
              {rows.map((row, index) => (
                <ProductRowCard
                  key={row.id}
                  index={index}
                  row={row}
                  canRemove={rows.length > 1}
                  onUrl={(url) => updateRow(row.id, { url })}
                  onFetch={() => handleScrape(row.id)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          </Section>
        </div>

        {/* Settings */}
        <div className="flex flex-col gap-5 order-2 lg:order-none lg:row-span-2">
          <Section title="Pengaturan" sub="Konfigurasi storyboard">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Jumlah Panel</Label>
                  <Select
                    value={sceneCount}
                    onChange={(e) => setSceneCount(e.target.value)}
                    options={Array.from({ length: 10 }, (_, i) => ({
                      value: String(i + 1),
                      label: `${i + 1} panel`,
                    }))}
                  />
                </div>
                <div>
                  <Label>Aspek Rasio</Label>
                  <Select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    options={[
                      { value: '1:1', label: '1:1 (Square)' },
                      { value: '4:5', label: '4:5' },
                      { value: '3:4', label: '3:4' },
                      { value: '9:16', label: '9:16 (Vertical)' },
                      { value: '16:9', label: '16:9 (Horizontal)' },
                    ]}
                  />
                </div>
              </div>

              <div>
                <Label>Framing / Pengambilan Gambar</Label>
                <Select
                  value={framing}
                  onChange={(e) => setFraming(e.target.value)}
                  options={FRAMING_OPTIONS}
                />
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  Pilih "Tanpa kepala" / "Zoom produk" agar aman untuk model Image-to-Video.
                </p>
              </div>

              <div>
                <Label>CTA / Target Marketplace</Label>
                <Select
                  value={ctaTarget}
                  onChange={(e) => setCtaTarget(e.target.value)}
                  options={CTA_OPTIONS}
                />
                {ctaTarget === 'custom' && (
                  <Input
                    className="mt-2"
                    placeholder="Contoh: klik link Lazada di bio…"
                    value={ctaCustom}
                    onChange={(e) => setCtaCustom(e.target.value)}
                  />
                )}
              </div>

              <div>
                <Label>Prompt Tambahan (opsional)</Label>
                <Textarea
                  rows={3}
                  placeholder="Detail tambahan yang diinginkan..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

              <Button onClick={handleGenerate} disabled={validRows === 0 || busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sedang generate…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Generate Storyboard
                  </>
                )}
              </Button>
            </div>
          </Section>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 order-3 lg:order-none">
          <Section
            title={`Hasil Storyboard${results.length ? ` (${results.filter((r) => r.status === 'done').length}/${results.length})` : ''}`}
            right={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setResults([]); setLogs([]) }}
                  disabled={results.length === 0}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Hapus All</span>
                </Button>
              </div>
            }
          >
            {logs.length > 0 && (
              <div className="mb-4 rounded-xl border border-border/70 bg-black/40 p-3 max-h-40 overflow-y-auto overflow-x-hidden font-mono text-[10px] leading-relaxed text-muted-foreground min-w-0">
                {logs.map((log, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all min-w-0">{log}</div>
                ))}
              </div>
            )}

            {results.length === 0 ? (
              <EmptyState
                icon={<Clapperboard className="h-8 w-8" />}
                title="Belum ada storyboard"
                description="Generate storyboard dari link produk"
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {results.map((result) => (
                  <div key={result.id} className="rounded-2xl border border-border/70 bg-card/30 p-2.5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground truncate flex-1">
                        {result.title}
                      </span>
                      {result.status === 'brain' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> brain
                        </span>
                      )}
                      {result.status === 'image' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> image
                        </span>
                      )}
                      {result.status === 'done' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                          <Check className="h-3 w-3" /> done
                        </span>
                      )}
                      {result.status === 'err' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                          <AlertCircle className="h-3 w-3" /> error
                        </span>
                      )}
                    </div>
                    <div className="w-full overflow-hidden rounded-xl bg-black/40 grid place-items-center aspect-[9/16]">
                      {result.imgUrl ? (
                        <img src={result.imgUrl} alt={result.title} className="max-h-full max-w-full object-contain" />
                      ) : result.status === 'err' ? (
                        <div className="text-[11px] text-destructive p-3 text-center">{result.error}</div>
                      ) : (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {result.imgUrl && result.status === 'done' && (
                      <div className="flex gap-2">
                        <a
                          href={result.imgUrl}
                          download={`storyboard-${result.id}.png`}
                          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card/50 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}

function Plus(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  )
}

function ProductRowCard({
  index,
  row,
  canRemove,
  onUrl,
  onFetch,
  onRemove,
}: {
  index: number
  row: ProductRow
  canRemove: boolean
  onUrl: (url: string) => void
  onFetch: () => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/30 p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          #{index + 1}
        </span>
        {row.status === 'ok' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
            <Check className="h-3 w-3" /> OK
          </span>
        )}
        {row.status === 'err' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title={row.error}>
            <AlertCircle className="h-3 w-3" /> error
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={onFetch}
          disabled={row.status === 'loading'}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-50 bg-primary"
        >
          {row.status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Scrape
        </button>
        <button
          onClick={onRemove}
          disabled={!canRemove}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/50 transition disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Hapus</span>
        </button>
      </div>

      <input
        type="url"
        value={row.url}
        onChange={(e) => onUrl(e.target.value)}
        placeholder="https://..."
        className="w-full rounded-xl border border-border bg-card/50 px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 transition truncate"
      />

      {row.info ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-2.5">
          <div className="text-xs font-semibold text-foreground/95 line-clamp-2">
            {row.info.title || '(tanpa judul)'}
          </div>
          {row.info.description && (
            <div className="text-[11px] text-muted-foreground line-clamp-3 mt-1">
              {row.info.description}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground text-center py-2">
          Belum di-scrape
        </div>
      )}
    </div>
  )
}
