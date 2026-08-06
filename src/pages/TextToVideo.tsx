import { useState, useMemo, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Badge, Label } from '@/components/ui'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { Image, Loader2, Settings2, AlertCircle, ExternalLink, Download, Trash2 } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { runLeonardoImage } from '@/lib/leonardo'
import { runWeavyImage } from '@/lib/weavy'
import { submitRoboneoImage, pollRoboneoImage, checkRoboneoBalance } from '@/lib/roboneo'

interface ImageSize {
  id: string
  label: string
  width: number
  height: number
}

interface ImageModel {
  id: string
  apiId: string
  label: string
  provider: ProviderId
  group: string
  aspectRatios: string[]
  sizes: ImageSize[]
  cr: number
  supportsNegativePrompt: boolean
  qualityOptions?: string[]
  promptEnhance?: boolean
  numImages?: boolean
  sizeShorts?: Record<string, number>
}

const PROVIDER_MODELS: Record<string, ImageModel[]> = {
  weavy: [],
  leonardo: [
    {
      id: 'gpt-image-2',
      apiId: '1cd0d6c4-8381-4b1f-a5d3-1eb1c5b06d80',
      label: 'GPT Image 2',
      provider: 'leonardo',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16', '2:3', '3:2'],
      sizes: [
        { id: 'small', label: 'Small', width: 1024, height: 1024 },
        { id: 'medium', label: 'Medium', width: 1536, height: 1536 },
        { id: 'large', label: 'Large', width: 2048, height: 2048 },
      ],
      cr: 8,
      supportsNegativePrompt: false,
      qualityOptions: ['low', 'medium', 'high'],
      promptEnhance: false,
      numImages: true,
      sizeShorts: { small: 768, medium: 1136, large: 2016 },
    },
    {
      id: 'nano-banana-2',
      apiId: '6bef0ed8-10fd-4f76-8c9a-9c8ca9e9c0e5',
      label: 'Nano Banana 2',
      provider: 'leonardo',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16', '2:3', '3:2'],
      sizes: [
        { id: 'small', label: 'Small', width: 1024, height: 1024 },
        { id: 'medium', label: 'Medium', width: 1536, height: 1536 },
        { id: 'large', label: 'Large', width: 2048, height: 2048 },
      ],
      cr: 4,
      supportsNegativePrompt: true,
      promptEnhance: true,
      numImages: true,
      sizeShorts: { small: 768, medium: 1536, large: 3072 },
    },
    {
      id: 'seedream-5.0-pro',
      apiId: 'de0988af-b808-454d-a63d-29bc76d3520f',
      label: 'Seedream 5.0 Pro',
      provider: 'leonardo',
      group: 'Other',
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'],
      sizes: [
        { id: 'small', label: 'Small', width: 848, height: 1280 },
        { id: 'medium', label: 'Medium', width: 1088, height: 1632 },
        { id: 'large', label: 'Large', width: 1280, height: 1920 },
      ],
      cr: 6,
      supportsNegativePrompt: true,
      promptEnhance: true,
      numImages: true,
      sizeShorts: { small: 768, medium: 976, large: 1152 },
    },
    {
      id: 'flux-pro-2.0',
      apiId: '8baa439b-4e48-4bd4-8d18-7e8f4b51bf91',
      label: 'Flux.2 Pro',
      provider: 'leonardo',
      group: 'Other',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [
        { id: 'small', label: 'Small', width: 1024, height: 1024 },
      ],
      cr: 5,
      supportsNegativePrompt: true,
      promptEnhance: true,
      numImages: true,
      sizeShorts: { small: 816 },
    },
  ],
  wavespeed: [
    {
      id: 'ws:nano-banana-2',
      apiId: 'nano-banana-2',
      label: 'Nano Banana 2',
      provider: 'wavespeed',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 3,
      supportsNegativePrompt: true,
    },
    {
      id: 'ws:gpt-image-2',
      apiId: 'gpt-image-2',
      label: 'GPT Image 2',
      provider: 'wavespeed',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 7,
      supportsNegativePrompt: false,
    },
  ],
  framia: [
    {
      id: 'fr:nano-banana-2',
      apiId: 'nano-banana-2',
      label: 'Nano Banana 2',
      provider: 'framia',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 3,
      supportsNegativePrompt: true,
    },
    {
      id: 'fr:gpt-image-2',
      apiId: 'gpt-image-2',
      label: 'GPT Image 2',
      provider: 'framia',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 7,
      supportsNegativePrompt: false,
    },
  ],
  roboneo: [
    {
      id: 'rn:nano-banana-2',
      apiId: 'gemini-nano-banana-2',
      label: 'Gemini Nano Banana 2',
      provider: 'roboneo',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 4,
      supportsNegativePrompt: true,
    },
    {
      id: 'rn:gemini-3.1',
      apiId: 'gemini-3-1-image',
      label: 'Gemini 3.1',
      provider: 'roboneo',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 5,
      supportsNegativePrompt: true,
    },
    {
      id: 'rn:flux-kontext',
      apiId: 'flux-kontext-image',
      label: 'Flux Kontext',
      provider: 'roboneo',
      group: 'Other',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 6,
      supportsNegativePrompt: true,
    },
    {
      id: 'rn:gpt-image-2',
      apiId: 'gpt-image-2',
      label: 'GPT Image 2',
      provider: 'roboneo',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 8,
      supportsNegativePrompt: false,
    },
  ],
  magnific: [
    {
      id: 'magnific-image',
      apiId: 'upscaler',
      label: 'Magnific Image',
      provider: 'magnific',
      group: 'Featured',
      aspectRatios: ['1:1', '16:9', '9:16'],
      sizes: [{ id: '1024', label: '1024×1024', width: 1024, height: 1024 }],
      cr: 10,
      supportsNegativePrompt: false,
    },
  ],
}

const ACTIVE_PROVIDERS: ProviderId[] = ['weavy', 'leonardo', 'wavespeed', 'framia', 'roboneo', 'magnific']

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'success' | 'error'
}

interface GeneratedResult {
  id: string
  url: string
  prompt: string
  model: string
  provider: string
  timestamp: number
}

export default function TextToImagePage() {
  const { keys, routing, fetchMaintenance } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)

  const [provider, setProvider] = useState<ProviderId>(() => {
    const saved = routing['text-to-image']
    return (saved as ProviderId) || 'weavy'
  })
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [sizeId, setSizeId] = useState('small')
  const [quality, setQuality] = useState('medium')
  const [promptEnhance, setPromptEnhance] = useState('OFF')
  const [numImages, setNumImages] = useState('1')
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState({ show: false, text: '', pct: 0 })
  const [results, setResults] = useState<GeneratedResult[]>([])
  const abortRef = useRef(false)

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  const availableModels = useMemo(() => PROVIDER_MODELS[provider] || [], [provider])

  const selectedModel = useMemo(() => {
    return availableModels.find(m => m.id === modelId) || availableModels[0]
  }, [availableModels, modelId])

  const hasKey = keys[provider]?.some(k => k.status !== 'invalid' && k.status !== 'expired')

  // Auto-select first model when provider changes
  useMemo(() => {
    if (availableModels.length > 0 && !availableModels.find(m => m.id === modelId)) {
      setModelId(availableModels[0].id)
    }
  }, [availableModels, modelId])

  // Auto-adjust aspect ratio and size when model changes
  useMemo(() => {
    if (selectedModel) {
      if (!selectedModel.aspectRatios.includes(aspectRatio)) {
        setAspectRatio(selectedModel.aspectRatios[0])
      }
      if (!selectedModel.sizes.find(s => s.id === sizeId)) {
        setSizeId(selectedModel.sizes[0].id)
      }
    }
  }, [selectedModel, aspectRatio, sizeId])

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [{ time, msg, level }, ...prev].slice(0, 50))
  }

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModel || !hasKey) return
    abortRef.current = false
    setLoading(true)
    setProgress({ show: true, text: 'Starting…', pct: 5 })
    setLogs([])

    const onProgress = (text: string, pct?: number) => {
      addLog(text)
      setProgress(prev => ({ ...prev, text, pct: pct ?? prev.pct }))
    }

    try {
      let imageUrl: string

      if (provider === 'leonardo') {
        addLog(`Leonardo: submit ${selectedModel.label}…`)
        imageUrl = await runLeonardoImage({
          modelId: selectedModel.apiId,
          prompt: prompt.trim(),
          aspectRatio,
          sizeId,
          sizeShort: selectedModel.sizeShorts?.[sizeId],
          negativePrompt: negativePrompt.trim() || undefined,
          quality: selectedModel.qualityOptions ? quality : undefined,
          promptEnhance: selectedModel.promptEnhance ? promptEnhance : undefined,
          numImages: Number(numImages) || 1,
          onProgress,
        })
      } else if (provider === 'weavy') {
        addLog(`Weavy: submit ${selectedModel.label}…`)
        imageUrl = await runWeavyImage({
          model: selectedModel.apiId,
          prompt: prompt.trim(),
          aspectRatio,
          negativePrompt: negativePrompt.trim() || undefined,
          onProgress,
        })
      } else if (provider === 'roboneo') {
        const { keys } = useProviderManager.getState()
        const roboneoKeys = keys.roboneo || []
        const activeKey = roboneoKeys.find((k: any) => k.status === 'active' || k.status === 'unknown')?.key
        if (!activeKey) throw Error('Roboneo: tidak ada token aktif. Tambahkan token di Provider Settings.')

        addLog(`Roboneo: check balance…`)
        const balance = await checkRoboneoBalance(activeKey)
        addLog(`Roboneo balance: ${balance}`)

        addLog(`Roboneo: submit ${selectedModel.label}…`)
        const { taskId, roomId, nodeId } = await submitRoboneoImage({
          accessToken: activeKey,
          prompt: prompt.trim(),
          modelKey: selectedModel.id,
          aspectRatio,
          negativePrompt: negativePrompt.trim() || undefined,
        })
        addLog(`Roboneo task: ${taskId.slice(0, 20)}…`)

        imageUrl = await pollRoboneoImage(activeKey, taskId, roomId, onProgress, 3600000, undefined, nodeId)
      } else {
        throw Error(`Provider "${provider}" belum support text-to-image. Gunakan Weavy atau Leonardo.`)
      }

      if (abortRef.current) return

      const result: GeneratedResult = {
        id: `img-${Date.now()}`,
        url: imageUrl,
        prompt: prompt.trim(),
        model: selectedModel.label,
        provider,
        timestamp: Date.now(),
      }
      setResults(prev => [result, ...prev])
      setProgress({ show: true, text: '✅ Selesai', pct: 100 })
      addLog(`✅ Gambar berhasil dibuat`, 'success')
      addToast('Gambar berhasil dibuat!', 'success')
    } catch (err: any) {
      if (abortRef.current) return
      const errMsg = err.message || 'Unknown error'
      setProgress({ show: true, text: `❌ ${errMsg}`, pct: 100 })
      addLog(`❌ ${errMsg}`, 'error')
      addToast(errMsg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    abortRef.current = true
    setPrompt('')
    setNegativePrompt('')
    setLoading(false)
    setProgress({ show: false, text: '', pct: 0 })
    setLogs([])
  }

  const handleDeleteResult = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id))
  }

  const providerLabel = (p: ProviderId) => {
    const labels: Record<string, string> = {
      weavy: 'Weavy',
      wavespeed: 'Wavespeed',
      leonardo: 'Leonardo',
      framia: 'Framia',
      roboneo: 'Roboneo',
      magnific: 'Magnific',
    }
    return labels[p] || p
  }

  const statusColor = progress.text.startsWith('✅') ? 'text-emerald-400'
    : progress.text.startsWith('❌') ? 'text-destructive'
    : loading ? 'text-amber-300'
    : 'text-muted-foreground'

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Text to"
        highlight="Image"
        desc="Buat gambar dari teks/prompt menggunakan AI. Pilih provider, model, dan pengaturan yang diinginkan."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] mt-4">
        {/* Main Content */}
        <div className="neumorph rounded-xl p-4 space-y-4">
          <div>
            <Label>Prompt (deskripsi gambar yang ingin dibuat)</Label>
            <Textarea
              rows={4}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Contoh: A majestic astronaut floating in deep space with Earth in the background, cinematic lighting, highly detailed, 8k resolution..."
              disabled={loading}
            />
          </div>

          {selectedModel?.supportsNegativePrompt && (
            <div>
              <Label>Negative Prompt (elemen yang ingin dihindari — opsional)</Label>
              <Textarea
                rows={2}
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                placeholder="Contoh: blurry, low quality, distorted, deformed, watermark, text..."
                disabled={loading}
              />
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 min-h-[20px] mb-1.5">
              <label className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Model AI
              </label>
              <Badge>{selectedModel?.group || '—'}</Badge>
            </div>
            <Select
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              disabled={loading}
              options={availableModels.map(m => ({
                value: m.id,
                label: `${m.label} — ${m.cr} cr`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Aspect Ratio</Label>
              <Select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)}
                disabled={loading}
                options={selectedModel?.aspectRatios.map(r => ({ value: r, label: r })) || []}
              />
            </div>
          <div>
            <Label>Size ({selectedModel?.sizes.find(s => s.id === sizeId)?.width || 1024}A-{selectedModel?.sizes.find(s => s.id === sizeId)?.height || 1024})</Label>
            <Select
              value={sizeId}
              onChange={e => setSizeId(e.target.value)}
              disabled={loading}
              options={selectedModel?.sizes.map(s => ({
                value: s.id,
                label: `${s.label} (${s.width} A-${s.height})`,
              })) || []}
            />
          </div>
          </div>

          {selectedModel?.qualityOptions && (
            <div>
              <Label>Quality</Label>
              <Select
                value={quality}
                onChange={e => setQuality(e.target.value)}
                disabled={loading}
                options={selectedModel.qualityOptions.map(q => ({ value: q, label: q.charAt(0).toUpperCase() + q.slice(1) }))}
              />
            </div>
          )}

          {selectedModel?.promptEnhance && (
            <div>
              <Label>Prompt Enhance</Label>
              <Select
                value={promptEnhance}
                onChange={e => setPromptEnhance(e.target.value)}
                disabled={loading}
                options={[
                  { value: 'OFF', label: 'Off' },
                  { value: 'AUTO', label: 'Auto' },
                ]}
              />
            </div>
          )}

          {selectedModel?.numImages && (
            <div>
              <Label>Jumlah gambar</Label>
              <Select
                value={numImages}
                onChange={e => setNumImages(e.target.value)}
                disabled={loading}
                options={[1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }))}
              />
            </div>
          )}

          <div className="flex gap-2 items-center flex-wrap">
            <Button onClick={handleGenerate} disabled={loading || !prompt.trim() || !hasKey}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
              {loading ? 'Generating...' : 'Generate Image'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
            <div className="text-xs text-muted-foreground">
              Cost: <b className="text-foreground font-mono">{selectedModel?.cr || 0} cr</b>
            </div>
            <div className="text-xs text-muted-foreground">
              Token: <b className="text-fuchsia-300">{keys[provider]?.length || 0}</b>
              {' · '}Status: <b className={hasKey ? 'text-emerald-400' : 'text-destructive'}>{hasKey ? 'Ready' : 'No Key'}</b>
            </div>
          </div>

          {!hasKey && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Tambahkan <b>{providerLabel(provider)}</b> key di halaman Providers</span>
            </div>
          )}
        </div>

        {/* Settings Sidebar */}
        <div className="neumorph rounded-xl p-4 space-y-3">
          {progress.show && (
            <div className="rounded-lg border border-border/70 bg-card/40 p-2">
              <div className="flex justify-between items-center text-[11px] mb-1">
                <span className="text-foreground">{progress.text}</span>
              </div>
              <div className="h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${progress.pct}%`,
                    background: 'var(--gradient-neon, linear-gradient(90deg,#22d3ee,#a78bfa))',
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Pengaturan Provider
            </div>
          </div>

          <div>
            <Label>Provider</Label>
            <Select
              value={provider}
              onChange={e => setProvider(e.target.value as ProviderId)}
              disabled={loading}
              options={ACTIVE_PROVIDERS.map(p => ({
                value: p,
                label: providerLabel(p),
              }))}
            />
          </div>

          <MaintenanceBanner providerId={provider} />

          <div className="rounded-lg border border-border bg-black/40 p-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Info Model
            </div>
            <div className="text-xs text-foreground/90">
              <b>{selectedModel?.label || '—'}</b>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              <div>Provider: <span className="text-foreground">{providerLabel(provider)}</span></div>
              <div>Aspect Ratio: <span className="text-foreground">{aspectRatio}</span></div>
              <div>Resolusi: <span className="text-foreground">{selectedModel?.sizes.find(s => s.id === sizeId)?.label || '—'}</span></div>
              <div>Cost: <span className="text-primary font-mono">{selectedModel?.cr || 0} credits</span></div>
            </div>
          </div>

          {/* Log Panel */}
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Log Proses
          </div>
          <div className="rounded-lg border border-border bg-black/40 p-2 h-48 overflow-auto font-mono text-[11px] leading-relaxed">
            {logs.length === 0 ? (
              <div className="text-muted-foreground italic">Belum ada aktivitas.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={
                  log.level === 'success' ? 'text-emerald-400' :
                  log.level === 'error' ? 'text-destructive' :
                  'text-muted-foreground'
                }>
                  {log.time} — {log.msg}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Results Gallery */}
      {results.length > 0 && (
        <Section title={`Hasil Gambar (${results.length})`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map(result => (
              <div key={result.id} className="rounded-lg overflow-hidden border border-border bg-black/40">
                <img
                  src={result.url}
                  alt={result.prompt}
                  className="w-full aspect-square object-contain bg-black"
                  crossOrigin="anonymous"
                />
                <div className="p-2 flex justify-between items-center text-[11px]">
                  <div className="flex gap-2">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" /> Buka
                    </a>
                    <a
                      href={result.url}
                      download
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" /> Unduh
                    </a>
                  </div>
                  <button
                    onClick={() => handleDeleteResult(result.id)}
                    className="text-destructive hover:underline"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="px-2 pb-2 text-[10px] text-muted-foreground truncate">
                  {result.model} · {result.provider}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageContent>
  )
}
