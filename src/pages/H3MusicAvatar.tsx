import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Upload, Download, X, User, Sparkles, CheckCircle2, AlertCircle, Clock, Music, Copy, Trash2, Film, AudioLines } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitRunningHubH3MusicAvatar, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'

interface HistoryItem {
  time: string
  taskId: string
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

// Prompt default sesuai contoh resmi docs app Music Avatar.
const DEFAULT_PROMPT = 'The character in Image1 faces the camera, speaking and singing affectionately. Fixed camera. Clothing and background remain unchanged. No subtitles, no text.'

export default function H3MusicAvatarPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [characterFile, setCharacterFile] = useState<File | null>(null)
  const [characterPreview, setCharacterPreview] = useState<string | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [taskIdStr, setTaskIdStr] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const characterPickerRef = useRef<HTMLInputElement | null>(null)
  const audioPickerRef = useRef<HTMLInputElement | null>(null)
  const apiKey = getStoredProviderKey('runninghub')

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-300))
  }
  const clearLogs = () => setLogs([])

  const handleCharacterSelect = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharacterFile(file)
      setCharacterPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const removeCharacter = () => {
    setCharacterFile(null)
    setCharacterPreview(null)
  }

  // ────────────────────────────────────────────────────────────
  // 1 foto + 1 audio → 1 video
  // ────────────────────────────────────────────────────────────
  const runSingle = async (key: string) => {
    if (!characterFile || !audioFile) throw new Error('File tidak lengkap')
    const efPrompt = prompt.trim() || DEFAULT_PROMPT

    const submit = await submitRunningHubH3MusicAvatar({
      imageFile: characterFile,
      audioFile,
      prompt: efPrompt,
      apiKey: key,
    })
    setTaskIdStr(submit.taskId)
    setTaskStatus('running')
    addLog(`TaskId: ${submit.taskId} (status: ${submit.status})`, 'success')

    return await pollRunningHubTask(submit.taskId, (status, pct) => {
      setTaskStatus('running')
      setProgress(pct)
      addLog(`Poll: ${status} ${pct}%`)
    }, 3600000, key, 'H3 Music Avatar (RunningHub)')
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
    if (!audioFile) {
      addToast('⚠️ Upload audio lagu terlebih dahulu!', 'warning')
      return
    }

    const efPrompt = prompt.trim() || DEFAULT_PROMPT

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    addLog(`Mulai Music Avatar: ${characterFile.name} + ${audioFile.name}`)
    if (efPrompt !== DEFAULT_PROMPT) addLog(`Prompt: ${efPrompt.slice(0, 100)}...`)

    const startTime = Date.now()
    const logId = await logGenerationStart({
      page: 'h3-music-avatar',
      provider: 'runninghub',
      model: 'h3-music-avatar',
      prompt: efPrompt.slice(0, 500),
      credits: 0,
      slot_count: 1,
    })

    try {
      const result = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          return await runSingle(key)
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

      if (!result.ok || !result.result) {
        throw new Error(result.error || 'Generation failed')
      }

      const url = result.result
      const tid = taskIdStr || `h3-music-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      setStatusText('')
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      persistResultToR2(tid, url)
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, url },
        ...prev,
      ])
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ Music Avatar selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const canRun = !!apiKey && !!characterFile && !!audioFile && !loading

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
        title="🎤 H3 Music Avatar"
        desc="1 foto + audio lagu → video avatar menyanyi."
      />

      {!apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="🎵 Input" className="!p-6">
          {/* Image Upload */}
          <div className="mb-4">
            <Label className="mb-2 block">🧑 Foto Karakter</Label>
            {characterPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden">
                <img src={characterPreview} alt="Karakter" className="w-full max-h-52 object-contain bg-surface-secondary" />
                <button onClick={removeCharacter} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="p-2 text-xs text-muted-foreground truncate">{characterFile?.name}</div>
              </div>
            ) : (
              <div onClick={() => characterPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><User className="h-7 w-7" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret foto karakter</div>
                <div className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP</div>
              </div>
            )}
            <input ref={characterPickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCharacterSelect(e.target.files[0])} />
          </div>

          {/* Audio Upload */}
          <div className="mb-4">
            <Label className="mb-2 block">🎧 Audio Lagu</Label>
            {audioFile ? (
              <div className="relative rounded-lg border border-border p-3 bg-surface-secondary">
                <button onClick={() => setAudioFile(null)} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2">
                  <AudioLines className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{audioFile.name}</div>
                    <div className="text-xs text-muted-foreground">{(audioFile.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                </div>
              </div>
            ) : (
              <div onClick={() => audioPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><Music className="h-7 w-7" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret audio lagu</div>
                <div className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A</div>
              </div>
            )}
            <input ref={audioPickerRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])} />
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt Acting (opsional)</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={DEFAULT_PROMPT}
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
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'} ${progress ? `(${progress}%)` : ''}` : '🚀 Generate Music Avatar'}
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
                <Clock className="h-4 w-4 animate-spin" /> {statusText || `${taskIdStr?.slice(0, 20)}...`} {progress ? `— ${progress}%` : ''}
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
                {characterFile && audioFile && (
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
                <video src={resultUrl} controls className="w-full max-h-[480px] bg-black" />
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Film className="h-12 w-12" />} title="Belum ada hasil" description="Upload foto + audio lagu, lalu klik Generate." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    <AudioLines className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground font-mono truncate">{h.taskId?.slice(0, 15)}...</span>
                    {h.url && <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">buka</a>}
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
              const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
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
