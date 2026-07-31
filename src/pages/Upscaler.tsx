import { useState, useRef, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Badge } from '@/components/ui'
import { Wand2, Loader2, Upload, Trash2, Key, ExternalLink, Download, Image, Settings2, ChevronDown, ChevronUp } from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { submitMagnificUpscale, pollMagnificTask, isMagnificTokenError } from '@/lib/magnific'
import type { MagnificEngine, MagnificOptimizedFor, MagnificFlavor } from '@/lib/magnific'
import {
  addActiveTask,
  removeActiveTask,
  getResults,
  addResult,
  removeResult,
  getLogs,
  addBgLog,
  startBackgroundPolling,
} from '@/lib/backgroundTasks'

interface LogEntry {
  time: string
  msg: string
  level: 'debug' | 'info' | 'warn' | 'error' | 'success'
  provider?: string
}

const SCALE_OPTIONS = [
  { value: '2x', label: '2x (2x width & height)', credits: '~€0.10' },
  { value: '4x', label: '4x (4x width & height)', credits: '~€0.20-0.40' },
  { value: '8x', label: '8x (8x width & height)', credits: '~€0.50+' },
  { value: '16x', label: '16x (16x width & height)', credits: '~€1.00+' },
]

const CREATIVE_ENGINES: { value: MagnificEngine; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'magnific_sparkle', label: 'Sparkle — Creative detail' },
  { value: 'magnific_illusio', label: 'Illusio — Artistic' },
  { value: 'magnific_sharpy', label: 'Sharpy — Sharp & clean' },
]

const OPTIMIZED_FOR: { value: MagnificOptimizedFor; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'soft_portraits', label: 'Soft Portraits' },
  { value: 'hard_portraits', label: 'Hard Portraits' },
  { value: 'art_n_illustration', label: 'Art & Illustration' },
  { value: 'videogame_assets', label: 'Videogame Assets' },
  { value: 'nature_n_landscapes', label: 'Nature & Landscapes' },
  { value: 'films_n_photography', label: 'Films & Photography' },
  { value: '3d_renders', label: '3D Renders' },
  { value: 'science_fiction_n_horror', label: 'Sci-Fi & Horror' },
]

const PRECISION_FLAVORS: { value: MagnificFlavor; label: string }[] = [
  { value: 'sublime', label: 'Sublime — Artistic & smooth' },
  { value: 'photo', label: 'Photo — Natural & realistic' },
  { value: 'photo_denoiser', label: 'Photo Denoiser — Noise reduction' },
]

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function UpscalerPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { keys } = useProviderManager()

  const [imgFile, setImgFile] = useState<File | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<'creative' | 'precision'>('creative')
  const [scale, setScale] = useState('2x')
  const [generating, setGenerating] = useState(false)
  const generatingRef = useRef(false)
  const successRef = useRef(false)
  const activeTaskIdRef = useRef<string | null>(null)

  const [prompt, setPrompt] = useState('')
  const [creativity, setCreativity] = useState(0)
  const [hdr, setHdr] = useState(0)
  const [resemblance, setResemblance] = useState(0)
  const [fractality, setFractality] = useState(0)
  const [engine, setEngine] = useState<MagnificEngine>('automatic')
  const [optimizedFor, setOptimizedFor] = useState<MagnificOptimizedFor>('standard')
  const [sharpen, setSharpen] = useState(7)
  const [smartGrain, setSmartGrain] = useState(7)
  const [ultraDetail, setUltraDetail] = useState(30)
  const [flavor, setFlavor] = useState<MagnificFlavor>('sublime')
  const [filterNsfw, setFilterNsfw] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [results, setResults] = useState<string[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState({ show: false, text: '', pct: 0, time: '0:00' })

  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  const magnificKeys = keys.magnific || []
  const hasActiveKey = magnificKeys.some((k) => k.status === 'active' || k.status === 'unknown')

  useEffect(() => {
    startBackgroundPolling()
    const stored = getResults().filter((r) => r.page === 'upscaler').map((r) => r.url)
    if (stored.length) setResults(stored)
    const storedLogs = getLogs().filter((l) => l.provider === 'magnific')
    if (storedLogs.length) {
      setLogs(storedLogs.map((l) => ({ time: l.time, msg: l.msg, level: l.level, provider: l.provider })))
    }
    const handler = () => {
      const r = getResults().filter((res) => res.page === 'upscaler').map((res) => res.url)
      setResults(r)
    }
    window.addEventListener('arkxmotion-tasks-changed', handler)
    return () => window.removeEventListener('arkxmotion-tasks-changed', handler)
  }, [])

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info', provider = 'magnific') => {
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    setLogs((prev) => [...prev, { time, msg, level, provider }])
    addBgLog(msg, level, provider)
  }, [])

  const handleFileChange = useCallback((files: FileList | null) => {
    if (!files?.[0]) return
    const file = files[0]
    if (!file.type.startsWith('image/')) {
      addToast('File harus gambar (JPG/PNG/WEBP)', 'error')
      return
    }
    setImgFile(file)
    setImgUrl(URL.createObjectURL(file))
  }, [addToast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileChange(e.dataTransfer.files)
  }, [handleFileChange])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const handleUpscale = async () => {
    if (!imgFile || generating) return

    setGenerating(true)
    generatingRef.current = false
    successRef.current = false
    activeTaskIdRef.current = null
    startTimeRef.current = Date.now()
    setStatus({ show: true, text: 'Preparing...', pct: 0, time: '0:00' })

    timerRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000)
      setStatus((s) => ({ ...s, time: formatTime(elapsed) }))
    }, 1000)

    try {
      addLog(`[1/3] Preparing image...`, 'info')
      setStatus((s) => ({ ...s, text: 'Converting image...', pct: 5 }))

      const imageBase64 = await fileToBase64(imgFile)
      addLog(`[1/3] Image ready (${(imgFile.size / 1024).toFixed(0)}KB)`, 'success')
      setStatus((s) => ({ ...s, text: 'Submitting...', pct: 15 }))

      const rotation = await withTokenRotation<string>(
        'magnific',
        async (apiKey, keyInfo) => {
          addLog(`[2/3] Submitting to Magnific ${mode}...`, 'info')
          addLog(`   → scale: ${scale} | mode: ${mode}`, 'debug')
          if (mode === 'creative') {
            addLog(`   → engine: ${engine} | optimized_for: ${optimizedFor}`, 'debug')
          } else {
            addLog(`   → flavor: ${flavor} | sharpen: ${sharpen}`, 'debug')
          }

          const submitResult = await submitMagnificUpscale(apiKey, {
            imageBase64,
            scaleFactor: scale as any,
            mode,
            prompt: mode === 'creative' ? prompt : undefined,
            creativity: mode === 'creative' ? creativity : undefined,
            hdr: mode === 'creative' ? hdr : undefined,
            resemblance: mode === 'creative' ? resemblance : undefined,
            fractality: mode === 'creative' ? fractality : undefined,
            engine: mode === 'creative' ? engine : undefined,
            optimizedFor: mode === 'creative' ? optimizedFor : undefined,
            sharpen: mode === 'precision' ? sharpen : undefined,
            smartGrain: mode === 'precision' ? smartGrain : undefined,
            ultraDetail: mode === 'precision' ? ultraDetail : undefined,
            flavor: mode === 'precision' ? flavor : undefined,
            filterNsfw,
          })

          if (!submitResult.ok) {
            addLog(`[2/3] Submit failed: ${submitResult.error}`, 'error')
            throw new Error(submitResult.error || 'Submit failed')
          }

          const taskId = submitResult.taskId!
          addLog(`[2/3] Task created ✓ id=${taskId.slice(0, 20)}...`, 'success')

          addActiveTask({
            id: taskId,
            taskId,
            roomId: '',
            token: apiKey,
            model: `Magnific ${mode} ${scale}`,
            prompt: prompt.trim() || '(upscale)',
            startedAt: Date.now(),
            page: 'upscaler',
          })
          activeTaskIdRef.current = taskId

          addLog(`[3/3] Polling for result...`, 'info')
          setStatus((s) => ({ ...s, text: 'Processing...', pct: 30 }))

          const imageUrl = await pollMagnificTask(apiKey, taskId, mode, (taskStatus, pct) => {
            addLog(`Poll: ${taskStatus} (${pct}%)`, 'debug')
            setStatus((s) => ({ ...s, pct, text: `Magnific ${taskStatus} (${pct}%)` }))
          }, 3600000)

          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          addLog(`✅ Image upscaled ✓`, 'success')

          removeActiveTask(taskId)
          activeTaskIdRef.current = null
          return imageUrl
        },
        {
          onKeySwitch: (from, to, attempt) => {
            addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
          },
          onError: (err, key) => {
            if (detectTokenError('magnific', err)) {
              addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn')
            }
          },
        }
      )

      if (rotation.ok && rotation.result) {
        setResults((prev) => [rotation.result!, ...prev])
        addResult({
          id: Date.now().toString(),
          url: rotation.result!,
          prompt: prompt.trim() || `(upscale ${scale})`,
          date: new Date().toISOString(),
          page: 'upscaler',
        })
        successRef.current = true
        setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
        if (rotation.triedKeys > 1) {
          addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
        }
      } else {
        throw new Error(rotation.error || 'Upscale failed')
      }
    } catch (err: any) {
      if (activeTaskIdRef.current) removeActiveTask(activeTaskIdRef.current)
      addLog(`❌ Error: ${err.message}`, 'error')
      addToast(`Upscale gagal: ${err.message}`, 'error')
      setStatus((s) => ({ ...s, pct: 100, text: `❌ Error: ${err.message}` }))
    } finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      const wasGenerating = generatingRef.current
      setGenerating(false)
      generatingRef.current = false
      if (wasGenerating && successRef.current) {
        addToast(`Upscale selesai: ${scale} ${mode}`, 'success')
      }
      setTimeout(() => setStatus((s) => ({ ...s, show: false })), 3000)
    }
  }

  const handleDownload = async (url: string, index: number) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const ext = url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)?.[1] || 'png'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `upscaled_${scale}_${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Image"
        highlight="Upscaler"
        desc="Tingkatkan resolusi dan kualitas gambar menggunakan AI Magnific."
      />

      {/* Provider Info */}
      <Section title="Provider" sub="Magnific AI — Image Upscaling">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div>
            Provider: <b className="text-foreground">{PROVIDER_CONFIGS.magnific.icon} {PROVIDER_CONFIGS.magnific.name}</b>
          </div>
          <div>
            API Keys: <b className={hasActiveKey ? 'text-emerald-500' : 'text-destructive'}>{magnificKeys.length}</b> tersedia
          </div>
          <div>
            Status: <b className={hasActiveKey ? 'text-emerald-500' : 'text-amber-500'}>{hasActiveKey ? 'Ready' : 'No Key'}</b>
          </div>
          {!hasActiveKey && (
            <a href="/providers" className="text-primary hover:underline flex items-center gap-1">
              <Key className="h-3 w-3" /> Tambah API key
            </a>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column: Image Input + Settings */}
        <div className="lg:col-span-2 space-y-5">
          {/* Image Upload */}
          <Section title="Upload Image" sub="Drag & drop atau klik untuk upload">
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e.target.files)} />
            {imgUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-border">
                <img src={imgUrl} alt="Input" className="w-full max-h-96 object-contain bg-black/20" />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="rounded-full px-2.5 py-1 text-xs bg-black/60 text-white flex items-center gap-1 hover:bg-black/80 transition"
                  >
                    <Upload className="h-3 w-3" /> Ganti
                  </button>
                  <button
                    onClick={() => { setImgFile(null); setImgUrl(null) }}
                    className="rounded-full px-2.5 py-1 text-xs bg-black/60 text-white flex items-center gap-1 hover:bg-red-600/80 transition"
                  >
                    <Trash2 className="h-3 w-3" /> Hapus
                  </button>
                </div>
                {imgFile && (
                  <div className="absolute bottom-2 left-2 text-[10px] text-white/70 bg-black/40 rounded px-2 py-0.5">
                    {imgFile.name} — {(imgFile.size / 1024).toFixed(0)}KB
                  </div>
                )}
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-2xl p-12 text-center hover:border-primary/50 transition cursor-pointer"
              >
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Drag & drop image di sini</p>
                <p className="text-xs text-muted-foreground/60 mt-1">JPG, PNG, WEBP — Max 25.3MP output</p>
              </div>
            )}
          </Section>

          {/* Settings */}
          <Section title="Settings" sub="Pengaturan upscaling">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Mode</Label>
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  disabled={generating}
                  options={[
                    { value: 'creative', label: '✨ Creative — Add detail' },
                    { value: 'precision', label: '🎯 Precision — Faithful' },
                  ]}
                />
              </div>
              <div>
                <Label>Scale Factor</Label>
                <Select
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                  disabled={generating}
                  options={SCALE_OPTIONS.map((s) => ({ value: s.value, label: `${s.label}` }))}
                />
              </div>
              <div>
                <Label>NSFW Filter</Label>
                <div className="flex items-center h-10 px-3 rounded-xl border border-border bg-muted/30">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={filterNsfw}
                      onChange={(e) => setFilterNsfw(e.target.checked)}
                      disabled={generating}
                      className="rounded"
                    />
                    Enable
                  </label>
                </div>
              </div>
            </div>

            {/* Advanced Settings Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 mt-4 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Advanced Settings
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {showAdvanced && (
              <div className="mt-3 p-3 rounded-xl border border-border bg-card/30 space-y-4">
                {mode === 'creative' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label>Engine</Label>
                        <Select
                          value={engine}
                          onChange={(e) => setEngine(e.target.value as MagnificEngine)}
                          disabled={generating}
                          options={CREATIVE_ENGINES}
                        />
                      </div>
                      <div>
                        <Label>Optimized For</Label>
                        <Select
                          value={optimizedFor}
                          onChange={(e) => setOptimizedFor(e.target.value as MagnificOptimizedFor)}
                          disabled={generating}
                          options={OPTIMIZED_FOR}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Prompt (opsional — guide upscale)</Label>
                      <Textarea
                        rows={2}
                        placeholder="Describe the desired output quality and style..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={generating}
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Creativity', value: creativity, set: setCreativity, min: -10, max: 10 },
                        { label: 'HDR', value: hdr, set: setHdr, min: -10, max: 10 },
                        { label: 'Resemblance', value: resemblance, set: setResemblance, min: -10, max: 10 },
                        { label: 'Fractality', value: fractality, set: setFractality, min: -10, max: 10 },
                      ].map((s) => (
                        <div key={s.label}>
                          <Label className="text-[11px]">{s.label}: {s.value}</Label>
                          <input
                            type="range"
                            min={s.min}
                            max={s.max}
                            value={s.value}
                            onChange={(e) => s.set(Number(e.target.value))}
                            disabled={generating}
                            className="w-full mt-1"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label>Flavor</Label>
                      <Select
                        value={flavor}
                        onChange={(e) => setFlavor(e.target.value as MagnificFlavor)}
                        disabled={generating}
                        options={PRECISION_FLAVORS}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Sharpen', value: sharpen, set: setSharpen, min: 0, max: 100, default: 7 },
                        { label: 'Smart Grain', value: smartGrain, set: setSmartGrain, min: 0, max: 100, default: 7 },
                        { label: 'Ultra Detail', value: ultraDetail, set: setUltraDetail, min: 0, max: 100, default: 30 },
                      ].map((s) => (
                        <div key={s.label}>
                          <Label className="text-[11px]">{s.label}: {s.value}</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={s.min}
                              max={s.max}
                              value={s.value}
                              onChange={(e) => s.set(Number(e.target.value))}
                              disabled={generating}
                              className="flex-1 mt-1"
                            />
                            <button
                              onClick={() => s.set(s.default)}
                              disabled={generating}
                              className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </Section>

          {/* Generate Button */}
          <Section title="Upscale">
            <div className="flex items-center gap-3 flex-wrap">
              <Button onClick={handleUpscale} loading={generating} disabled={!imgFile}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {generating ? 'Upscaling...' : `Upscale Image ${scale}`}
              </Button>
              {generating && (
                <div className="text-xs text-muted-foreground">
                  Mode: <b className="text-foreground">{mode}</b> | Scale: <b className="text-foreground">{scale}</b>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {status.show && (
              <div className="mt-4 rounded-xl border border-border/70 bg-card/40 p-3">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span>{status.text}</span>
                  <span className="font-mono text-muted-foreground">{status.time}</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full transition-all bg-primary rounded-full"
                    style={{ width: `${status.pct}%` }}
                  />
                </div>
                {!generating && status.pct === 100 && results.length > 0 && (
                  <Button size="sm" className="w-full mt-3" onClick={handleUpscale}>
                    <Wand2 className="h-4 w-4" /> Upscale Lagi
                  </Button>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Right Column: Info */}
        <div className="space-y-5">
          <Section title="Info" sub="Tentang Magnific Upscaler">
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                <b className="text-foreground">Creative mode</b> menambahkan detail baru yang dipandu prompt. Cocok untuk concept art, ilustrasi, dan visual kreatif.
              </p>
              <p>
                <b className="text-foreground">Precision mode</b> meningkatkan resolusi tanpa mengubah konten. Cocok untuk logo, UI, teks, dan foto produk.
              </p>
              <div className="pt-2 border-t border-border">
                <p className="font-medium text-foreground mb-1">Scale Factor:</p>
                <ul className="space-y-0.5">
                  <li>• <b>2x</b> — Double dimensions (4x pixels)</li>
                  <li>• <b>4x</b> — Quadruple dimensions (16x pixels)</li>
                  <li>• <b>8x</b> — 8x dimensions (64x pixels)</li>
                  <li>• <b>16x</b> — 16x dimensions (256x pixels)</li>
                </ul>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="font-medium text-foreground mb-1">Pricing:</p>
                <p>Based on output image area. Larger output = higher cost.</p>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <Section
          title={`Log (${logs.length})`}
          right={
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-destructive hover:text-destructive/80 transition"
            >
              Clear
            </button>
          }
        >
          <div className="max-h-52 overflow-y-auto overflow-x-hidden text-[11px] font-mono space-y-0.5 rounded-xl bg-black/20 p-2">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`break-all leading-relaxed ${
                  log.level === 'error'
                    ? 'text-red-400'
                    : log.level === 'success'
                    ? 'text-emerald-400'
                    : log.level === 'warn'
                    ? 'text-amber-400'
                    : log.level === 'debug'
                    ? 'text-slate-500'
                    : 'text-slate-400'
                }`}
              >
                <span className="text-slate-600">[{log.time}]</span>{' '}
                {log.level === 'error' && '❌ '}
                {log.level === 'success' && '✅ '}
                {log.level === 'warn' && '⚠️ '}
                {log.msg}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Results */}
      <Section
        title={`Hasil Upscale (${results.length})`}
        right={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResults([])
              const r = getResults().filter((res) => res.page !== 'upscaler')
              localStorage.setItem('arkxmotion_results', JSON.stringify(r.slice(0, 50)))
            }}
            disabled={results.length === 0}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        }
      >
        {results.length === 0 ? (
          <EmptyState
            icon={<Image className="h-8 w-8" />}
            title="Belum ada hasil"
            description="Upload gambar dan klik Upscale untuk meningkatkan resolusi"
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((url, index) => (
              <div key={index} className="rounded-xl overflow-hidden border border-border bg-black/40">
                <img
                  src={url}
                  alt={`Upscaled ${index + 1}`}
                  className="w-full aspect-square object-cover bg-black"
                  loading="lazy"
                />
                <div className="p-2 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Buka
                    </a>
                    <button
                      onClick={() => handleDownload(url, index)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500 transition"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setResults(results.filter((_, i) => i !== index))
                      removeResult(url)
                    }}
                    className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
