import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, Music, Sparkles, CheckCircle2, AlertCircle, Clock, Copy, Trash2 } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import {
  posbotModelsByCategory,
  buildPosbotPayload,
  generateWithPosbot,
  formatPosbotRupiah,
  type PosbotModelSpec,
} from '@/lib/posbot'
import { fetchPosbotWallet, chargePosbotWallet, refundPosbotWallet, type PosbotWallet } from '@/lib/posbotWallet'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'

// Mesin musik PosBot (Suno v6, MiniMax Music 3, Mureka, Lyria, Sonauto, ACE-STEP).
const MODELS = posbotModelsByCategory('music')
const DEFAULT_MODEL = MODELS[0]?.id ?? 'suno_v6'

interface HistoryItem {
  time: string
  jobId: string
  model: string
  prompt: string
  url: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

export default function MusicStudioPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [modelId, setModelId] = useState(DEFAULT_MODEL)
  const [prompt, setPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  const [negativePrompt, setNegativePrompt] = useState('')

  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PosbotWallet | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const spec: PosbotModelSpec = MODELS.find((m) => m.id === modelId) ?? MODELS[0]

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }
  const clearLogs = () => setLogs([])

  useEffect(() => {
    if (!authToken) return
    fetchPosbotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
  }, [authToken])

  const isAdmin = user?.role === 'admin'
  const enough = isAdmin || !wallet || (wallet.balance ?? 0) >= spec.price
  const canRun = !!prompt.trim() && !!authToken && !loading && enough

  const runMusic = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai AI Music Studio.', 'warning')
      return
    }
    if (!prompt.trim()) {
      addToast('⚠️ Tulis deskripsi/tema lagu yang mau dibuat dulu!', 'warning')
      return
    }
    if (!isAdmin && wallet && (wallet.balance ?? 0) < spec.price) {
      const msg = `Saldo PosBot tidak cukup (${formatPosbotRupiah(wallet.balance ?? 0)}, butuh ${formatPosbotRupiah(spec.price)}). Top up di halaman Top Up PosBot.`
      addToast(`⚠️ ${msg}`, 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setTaskStatus('submitting')
    setStatusText('Menyiapkan...')
    setLogs([])

    const trackId = startGenerationTask({
      page: 'music-studio',
      model: spec.label,
      prompt: prompt.trim().slice(0, 500),
      provider: 'posbot',
    })

    const startTime = Date.now()
    const promptText = prompt.trim()
    const lyricsText = spec.lyrics ? lyrics.trim() : ''
    const negativeText = negativePrompt.trim()

    addLog(`🎵 AI Music Studio — ${spec.label} (${formatPosbotRupiah(spec.price)})`, 'info')

    // Validasi kontrak model SEBELUM saldo dipotong supaya input salah tidak
    // memotong rupiah (sama seperti Motion Control).
    try {
      buildPosbotPayload(spec, {
        prompt: promptText,
        lyrics: lyricsText || undefined,
        instrumental: spec.lyrics ? instrumental : undefined,
        negativePrompt: negativeText || undefined,
      })
    } catch (e: any) {
      setError(e.message || 'Input tidak valid')
      setTaskStatus('error')
      addLog(`❌ ${e.message || 'Input tidak valid'}`, 'error')
      removeActiveTask(trackId)
      setLoading(false)
      return
    }

    const logId = await logGenerationStart({
      page: 'music-studio',
      provider: 'posbot',
      model: spec.id,
      prompt: promptText.slice(0, 500),
      credits: 0,
      slot_count: 1,
    })

    try {
      const rotation = await withTokenRotation<{ url?: string; error?: string }>(
        'posbot',
        async (apiKey) => {
          let batchId: string | null = null
          let chargeId: number | null = null
          if (!isAdmin && authToken) {
            const charge = await chargePosbotWallet(authToken, spec.id, 1)
            batchId = charge.batchId
            chargeId = charge.usageId ?? null
            setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
            addLog(`💰 ${formatPosbotRupiah(charge.deducted)} dipotong · sisa ${formatPosbotRupiah(charge.balance)}`, 'info')
          }

          try {
            setTaskStatus('running')
            setStatusText('Submit ke PosBot...')
            const url = await generateWithPosbot({
              apiKey,
              chargeId,
              spec,
              prompt: promptText,
              lyrics: lyricsText || undefined,
              instrumental: spec.lyrics ? instrumental : undefined,
              negativePrompt: negativeText || undefined,
              onLog: addLog,
              onStatus: (text, pct) => setStatusText(`${text} ${Math.round(pct || 0)}%`),
            })
            return { url }
          } catch (slotErr: any) {
            // Gagal → kembalikan saldo yang sudah dipotong.
            if (batchId && authToken) {
              const refunded = await refundPosbotWallet(authToken, { batch_id: batchId })
              if (refunded != null) {
                setWallet((w) => (w ? { ...w, balance: refunded } : w))
                addLog(`↩️ Saldo dikembalikan (refund) ✓ sisa ${formatPosbotRupiah(refunded)}`, 'warn')
              }
            }
            // Kunci mati / saldo upstream → rotasi ke key berikutnya; kegagalan
            // lain (mis. moderasi konten) langsung hentikan tanpa ganti kunci.
            if (detectTokenError('posbot', slotErr)) throw slotErr
            return { error: slotErr?.message || 'AI Music Studio gagal' }
          }
        },
        {
          allowServerKey: true,
          onKeySwitch: (from, to, attempt) => {
            addLog(`🔄 Kunci "${from.name || from.id}" gagal, pindah ke key #${attempt}: "${to.name || to.id}"`, 'warn')
          },
          onError: (err, key) => {
            if (detectTokenError('posbot', err)) addLog(`⚠️ Key "${key.name || key.id}" bermasalah: ${err.message}`, 'warn')
          },
        },
      )

      const outcome = rotation.ok ? rotation.result : undefined
      if (!outcome?.url) throw new Error(outcome?.error || rotation.error || 'AI Music Studio gagal')

      const url = outcome.url
      setResultUrl(url)
      setTaskStatus('success')
      setStatusText('')
      addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
      const tid = `music-studio-${Date.now()}`
      addResult({
        id: tid,
        url,
        prompt: promptText.slice(0, 500),
        date: new Date().toISOString(),
        page: 'music-studio',
        kind: 'audio',
        provider: 'posbot',
        model: spec.label,
      })
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), jobId: tid, model: spec.label, prompt: promptText, url },
        ...prev,
      ])
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ AI Music Studio selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`❌ Gagal: ${e.message || e}`, 'error')
      if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
      addToast(`❌ ${e.message || 'AI Music Studio gagal'}`, 'error')
    } finally {
      removeActiveTask(trackId)
      setLoading(false)
    }
  }

  const pageActive = usePageActive()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault()
        void runMusic()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="🎵 AI Music Studio"
        desc="Buat lagu lengkap dengan vokal dan musik memakai mesin PosBot — Suno v6, MiniMax Music, Mureka, Lyria, Sonauto, ACE-STEP. Tulis tema atau tempel lirik, lalu generate."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          '🎼 Lagu Lengkap + Vokal',
          '🎤 Lirik Kustom atau Otomatis',
          '🔗 Hasil Permanen (CDN)',
          `💠 ${formatPosbotRupiah(spec.price)}/generate`,
        ].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai fitur ini.
        </div>
      )}
      {authToken && !isAdmin && wallet && (wallet.balance ?? 0) < spec.price && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Saldo PosBot tidak cukup ({formatPosbotRupiah(wallet.balance ?? 0)}, butuh {formatPosbotRupiah(spec.price)}). Top up di halaman <strong>Top Up PosBot</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📝 Input" className="!p-6">
          {/* Model picker */}
          <div className="mb-4">
            <Label className="mb-2 block">🎚️ Pilih Mesin Musik</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={`flex flex-col items-start px-2.5 py-2 rounded-lg text-left transition-colors ${
                    modelId === m.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="text-[12px] font-medium leading-tight truncate w-full">{m.label}</span>
                  <span className={`text-[10px] ${modelId === m.id ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}>
                    {formatPosbotRupiah(m.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt / tema */}
          <div className="mb-4">
            <Label className="mb-2 block">🎼 Deskripsi / Tema Lagu</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-28 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Contoh: pop akustik Indonesia tentang hujan di kota, nuansa hangat, vokal perempuan lembut..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{prompt.trim().length} / {spec.promptMax} karakter</div>
          </div>

          {/* Lyrics + instrumental (hanya model yang mendukung lirik) */}
          {spec.lyrics && (
            <>
              <div className="mb-4">
                <Label className="mb-2 block">
                  🎤 Lirik <span className="text-muted-foreground font-normal">(opsional — kosongkan agar AI menulis lirik)</span>
                </Label>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  className="w-full h-28 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Tempel lirik di sini, mis. dengan penanda [Verse] / [Chorus]..."
                />
              </div>
              <label className="mb-4 flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={instrumental}
                  onChange={(e) => setInstrumental(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-surface-secondary"
                />
                Instrumen saja (tanpa vokal)
              </label>
            </>
          )}

          {/* Negative prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">🚫 Hindari (opsional)</Label>
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="mis. autotune berlebihan, suara sumbang"
            />
          </div>

          <Button
            onClick={runMusic}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Buat Lagu'}
          </Button>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && (
              <span className="text-sm text-muted-foreground">Belum ada generate yang dijalankan.</span>
            )}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Menyiapkan...
              </span>
            )}
            {taskStatus === 'running' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Clock className="h-4 w-4 animate-spin" /> {statusText || 'Memproses...'}
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
                <button
                  type="button"
                  onClick={runMusic}
                  disabled={loading}
                  className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20"
                >
                  Coba lagi
                </button>
              </span>
            )}
          </div>

          <div className="min-h-[140px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="p-4 bg-surface-secondary">
                  <audio src={resultUrl} controls className="w-full" />
                </div>
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Music className="h-12 w-12" />} title="Belum ada hasil" description="Pilih mesin, tulis tema/lirik, lalu klik Buat Lagu." />
            )}
          </div>

          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    <Music className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground">{h.model}</span>
                    <span className="text-muted-foreground truncate flex-1">{h.prompt}</span>
                    <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">buka</a>
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
