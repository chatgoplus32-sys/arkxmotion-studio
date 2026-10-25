import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, X, Music, Sparkles, CheckCircle2, AlertCircle, Clock, FileAudio, Copy, Trash2 } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { submitRunningHubSongCover, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { STYLE_PRESETS, GENRE_CATEGORIES, type SongGenreCategory } from '@/lib/song-cover-genres'

const CREDIT_COST = 50

const VOCALS = [
  { id: 'female', label: '👩 Wanita', descriptor: 'Female lead vocal, warm expressive female singer voice' },
  { id: 'male', label: '👨 Pria', descriptor: 'Male lead vocal, rich expressive male singer voice' },
  { id: 'duet', label: '👫 Duet', descriptor: 'Duet of male and female vocals with harmonies' },
  { id: 'instrumental', label: '🎹 Instrumental', descriptor: 'Instrumental, no vocals' },
]

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

function mediaKind(url: string): 'audio' | 'video' | 'image' {
  const p = url.split('?')[0].toLowerCase()
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(p)) return 'audio'
  if (/\.(mp4|webm|mov|m4v)$/.test(p)) return 'video'
  return 'image'
}

function normalizeGenreSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export default function SongCoverPage() {
  const addToast = useToastStore((s) => s.addToast)
  const currentUser = useAuthStore((s) => s.user)

  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([STYLE_PRESETS[0].id])
  const [genreCat, setGenreCat] = useState<SongGenreCategory | 'all'>('all')
  const [genreSearch, setGenreSearch] = useState('')
  const [styleMode, setStyleMode] = useState<'preset' | 'manual'>('preset')
  const [extraPrompt, setExtraPrompt] = useState('')
  const [vocal, setVocal] = useState(VOCALS[0].id)
  const [lyrics, setLyrics] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'uploading' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const audioPickerRef = useRef<HTMLInputElement | null>(null)
  const apiKey = getStoredProviderKey('runninghub')

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const clearLogs = () => setLogs([])

  useEffect(() => {
    return () => { if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl) }
  }, [audioPreviewUrl])

  const handleFileSelect = (file: File) => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
    setAudioFile(file)
    setAudioPreviewUrl(URL.createObjectURL(file))
  }

  const removeFile = () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
    setAudioFile(null)
    setAudioPreviewUrl(null)
  }

  const togglePreset = (p: typeof STYLE_PRESETS[number]) => {
    setSelected((prev) => {
      if (prev.includes(p.id)) return prev.filter((x) => x !== p.id)
      if (prev.length >= 3) { addToast('Maksimal 3 gaya aransemen. Hapus salah satu dulu.', 'warning'); return prev }
      return [...prev, p.id]
    })
  }

  const selectedGenres = STYLE_PRESETS.filter((p) => selected.includes(p.id))
  const genreQuery = normalizeGenreSearch(genreSearch)
  const visibleGenres = STYLE_PRESETS.filter(
    (p) =>
      (genreCat === 'all' || p.cat === genreCat) &&
      (!genreQuery || normalizeGenreSearch(`${p.id} ${p.label}`).includes(genreQuery)),
  )
  const manualStyle = extraPrompt.trim()
  const composedStyle = styleMode === 'manual'
    ? manualStyle
    : [...selectedGenres.map((g) => g.prompt), manualStyle].filter(Boolean).join('. ')

  const runWorkflow = async () => {
    if (!apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (!audioFile) {
      addToast('⚠️ Upload file lagu/audio terlebih dahulu!', 'warning')
      return
    }
    if (!composedStyle && !lyrics.trim()) {
      addToast('⚠️ Pilih minimal 1 gaya preset, tulis gaya aransemen manual, atau isi lirik!', 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    const vocalDesc = VOCALS.find((v) => v.id === vocal)?.descriptor || ''
    const finalStyle = [vocalDesc, composedStyle].filter(Boolean).join('. ')
    addLog(`Mulai AI Song Cover: ${(audioFile.size / 1024).toFixed(0)}KB ${audioFile.name}`)
    addLog(`Vokal: ${VOCALS.find((v) => v.id === vocal)?.label || vocal}`)
    const styleLabel = styleMode === 'manual'
      ? manualStyle.slice(0, 120)
      : selectedGenres.map((g) => g.label).join(' + ') || '(custom)'
    addLog(`Gaya (${styleMode === 'manual' ? 'manual/prompt' : `${selectedGenres.length} preset`}): ${styleLabel}`)
    if (lyrics.trim()) addLog(`Lirik: ${lyrics.trim().slice(0, 80)}... (${lyrics.trim().length} char)`)

    const startTime = Date.now()
    const logId = currentUser ? await logGenerationStart({
      page: 'song-cover',
      provider: 'runninghub',
      model: 'AI Song Cover Studio',
      prompt: finalStyle.slice(0, 500),
      credits: CREDIT_COST,
      slot_count: 1,
    }) : null

    try {
      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = await submitRunningHubSongCover({
            audioFile,
            stylePrompt: finalStyle,
            lyrics: lyrics.trim() || undefined,
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
          }, 1800000, key, 'AI Song Cover (RunningHub)')
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
      const tid = submittedTaskId || `song-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      persistResultToR2(tid, url)
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ AI Song Cover selesai!', 'success')
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

  const canRun = !!apiKey && !!audioFile && !loading && (!!composedStyle || !!lyrics.trim())
  const resultKind = resultUrl ? mediaKind(resultUrl) : null

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
        title="🎵 AI Song Cover Studio"
        desc="Ubah lagu apa pun menjadi versi cover dengan gaya bebas. Upload audio (mp3/wav), pilih gaya aransemen atau tulis sendiri, isi lirik bila perlu — AI membuat cover berkualitas studio."
      />

      {/* Feature badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['🎼 Upload Audio', '🎨 Gaya Bebas', '📝 Lirik Custom', '🎙️ Vokal Studio', '⚡ Fast Render', `💠 ${CREDIT_COST} kredit`].map((badge) => (
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
        <Section title="🎧 Input" className="!p-6">
          {/* Audio Upload */}
          <div className="mb-4">
            <Label className="mb-2 block">🎵 File Audio Lagu Asli</Label>
            {audioFile ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-surface-secondary">
                  <FileAudio className="h-8 w-8 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{audioFile.name}</div>
                    <div className="text-xs text-muted-foreground">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <button onClick={removeFile} className="p-1.5 rounded-full hover:bg-red-500/20 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {audioPreviewUrl && <audio src={audioPreviewUrl} controls className="w-full p-2" />}
              </div>
            ) : (
              <div onClick={() => audioPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><Music className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret file audio di sini</div>
                <div className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A, FLAC, OGG — max 50MB</div>
              </div>
            )}
            <input ref={audioPickerRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
          </div>

          {/* Gaya Aransemen: preset atau manual/prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">🎨 Gaya Aransemen</Label>
            <div className="inline-flex rounded-lg bg-surface-secondary p-0.5 mb-3">
              <button
                onClick={() => setStyleMode('preset')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  styleMode === 'preset'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Pilih Preset
              </button>
              <button
                onClick={() => setStyleMode('manual')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  styleMode === 'manual'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tulis Manual / Prompt
              </button>
            </div>

            {styleMode === 'preset' ? (
              <>
                <div className="text-[11px] text-muted-foreground mb-2">Pilih 1–3 genre, bisa digabung. Tambahkan detail di kolom prompt bila perlu.</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {GENRE_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setGenreCat(c.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                        genreCat === c.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <input
                  value={genreSearch}
                  onChange={(e) => setGenreSearch(e.target.value)}
                  className="w-full px-3 py-1.5 mb-2 rounded-lg bg-surface-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="🔍 Cari genre (mis. djent, amapiano, koplo)..."
                />
                {selectedGenres.some((g) => !visibleGenres.some((v) => v.id === g.id)) && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedGenres.filter((g) => !visibleGenres.some((v) => v.id === g.id)).map((g) => (
                      <span key={g.id} className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[11px]">✓ {g.label}</span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                  {visibleGenres.length === 0 && (
                    <div className="col-span-full text-center text-xs text-muted-foreground py-6">Genre tidak ditemukan. Coba kata kunci lain.</div>
                  )}
                  {visibleGenres.map((p) => {
                    const active = selected.includes(p.id)
                    const idx = selected.indexOf(p.id)
                    return (
                      <button
                        key={p.id}
                        onClick={() => togglePreset(p)}
                        className={`relative px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {p.label}
                        {active && (
                          <span className="absolute top-1 right-1 text-[10px] bg-black/25 rounded-full h-4 w-4 flex items-center justify-center">{idx + 1}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Terpilih {selected.length}/3{selectedGenres.length > 0 && ` — ${selectedGenres.map((g) => g.label).join(' + ')}`}
                </div>
                <div className="mt-3">
                  <Label className="mb-1.5 block text-xs">✏️ Prompt Tambahan (opsional)</Label>
                  <textarea
                    value={extraPrompt}
                    onChange={(e) => setExtraPrompt(e.target.value)}
                    className="w-full h-20 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="Detail tambahan: tempo/BPM, instrumen, bahasa vokal, mood, referensi artis..."
                  />
                </div>
              </>
            ) : (
              <>
                <textarea
                  value={extraPrompt}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                  className="w-full h-36 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Tulis gaya aransemen atau prompt bebas. Contoh: dangdut koplo modern, kendang cepat, suling ceria, bass dalam, vokal pria, tempo 130 BPM..."
                />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Teks ini langsung dikirim sebagai gaya aransemen. Bisa dipakai tanpa memilih preset, dan tetap bisa digabung dengan pilihan vokal serta lirik.
                </div>
              </>
            )}
          </div>

          {/* Vocal */}
          <div className="mb-4">
            <Label className="mb-2 block">🎙️ Suara Vokal</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {VOCALS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVocal(v.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    vocal === v.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lyrics */}
          <div className="mb-4">
            <Label className="mb-2 block">📝 Lirik (opsional)</Label>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              className="w-full h-32 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
              placeholder={'Tempel lirik lagu di sini (boleh dengan penanda verse/chorus)...'}
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
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : `🚀 Buat Song Cover (${CREDIT_COST} cr)`}
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
                <Loader2 className="h-4 w-4 animate-spin" /> Mengunggah & submit...
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
                {audioFile && (
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
                {resultKind === 'audio' && (
                  <div className="p-4 bg-surface-secondary">
                    <audio src={resultUrl} controls className="w-full" />
                  </div>
                )}
                {resultKind === 'video' && <video src={resultUrl} controls className="w-full" />}
                {resultKind === 'image' && <img src={resultUrl} alt="Song cover result" className="w-full" />}
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a
                    href={resultUrl}
                    download
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Music className="h-12 w-12" />} title="Belum ada hasil" description="Upload audio, pilih gaya, lalu klik Buat Song Cover." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    <Music className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground font-mono truncate">{h.taskId?.slice(0, 15)}...</span>
                    {h.url && <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">buka</a>}
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
