import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { Loader2, Upload, Download, X, Sparkles, CheckCircle2, AlertCircle, Clock, Image as ImageIcon } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitRunningHubViralEffects, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2, addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'

interface HistoryItem { time: string; taskId: string; url?: string }

const EFFECTS: { id: number; name: string }[] = [
  { id: 1, name: 'Giant Swing' },
  { id: 2, name: 'Chest Shaking Dance' },
  { id: 3, name: 'Turn and Transform into Doll' },
  { id: 4, name: 'Walk the Red Carpet' },
  { id: 5, name: 'Victory Dance' },
  { id: 6, name: 'Remove Head' },
  { id: 7, name: 'Rotate 360 Degrees Display' },
  { id: 8, name: 'Transform into Bride' },
  { id: 9, name: 'World Famous Painting' },
  { id: 10, name: 'Mona Lisa' },
  { id: 11, name: 'Gun Shooting' },
  { id: 12, name: 'High-altitude Flying' },
  { id: 13, name: 'Transform into Baby' },
  { id: 14, name: 'Surrounded by Puppies' },
  { id: 15, name: 'Transformers' },
  { id: 16, name: 'Transform into Venom' },
  { id: 17, name: 'Super Saiyan Transformation' },
  { id: 18, name: "God's Embrace" },
  { id: 19, name: 'Transform into Warrior' },
  { id: 20, name: 'Transform into Spartan' },
  { id: 21, name: 'Dual Gun Assassin' },
  { id: 22, name: 'Transform into Balloon and Fly Away' },
  { id: 23, name: 'Particle Dissipation' },
  { id: 24, name: 'Transform into Pirate' },
  { id: 25, name: 'Building Launch' },
  { id: 26, name: 'Transform into Samurai' },
  { id: 27, name: 'Deflated' },
  { id: 28, name: 'I Got Flattened' },
  { id: 29, name: 'Rotting and Melting' },
  { id: 30, name: 'Turtle Energy Wave' },
  { id: 31, name: 'Cut into Cake' },
  { id: 32, name: 'Slowly Aging' },
  { id: 33, name: 'Show Muscles' },
  { id: 34, name: 'Reveal Robot Mask' },
  { id: 35, name: 'Ghost Rider Skeleton' },
  { id: 36, name: 'Clay Molding Fun' },
  { id: 37, name: 'Dynamic Wallpaper Effects' },
  { id: 38, name: 'Transform into Snow White' },
  { id: 39, name: 'On Fire' },
  { id: 40, name: 'I Got Blown Up' },
  { id: 41, name: 'Princess Transformation' },
  { id: 42, name: 'Turn into Ashes' },
  { id: 43, name: 'Explosion Hair' },
  { id: 44, name: 'Practice Tai Chi' },
  { id: 45, name: 'Disney Princess' },
  { id: 46, name: 'Remove Jacket Dance' },
  { id: 47, name: 'Everything Blooms' },
  { id: 48, name: 'Transform into Hulk' },
  { id: 49, name: 'Give Me Face' },
  { id: 50, name: 'Dynamic Turn' },
  { id: 51, name: 'Hitchcock' },
  { id: 52, name: 'I Got Chest Assaulted' },
  { id: 53, name: 'Turtle Energy Wave 2' },
  { id: 54, name: 'Transform into Joker' },
  { id: 55, name: "I'm Angry" },
  { id: 56, name: 'Heaven and Earth Transformation' },
  { id: 57, name: 'Explode on the Spot' },
  { id: 58, name: 'Chest Expands' },
  { id: 59, name: 'Strong Wind Blowing' },
  { id: 60, name: 'Bullet Time' },
  { id: 61, name: 'Transform into Doll 2' },
  { id: 62, name: 'Guitarist' },
  { id: 63, name: 'Catwalk' },
  { id: 64, name: 'Splash Water Costume Change' },
  { id: 65, name: 'Thomas' },
  { id: 66, name: 'Windmill' },
]

export default function ViralEffectsPage() {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [effectNumber, setEffectNumber] = useState<number>(1)
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState<number>(2)
  const [frames, setFrames] = useState<number>(2)
  const [resolution, setResolution] = useState<number>(3)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const [statusText, setStatusText] = useState<string>('')
  const [logs, setLogs] = useState<{ time: string; msg: string; level: string }[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])

  const imagePickerRef = useRef<HTMLInputElement>(null)
  const addToast = useToastStore((s) => s.addToast)
  const isPageActive = usePageActive()

  const addLog = (msg: string, level: string = 'info') => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg, level }])
  }

  const handleImageSelect = (file: File) => {
    setImageFile(file)
    const url = URL.createObjectURL(file)
    setImagePreview(url)
  }

  const canRun = !!imageFile && !loading

  const runWorkflow = async () => {
    if (!imageFile) { addToast('⚠️ Upload foto terlebih dahulu!', 'warning'); return }
    setLoading(true); setError(null); setResultUrl(null); setProgress(0)
    setTaskStatus('submitting'); setLogs([])
    const efName = EFFECTS.find((e) => e.id === effectNumber)?.name || `#${effectNumber}`
    addLog(`Mulai Viral Effect: ${efName} — ${imageFile.name}`)

    const startTime = Date.now()
    const trackId = startGenerationTask({ page: 'viral-effects', model: 'Viral Effects', prompt: efName, provider: 'runninghub' })
    const logId = await logGenerationStart({ page: 'viral-effects', provider: 'runninghub', model: 'viral-effects', prompt: efName, credits: 0 })

    try {
      const result = await withTokenRotation<Awaited<ReturnType<typeof submitRunningHubViralEffects>>>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          return await submitRunningHubViralEffects({
            imageFile,
            effectNumber,
            steps,
            frames,
            resolution,
            prompt: prompt.trim(),
            apiKey: key,
          })
        },
        {
          onKeySwitch: (from, to, attempt) => {
            const msg = `🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`
            addLog(msg, 'warn')
            addToast(msg, 'info')
          },
          onError: (err, key) => {
            if (detectTokenError('runninghub', err)) {
              const msg = `⚠️ Key "${key.name}" bermasalah: ${err.message}`
              addLog(msg, 'warn')
              addToast(msg, 'warning')
            }
          },
        },
      )

      if (!result.ok || !result.result) throw new Error(result.error || 'Gagal submit')
      const submit = result.result
      const tid = submit.taskId
      setTaskId(tid)
      setTaskStatus('running')
      addLog(`TaskId: ${tid}`)

      const url = await pollRunningHubTask(tid, (status, pct) => {
        setTaskStatus('running')
        setProgress(pct)
        setStatusText(status)
        addLog(`Poll: ${status} ${pct}%`)
      }, 3600000, undefined, 'Viral Effects (RunningHub)')

      setResultUrl(url || null)
      if (url) {
        addLog('✅ Selesai!', 'success')
        setHistory((h) => [{ time: new Date().toLocaleTimeString(), taskId: tid, url }, ...h].slice(0, 20))
        await logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
        try { await persistResultToR2(tid, url) } catch {}
      } else {
        addLog('⚠️ Selesai tapi URL tidak ditemukan', 'warn')
      }
    } catch (e: any) {
      const msg = e?.message || String(e)
      setError(msg)
      addLog(`❌ ${msg}`, 'error')
      await logGenerationFailed(logId, msg, Date.now() - startTime)
    } finally {
      setLoading(false)
      setTaskStatus('')
      removeActiveTask(trackId)
    }
  }

  return (
    <PageContent>
      <PageHeader title="🔥 Viral Video Effects" desc="1 foto → video efek viral (66 efek pilihan). Powered by RunningHub." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="📸 Input" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">Foto</Label>
            {imagePreview ? (
              <div className="relative rounded-lg overflow-hidden border border-border">
                <img src={imagePreview} alt="preview" className="w-full max-h-64 object-contain bg-surface-secondary" />
                <button onClick={() => { setImageFile(null); setImagePreview(null) }} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div onClick={() => imagePickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50">
                <ImageIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">Klik untuk upload foto</div>
              </div>
            )}
            <input ref={imagePickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageSelect(e.target.files[0])} />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">Efek</Label>
            <select value={effectNumber} onChange={(e) => setEffectNumber(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
              {EFFECTS.map((e) => (
                <option key={e.id} value={e.id}>{e.id}. {e.name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            <div>
              <Label className="mb-1 block text-xs">Steps</Label>
              <select value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full px-2 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                <option value={1}>1 (cepat)</option>
                <option value={2}>2 (seimbang)</option>
                <option value={3}>3 (kualitas)</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Frames</Label>
              <select value={frames} onChange={(e) => setFrames(Number(e.target.value))} className="w-full px-2 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                <option value={1}>49</option>
                <option value={2}>65</option>
                <option value={3}>81</option>
              </select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Resolusi</Label>
              <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))} className="w-full px-2 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                <option value={1}>420P</option>
                <option value={2}>512P</option>
                <option value={3}>720P</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">Deskripsi singkat (opsional)</Label>
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="man, woman, car, cat/dog, ..." className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm" />
          </div>

          <Button onClick={runWorkflow} disabled={!canRun} className="w-full" size="lg">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'} ${progress ? `(${progress}%)` : ''}` : '🚀 Generate Viral Effect'}
          </Button>

          {error && <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
        </Section>

        <Section title="🎬 Hasil" className="!p-6">
          {resultUrl ? (
            <div className="space-y-3">
              <video src={resultUrl} controls className="w-full rounded-lg border border-border" />
              <a href={resultUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                <Download className="h-4 w-4" /> Download
              </a>
            </div>
          ) : (
            <EmptyState icon={<Sparkles className="h-8 w-8" />} title="Belum ada hasil" description="Upload foto dan pilih efek, lalu Generate." />
          )}
          {logs.length > 0 && (
            <div className="mt-4 max-h-48 overflow-auto text-xs font-mono bg-surface-secondary rounded p-2 space-y-1">
              {logs.map((l, i) => (
                <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'success' ? 'text-green-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'}>
                  [{l.time}] {l.msg}
                </div>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-surface-secondary rounded px-2 py-1">
                    <span className="text-muted-foreground">{h.time}</span>
                    {h.url && <a href={h.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[200px]">lihat</a>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>
    </PageContent>
  )
}