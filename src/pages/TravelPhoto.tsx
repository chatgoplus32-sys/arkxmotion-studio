import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Upload, Download, X, User, Sparkles, CheckCircle2, AlertCircle, Clock, Globe, Copy, Trash2 } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitRunningHubTravelPhoto, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'

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

const DESTINATIONS = [
  { id: 'tokyo', label: '🗼 Tokyo, Jepang', emoji: '🗼' },
  { id: 'paris', label: '🗼 Paris, Prancis', emoji: '🗼' },
  { id: 'newyork', label: '🗽 New York, AS', emoji: '🗽' },
  { id: 'bali', label: '🏝️ Bali, Indonesia', emoji: '🏝️' },
  { id: 'dubai', label: '🏙️ Dubai, UAE', emoji: '🏙️' },
  { id: 'rome', label: '🏛️ Roma, Italia', emoji: '🏛️' },
  { id: 'london', label: '🎡 London, Inggris', emoji: '🎡' },
  { id: 'sydney', label: '🌊 Sydney, Australia', emoji: '🌊' },
  { id: 'custom', label: '✏️ Lokasi Lain...', emoji: '✏️' },
]

export default function TravelPhotoPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [characterFile, setCharacterFile] = useState<File | null>(null)
  const [characterPreview, setCharacterPreview] = useState<string | null>(null)
  const [destination, setDestination] = useState('tokyo')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [customDestination, setCustomDestination] = useState('')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'uploading' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const characterPickerRef = useRef<HTMLInputElement | null>(null)
  const apiKey = getStoredProviderKey('runninghub')

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const clearLogs = () => setLogs([])

  const handleFileSelect = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharacterFile(file)
      setCharacterPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const removeFile = () => {
    setCharacterFile(null)
    setCharacterPreview(null)
  }

  const runWorkflow = async () => {
    if (!apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (!characterFile) {
      addToast('⚠️ Upload foto karakter terlebih dahulu!', 'warning')
      return
    }

    const dest = destination === 'custom' ? customDestination : DESTINATIONS.find(d => d.id === destination)?.label || destination
    if (destination === 'custom' && !customDestination.trim()) {
      addToast('⚠️ Masukkan nama lokasi tujuan!', 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    addLog(`Mulai Travel Photo: ${(characterFile.size / 1024).toFixed(0)}KB ${characterFile.name}`)
    addLog(`Destinasi: ${dest}`)
    if (prompt.trim()) addLog(`Prompt: ${prompt.trim().slice(0, 120)}`)

    try {
      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = await submitRunningHubTravelPhoto({
            characterFile,
            destination: dest,
            prompt: prompt.trim() || undefined,
            aspectRatio,
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
          }, 600000, key)
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

      const url = rotation.result
      const tid = submittedTaskId || `travel-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      if ((rotation.triedKeys || 1) > 1) {
        addLog(`Dipakai key "${rotation.usedKey?.name}" setelah ${rotation.triedKeys} percobaan`)
      }
      persistResultToR2(tid, url)
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ Travel Photo selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const canRun = !!apiKey && !!characterFile && !loading && !(destination === 'custom' && !customDestination.trim())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault()
        void runWorkflow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="🌍 Qwen AI Travel Photography"
        desc="Ubah 1 foto karakter menjadi berbagai foto perjalanan realistis di beragam destinasi. AI otomatis membuat variasi pose, ekspresi, komposisi, dan sudut kamera."
      />

      {/* Feature badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['✨ 1 Foto → Banyak Destinasi', '🎭 Wajah Konsisten', '📸 Multi-Angle', '🌍 Lokasi Bebas', '⚡ Prompt Otomatis', '🔥 Hasil Cinematic'].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📸 Input" className="!p-6">
          {/* Character Upload */}
          <div className="mb-4">
            <Label className="mb-2 block">🧑 Foto Karakter / Model</Label>
            {characterPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden">
                <img src={characterPreview} alt="Karakter" className="w-full max-h-64 object-contain bg-surface-secondary" />
                <button onClick={removeFile} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="p-2 text-xs text-muted-foreground truncate">{characterFile?.name}</div>
              </div>
            ) : (
              <div onClick={() => characterPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><User className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret foto di sini</div>
                <div className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — max 50MB</div>
              </div>
            )}
            <input ref={characterPickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
          </div>

          {/* Destination */}
          <div className="mb-4">
            <Label className="mb-2 block">🌍 Destinasi Tujuan</Label>
            <div className="grid grid-cols-3 gap-2">
              {DESTINATIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDestination(d.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                    destination === d.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {destination === 'custom' && (
              <input
                type="text"
                value={customDestination}
                onChange={(e) => setCustomDestination(e.target.value)}
                className="mt-2 w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Contoh: Pantai Maldives, Gunung Fuji, etc."
              />
            )}
          </div>

          {/* Aspect Ratio */}
          <div className="mb-4">
            <Label className="mb-2 block">📐 Aspect Ratio</Label>
            <div className="flex gap-2 flex-wrap">
              {['9:16', '16:9', '1:1', '3:4', '4:3', '3:2', '2:3'].map((ar) => (
                <button
                  key={ar}
                  onClick={() => setAspectRatio(ar)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    aspectRatio === ar
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt Tambahan (opsional)</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Tambahkan detail: pose, ekspresi, pencahayaan, waktu hari..."
            />
          </div>

          <Button
            onClick={runWorkflow}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : '🚀 Generate Travel Photo'}
          </Button>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && (
              <span className="text-sm text-muted-foreground">Belum ada task yang dijalankan.</span>
            )}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Upload className="h-4 w-4 animate-pulse" /> Mengunggah & submit...
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
                {characterFile && (
                  <button
                    type="button"
                    onClick={runWorkflow}
                    disabled={loading}
                    className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20"
                  >
                    Coba lagi
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="min-h-[200px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <img src={resultUrl} alt="Travel Photo result" className="w-full" />
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full Size</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Globe className="h-12 w-12" />} title="Belum ada hasil" description="Upload foto karakter dan pilih destinasi, lalu klik Generate." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    {h.url && <img src={h.url} alt={`Riwayat travel ${i + 1}`} className="h-8 w-8 rounded object-cover shrink-0" />}
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
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => {
              const text = logs.map(l => `[${l.time}] ${l.msg}`).join('\n')
              navigator.clipboard.writeText(text)
              addToast('📋 Log dicopy!')
            }}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-secondary text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
          <button
            onClick={() => { setLogs([]); addToast('🗑️ Log dihapus') }}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-secondary text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="h-3 w-3" /> Hapus
          </button>
        </div>
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
