import { useState, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { Loader2, Upload, Download, X, Mic, Image as ImageIcon, Sparkles, CheckCircle2, AlertCircle, Clock, Music } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitRunningHubAudioAvatar, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'

interface HistoryItem {
  time: string
  taskId: string
  status: string
  url?: string
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

export default function TalkingPhotoPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioPreview, setAudioPreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const photoPickerRef = useRef<HTMLInputElement | null>(null)
  const audioPickerRef = useRef<HTMLInputElement | null>(null)

  const apiKey = getStoredProviderKey('runninghub')

  const handlePhotoSelect = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setPhotoFile(file)
      setPhotoPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleAudioSelect = (file: File) => {
    setAudioFile(file)
    setAudioPreview(URL.createObjectURL(file))
  }

  const runWorkflow = async () => {
    if (!apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (!photoFile) {
      addToast('⚠️ Upload foto terlebih dahulu!', 'warning')
      return
    }
    if (!audioFile) {
      addToast('⚠️ Upload file audio terlebih dahulu!', 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')

    try {
      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key) => {
          const submit = await submitRunningHubAudioAvatar({
            imageFile: photoFile!,
            audioFile: audioFile!,
            prompt: prompt.trim() || undefined,
            apiKey: key,
          })
          submittedTaskId = submit.taskId
          setTaskId(submit.taskId)
          setTaskStatus('running')
          const url = await pollRunningHubTask(submit.taskId, (_status, pct) => {
            setTaskStatus('running')
            setProgress(pct)
          }, 1800000, key)
          return url
        },
        {
          onKeySwitch: (from, to, attempt) => {
            addToast(`🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`, 'info')
          },
          onError: (err, key) => {
            if (detectTokenError('runninghub', err)) {
              addToast(`⚠️ Key "${key.name}" bermasalah: ${err.message}`, 'warning')
            }
          },
        },
      )

      if (!rotation.ok || !rotation.result) {
        throw new Error(rotation.error || 'Generation failed')
      }

      const url = rotation.result
      const tid = submittedTaskId || `avatar-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      // URL RunningHub kedaluwarsa 24 jam — simpan permanen ke R2
      persistResultToR2(tid, url)
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ Talking Photo selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        title="🎤 Talking Photo — Audio Avatar"
        desc="Hidupkan 1 foto jadi manusia digital bicara & bernyanyi dari audio. MiniMax H3 via RunningHub (H3 Studio Markas HD 1080p)."
      />

      {!apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📸 Input" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">🖼️ Foto Wajah / Karakter</Label>
            {photoPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden">
                <img src={photoPreview} alt="Foto" className="w-full max-h-64 object-contain bg-surface-secondary" />
                <button onClick={() => { setPhotoFile(null); setPhotoPreview(null) }} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
                  <X className="h-4 w-4" />
                </button>
                <div className="p-2 text-xs text-muted-foreground truncate">{photoFile?.name}</div>
              </div>
            ) : (
              <div onClick={() => photoPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><ImageIcon className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret foto di sini</div>
                <div className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — max 50MB</div>
              </div>
            )}
            <input ref={photoPickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])} />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">🎵 File Audio (bicara / nyanyi)</Label>
            {audioFile ? (
              <div className="rounded-lg border border-border overflow-hidden bg-surface-secondary p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)}MB)</span>
                  <button onClick={() => { setAudioFile(null); setAudioPreview(null) }} className="p-1 rounded-full hover:bg-red-500/80 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {audioPreview && <audio src={audioPreview} controls className="w-full" />}
              </div>
            ) : (
              <div onClick={() => audioPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><Mic className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret audio di sini</div>
                <div className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A — max 50MB</div>
              </div>
            )}
            <input ref={audioPickerRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleAudioSelect(e.target.files[0])} />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt (opsional)</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Deskripsi tambahan, mis. ekspresi atau gaya..."
            />
          </div>

          <Button
            onClick={runWorkflow}
            disabled={loading || !apiKey || !photoFile || !audioFile}
            className="w-full"
            size="lg"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : '🚀 Jalankan AI'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Output HD 1080p. Hasil bergantung kualitas foto & audio; durasi video mengikuti audio.
          </p>
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
              <EmptyState icon={<Sparkles className="h-12 w-12" />} title="Belum ada hasil" description="Video akan muncul di sini setelah proses selesai." />
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
    </PageContent>
  )
}
