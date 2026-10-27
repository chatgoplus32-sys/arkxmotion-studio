import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, Volume2, Sparkles, CheckCircle2, AlertCircle, Clock, Copy, Trash2 } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { submitNexabot, pollNexabotJob, downloadNexabotResult, runWithNexabotThrottleRetry } from '@/lib/nexabot'
import { runNexabotJobWithSessionFallback } from '@/pages/image-to-video/nexabotSessionFallback'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { fetchNexabotWallet, chargeNexabotWallet, refundNexabotWallet, type NexabotWallet } from '@/lib/nexabotWallet'
import { uploadBlobToCdn } from '@/lib/cdn'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'

// Voice default NexaBot — salah satu nama dari daftar voice resmi
// (GET /api/v1/modes → voices). Sama dengan NEXABOT_DEFAULT_VOICE ImageToVideo.
const DEFAULT_VOICE = 'Achernar'

// Daftar voice resmi NexaBot (docs: default Achernar) — statis, jarang berubah.
const VOICES = [
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
  'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
  'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
]

interface HistoryItem {
  time: string
  jobId: string
  voice: string
  url: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

export default function VoiceOverPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [prompt, setPrompt] = useState('')
  const [voice, setVoice] = useState(DEFAULT_VOICE)
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<NexabotWallet | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const nbChargeRef = useRef<{ usageId: number | null } | null>(null)

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }
  const clearLogs = () => setLogs([])

  useEffect(() => {
    if (!authToken) return
    fetchNexabotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
  }, [authToken])

  const isAdmin = user?.role === 'admin'
  const canRun = !!prompt.trim() && !!authToken && !loading &&
    (isAdmin || !!wallet?.unlimited.active || (wallet?.balance ?? 0) >= (wallet?.price ?? 250))

  const runTts = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai Voice Over.', 'warning')
      return
    }
    if (!prompt.trim()) {
      addToast('⚠️ Tulis teks yang mau dijadikan suara dulu!', 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setTaskStatus('submitting')
    setStatusText('Menyiapkan...')
    setLogs([])
    nbChargeRef.current = null
    const trackId = startGenerationTask({
      page: 'voice-over',
      model: `Voice Over · ${voice}`,
      prompt: prompt.trim().slice(0, 500),
      provider: 'nexabot',
    })

    const startTime = Date.now()
    addLog(`🎙️ Voice Over NexaBot — voice: ${voice}, ${prompt.trim().length} karakter`)

    const logId = await logGenerationStart({
      page: 'voice-over',
      provider: 'nexabot',
      model: `tts · ${voice}`,
      prompt: prompt.trim().slice(0, 500),
      credits: 0,
      slot_count: 1,
    })

    try {
      // [1/3] Potong saldo (gratis kalau admin / paket Unlimited aktif).
      if (authToken && !isAdmin) {
        const charge = await chargeNexabotWallet(authToken, 'tts')
        nbChargeRef.current = { usageId: charge.usageId }
        setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
        addLog(charge.unlimited
          ? `[1/3] 🎟️ Paket Unlimited aktif — generate ini gratis`
          : `[1/3] 💰 Saldo terpotong ${new Intl.NumberFormat('id-ID').format(charge.deducted)} ✓`, 'success')
      } else if (isAdmin) {
        addLog(`[1/3] ⚡ Admin mode — skip saldo`, 'info')
      }

      const rotation = await withTokenRotation<string>(
        'nexabot',
        async (apiKey, keyInfo) => {
          return await runNexabotJobWithSessionFallback<string>(
            async (auth, via) => {
              addLog(`[2/3] 🚀 Submit TTS via ${via}...`, 'info')
              setTaskStatus('running')
              setStatusText('Submit ke NexaBot...')

              const submit = await runWithNexabotThrottleRetry(() => submitNexabot({
                mode: 'tts',
                prompt: prompt.trim(),
                voice,
              }, auth, {
                onRetry: ({ status, delayMs }) => {
                  addLog(`⏳ NexaBot sibuk (HTTP ${status}) — submit diulang dalam ${Math.ceil(delayMs / 1000)}s...`, 'warn')
                },
              }), {
                onThrottle: (waitSeconds) => {
                  addLog(`⏳ Server NexaBot sedang dibatasi upstream — menunggu ${waitSeconds}s lalu submit otomatis...`, 'warn')
                  setStatusText(`Server sibuk — menunggu ${waitSeconds}s (otomatis)...`)
                },
              })
              if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot submit gagal')

              addLog(`✅ Task created ✓ id=${submit.jobId.slice(0, 20)}...`, 'success')
              setStatusText('Membuat suara di NexaBot...')

              await pollNexabotJob(submit.jobId, auth, (msg) => {
                addLog(msg, 'debug')
                setStatusText(msg)
              }, {
                onRetry: ({ status, delayMs, message }) => {
                  addLog(`⏳ NexaBot ${message}${status ? ` (HTTP ${status})` : ''} — coba lagi dalam ${Math.ceil(delayMs / 1000)}s...`, 'warn')
                },
              })

              setStatusText('Mengunduh hasil...')
              const dl = await downloadNexabotResult(submit.jobId, auth)
              if (!dl.ok || !dl.url) throw new Error(dl.error || 'NexaBot download gagal')

              let finalUrl = dl.url
              if (dl.url.startsWith('blob:')) {
                try {
                  addLog(`[3/3] 📤 Menyimpan hasil permanen ke CDN...`, 'info')
                  const blobRes = await fetch(dl.url)
                  const blob = await blobRes.blob()
                  const up = await uploadBlobToCdn(blob, `nexabot-tts-${submit.jobId}.mp3`, (pct) => {
                    setStatusText(`Upload CDN ${pct}%...`)
                  })
                  if (up.ok && up.url) {
                    finalUrl = up.url
                    addLog(`[3/3] 📤 Hasil tersimpan permanen ✓`, 'success')
                  } else {
                    addLog(`[3/3] ⚠️ Simpan permanen gagal (${up.error}), pakai URL sementara`, 'warn')
                  }
                } catch (e: any) {
                  addLog(`[3/3] ⚠️ Simpan permanen gagal (${e.message}), pakai URL sementara`, 'warn')
                }
              }
              return finalUrl
            },
            {
              sessionCookies: keyInfo?.cookies,
              apiKey,
              keyId: keyInfo.id,
              hooks: { log: addLog, notify: addToast },
            }
          )
        },
        {
          onKeySwitch: (from, to, attempt) => {
            const msg = `🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`
            addLog(msg, 'warn')
          },
          onError: (err, key) => {
            if (detectTokenError('nexabot', err)) {
              addLog(`⚠️ Key "${key.name}" bermasalah: ${err.message}`, 'warn')
            }
          },
        },
      )

      const url = rotation.ok && rotation.result ? rotation.result : null
      if (!url) throw new Error(rotation.error || 'Generation failed')

      setResultUrl(url)
      setTaskStatus('success')
      setStatusText('')
      addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
      const tid = `tts-${Date.now()}`
      addResult({
        id: tid,
        url,
        prompt: prompt.trim().slice(0, 500),
        date: new Date().toISOString(),
        page: 'voice-over',
        kind: 'audio',
        provider: 'nexabot',
        model: `Voice Over · ${voice}`,
      })
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), jobId: tid, voice, url },
        ...prev,
      ])
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ Voice Over selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`❌ Gagal: ${e.message || e}`, 'error')
      // Generate gagal → kembalikan saldo yang sudah terpotong.
      if (authToken && nbChargeRef.current?.usageId && !isAdmin) {
        const refunded = await refundNexabotWallet(authToken, nbChargeRef.current.usageId)
        if (refunded !== null) {
          setWallet((w) => (w ? { ...w, balance: refunded } : w))
          addLog(`↩️ Saldo dikembalikan (refund) ✓`, 'success')
        }
      }
      if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
      addToast(`❌ ${e.message || 'Voice Over gagal'}`, 'error')
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
        void runTts()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="🎙️ Voice Over"
        desc="Ubah teks menjadi suara natural dengan NexaBot TTS. Pilih salah satu dari 30 voice resmi, tempel teksnya, lalu generate — hasil siap dipakai untuk voiceover video."
      />

      {/* Feature badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['🗣️ 30 Voice Resmi', '⚡ ±8 Detik/Generate', '🔗 Hasil Permanen (CDN)', `💠 ${new Intl.NumberFormat('id-ID').format(wallet?.price ?? 250)}/generate`].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai fitur ini.
        </div>
      )}
      {authToken && !isAdmin && wallet && !wallet.unlimited.active && wallet.balance < wallet.price && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Saldo NexaBot tidak cukup ({new Intl.NumberFormat('id-ID').format(wallet.balance)}). Top up atau ambil Paket Unlimited di halaman <strong>Top Up NexaBot</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📝 Input" className="!p-6">
          {/* Voice picker */}
          <div className="mb-4">
            <Label className="mb-2 block">🗣️ Pilih Voice <span className="text-muted-foreground font-normal">(default: Achernar)</span></Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {VOICES.map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors truncate ${
                    voice === v
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={v}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">✏️ Teks yang Dibacakan</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-40 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Tulis atau tempel teks di sini. Contoh: Halo, selamat datang di platform kami..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{prompt.trim().length} karakter</div>
          </div>

          <Button
            onClick={runTts}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Buat Voice Over'}
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
                  onClick={runTts}
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
              <EmptyState icon={<Volume2 className="h-12 w-12" />} title="Belum ada hasil" description="Pilih voice, tulis teks, lalu klik Buat Voice Over." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    <Volume2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground truncate">{h.voice}</span>
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
