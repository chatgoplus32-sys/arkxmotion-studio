import { useState, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, Textarea, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Upload, Download, X, Image as ImageIcon, Sparkles, CheckCircle2, AlertCircle, Clock, Plus, User, Film } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitRunningHubUGCStoryboard, pollRunningHubTask, UGC_STORYBOARD_ASPECTS } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { normalizeImage } from '@/lib/roboneo'

const MAX_SCENES = 4
const MAX_DURATION = 15

interface SceneImage {
  id: string
  file: File
  preview: string
}

interface HistoryItem {
  time: string
  taskId: string
  status: string
  url?: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success'
}

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

export default function UGCStoryboardPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [charFile, setCharFile] = useState<File | null>(null)
  const [charPreview, setCharPreview] = useState<string | null>(null)
  const [scenes, setScenes] = useState<SceneImage[]>([])
  const [prompt, setPrompt] = useState('follow prompt storyboards')
  const [duration, setDuration] = useLocalStorage('ugcStoryboard.duration', MAX_DURATION)
  const [aspect, setAspect] = useLocalStorage('ugcStoryboard.aspect', UGC_STORYBOARD_ASPECTS[0])
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [timedOutTaskId, setTimedOutTaskId] = useState<string | null>(null)

  const charPickerRef = useRef<HTMLInputElement | null>(null)
  const scenePickerRef = useRef<HTMLInputElement | null>(null)

  const apiKey = getStoredProviderKey('runninghub')

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const clearLogs = () => setLogs([])

  const handleCharSelect = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharFile(file)
      setCharPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleSceneSelect = (files: FileList | null) => {
    if (!files) return
    const room = MAX_SCENES - scenes.length
    if (room <= 0) {
      addToast(`Maksimal ${MAX_SCENES} gambar scene`, 'warning')
      return
    }
    const added: SceneImage[] = Array.from(files).slice(0, room).map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: URL.createObjectURL(f),
    }))
    setScenes((prev) => [...prev, ...added])
  }

  const removeScene = (id: string) => {
    setScenes((prev) => {
      const target = prev.find((s) => s.id === id)
      if (target) URL.revokeObjectURL(target.preview)
      return prev.filter((s) => s.id !== id)
    })
  }

  const finishSuccess = (url: string, tid: string) => {
    setResultUrl(url)
    setTaskStatus('success')
    setProgress(100)
    setTimedOutTaskId(null)
    addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
    // URL RunningHub kedaluwarsa 24 jam — simpan permanen ke R2
    persistResultToR2(tid, url)
    setHistory((prev) => [
      { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
      ...prev,
    ])
    addToast('✅ Video UGC Storyboard selesai!', 'success')
  }

  const runWorkflow = async () => {
    if (!apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (!charFile) {
      addToast('⚠️ Upload gambar karakter utama terlebih dahulu!', 'warning')
      return
    }
    if (scenes.length === 0) {
      addToast('⚠️ Tambahkan minimal 1 gambar scene!', 'warning')
      return
    }
    const effDuration = Math.max(1, Math.min(MAX_DURATION, Number(duration) || MAX_DURATION))

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTimedOutTaskId(null)
    setTaskStatus('submitting')
    setLogs([])

    // Normalisasi karakter + semua scene (HEIC→JPEG, kompres >4MB)
    let upChar = charFile
    try {
      addLog(`Normalisasi karakter ${(charFile.size / 1024 / 1024).toFixed(1)}MB...`)
      upChar = await normalizeImage(charFile, (msg) => addLog(msg))
      addLog(`Karakter siap: ${(upChar.size / 1024).toFixed(0)}KB`, 'success')
    } catch (e: any) {
      addLog(`Normalisasi karakter gagal, pakai file asli: ${e.message}`, 'warn')
    }
    const upScenes: File[] = []
    for (let i = 0; i < scenes.length; i++) {
      let f = scenes[i].file
      try {
        addLog(`Normalisasi scene ${i + 1} (${(f.size / 1024 / 1024).toFixed(1)}MB)...`)
        f = await normalizeImage(f, (msg) => addLog(msg))
        addLog(`Scene ${i + 1} siap: ${(f.size / 1024).toFixed(0)}KB`, 'success')
      } catch (e: any) {
        addLog(`Normalisasi scene ${i + 1} gagal, pakai file asli: ${e.message}`, 'warn')
      }
      upScenes.push(f)
    }

    addLog(`Mulai (UGC Storyboard): karakter + ${upScenes.length} scene, durasi=${effDuration}s, aspect=${aspect}`)
    addLog(`Prompt: ${prompt.trim().slice(0, 150)}`)

    let submittedTaskId = ''
    try {
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = await submitRunningHubUGCStoryboard({
            characterImage: upChar,
            sceneImages: upScenes,
            prompt: prompt.trim() || 'follow prompt storyboards',
            duration: effDuration,
            aspectRatio: aspect,
            apiKey: key,
          })
          submittedTaskId = submit.taskId
          setTaskId(submit.taskId)
          setTaskStatus('running')
          addLog(`TaskId: ${submit.taskId} (status: ${submit.status})`, 'success')
          const url = await pollRunningHubTask(submit.taskId, (status, pct) => {
            setTaskStatus('running')
            setProgress(pct)
            addLog(`Poll: ${status} ${pct}%`)
          }, 3600000, key)
          return url
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

      if (!rotation.ok || !rotation.result) {
        throw new Error(rotation.error || 'Generation failed')
      }
      finishSuccess(rotation.result, submittedTaskId || `ugc-${Date.now()}`)
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message}`, 'error')
      if (/timeout/i.test(e.message || '') && submittedTaskId) {
        setTimedOutTaskId(submittedTaskId)
        addToast('Task masih jalan di server — pakai "Lanjutkan" untuk cek lagi tanpa submit baru', 'info')
      }
    } finally {
      setLoading(false)
    }
  }

  const continuePolling = async () => {
    if (!timedOutTaskId || loading) return
    setLoading(true)
    setError(null)
    setTaskStatus('running')
    addLog(`🔄 Lanjutkan polling task ${timedOutTaskId.slice(0, 20)}...`)
    try {
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key) => {
          return pollRunningHubTask(timedOutTaskId, (status, pct) => {
            setTaskStatus('running')
            setProgress(pct)
            addLog(`Poll: ${status} ${pct}%`)
          }, 3600000, key)
        },
        {},
      )
      if (!rotation.ok || !rotation.result) {
        throw new Error(rotation.error || 'Polling failed')
      }
      finishSuccess(rotation.result, timedOutTaskId)
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Lanjut polling gagal: ${e.message || e}`, 'error')
      if (!/timeout/i.test(e.message || '')) setTimedOutTaskId(null)
      else addToast('Masih jalan — coba "Lanjutkan" lagi nanti', 'info')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        title="🎬 UGC Storyboard"
        desc="Ubah beberapa gambar referensi jadi video UGC multi-scene via MiniMax H3 I2V — multi-shot storyboard, multi-angle, karakter konsisten, dialog Indonesia + lip-sync, durasi hingga 15 detik."
      />

      {!apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📸 Input Storyboard" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">👤 Karakter Utama (wajib — acuan wajah & gaya di semua scene)</Label>
            {charPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden">
                <img src={charPreview} alt="Karakter" className="w-full max-h-56 object-contain bg-surface-secondary" />
                <button onClick={() => { setCharFile(null); setCharPreview(null) }} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="p-2 text-xs text-muted-foreground truncate">{charFile?.name}</div>
              </div>
            ) : (
              <div onClick={() => charPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><User className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret foto karakter di sini</div>
                <div className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — jaga konsistensi wajah dari awal sampai akhir</div>
              </div>
            )}
            <input ref={charPickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCharSelect(e.target.files[0])} />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">🖼️ Gambar Scene / Produk (min 1, maks {MAX_SCENES}) — storyboard tiap scene: pose, ekspresi, komposisi, multi-angle</Label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {scenes.map((s, i) => (
                <div key={s.id} className="relative rounded-lg border border-border overflow-hidden group">
                  <img src={s.preview} alt={`Scene ${i + 1}`} className="w-full h-20 object-cover bg-surface-secondary" />
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] text-white text-center py-0.5">Scene {i + 1}</div>
                  <button onClick={() => removeScene(s.id)} className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {scenes.length < MAX_SCENES && (
                <button
                  onClick={() => scenePickerRef.current?.click()}
                  className="h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-[10px]">Tambah Scene</span>
                </button>
              )}
            </div>
            <input ref={scenePickerRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleSceneSelect(e.target.files); e.target.value = '' }} />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt Storyboard / Instruksi Video</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="cth: Character holds the product, talks to camera in Indonesian, natural expressions, multi-angle shots, UGC style..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <Label>Durasi Video (detik, maks {MAX_DURATION})</Label>
              <input
                type="number" min={1} max={MAX_DURATION}
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Math.min(MAX_DURATION, Number(e.target.value) || MAX_DURATION)))}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <Label>Aspect Ratio</Label>
              <Select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                options={UGC_STORYBOARD_ASPECTS.map((a) => ({ value: a, label: a }))}
              />
            </div>
          </div>

          <Button
            onClick={runWorkflow}
            disabled={loading || !apiKey || !charFile || scenes.length === 0}
            className="w-full"
            size="lg"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Film className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Mengunggah & submit...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : '🚀 Generate Video UGC'}
          </Button>
          {timedOutTaskId && !loading && (
            <Button
              onClick={continuePolling}
              disabled={loading}
              variant="outline"
              className="w-full mt-2"
            >
              🔄 Lanjutkan polling task sebelumnya
            </Button>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Render 1-15 detik biasanya butuh 5-15 menit. Link hasil berlaku 24 jam — otomatis disimpan permanen ke R2.
          </p>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil Video" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && (
              <span className="text-sm text-muted-foreground">Belum ada task yang dijalankan.</span>
            )}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Upload className="h-4 w-4 animate-pulse" /> Mengunggah {1 + scenes.length} gambar & submit...
              </span>
            )}
            {taskStatus === 'running' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Clock className="h-4 w-4 animate-spin" /> {taskId?.slice(0, 20)}... — {progress}%
              </span>
            )}
            {taskStatus === 'success' && (
              <span className="text-sm text-green-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Selesai!
              </span>
            )}
            {taskStatus === 'error' && (
              <span className="text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Error: {error || 'Unknown error'}
              </span>
            )}
          </div>

          <div className="min-h-[200px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <video src={resultUrl} controls className="w-full" />
                <div className="p-2 text-center">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download Video
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Sparkles className="h-12 w-12" />} title="Belum ada hasil" description="Video UGC akan muncul di sini setelah proses selesai." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    {h.url && <video src={h.url} className="h-8 w-12 rounded object-cover shrink-0" muted playsInline preload="metadata" />}
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground font-mono truncate">{h.taskId?.slice(0, 15)}...</span>
                    <span className="shrink-0">{h.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Log Detail */}
      <Section title="🧾 Log Detail" sub={`Total ${logs.length} entri`}>
          <LogDetailActions logs={logs} onClear={clearLogs} />
        <div className="rounded-xl border border-border/60 bg-black/40 p-2 max-h-64 overflow-y-auto overflow-x-hidden text-[11px] font-mono min-w-0">
          {logs.length === 0 ? (
            <div className="text-muted-foreground px-1 py-2">Belum ada log. Jalankan generate untuk melihat detail proses.</div>
          ) : logs.map((log, i) => (
            <div key={i} className={`break-all min-w-0 px-1 py-0.5 ${
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
    </PageContent>
  )
}
