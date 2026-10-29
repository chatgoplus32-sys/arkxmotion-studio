import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, Music, Sparkles, CheckCircle2, AlertCircle, Clock, Copy, Trash2 } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { submitNexabot, pollNexabotJob, downloadNexabotResult, saveNexabotResult, runWithNexabotThrottleRetry, NexabotResultError } from '@/lib/nexabot'
import { runNexabotJobWithSessionFallback } from '@/pages/image-to-video/nexabotSessionFallback'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { fetchNexabotWallet, chargeNexabotWallet, refundNexabotWallet, NEXABOT_PRICE_FALLBACK, type NexabotWallet } from '@/lib/nexabotWallet'
import { useProviderManager } from '@/stores/providerManager'
import { uploadBlobToCdn } from '@/lib/cdn'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'

interface HistoryItem {
  time: string
  jobId: string
  prompt: string
  url: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

export default function MusicGeneratorPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [prompt, setPrompt] = useState('')
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
    (isAdmin || !!wallet?.unlimited.active || (wallet?.balance ?? 0) >= (wallet?.price ?? NEXABOT_PRICE_FALLBACK))

  const runMusic = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai Music Generator.', 'warning')
      return
    }
    if (!prompt.trim()) {
      addToast('⚠️ Tulis deskripsi musik yang mau dibuat dulu!', 'warning')
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
      page: 'music-generator',
      model: 'Music Generator',
      prompt: prompt.trim().slice(0, 500),
      provider: 'nexabot',
    })

    const startTime = Date.now()
    const promptText = prompt.trim()
    addLog(`🎵 Music Generator NexaBot — ${promptText.length} karakter prompt`)

    const logId = await logGenerationStart({
      page: 'music-generator',
      provider: 'nexabot',
      model: 'music',
      prompt: promptText.slice(0, 500),
      credits: 0,
      slot_count: 1,
    })

    try {
      // [1/3] Potong saldo (gratis kalau admin / paket Unlimited aktif).
      if (authToken && !isAdmin) {
        const charge = await chargeNexabotWallet(authToken, 'music')
        nbChargeRef.current = { usageId: charge.usageId }
        setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
        addLog(charge.unlimited
          ? `[1/3] 🎟️ Paket Unlimited aktif — generate ini gratis`
          : `[1/3] 💰 Saldo terpotong ${new Intl.NumberFormat('id-ID').format(charge.deducted)} ✓`, 'success')
      } else if (isAdmin) {
        addLog(`[1/3] ⚡ Admin mode — skip saldo`, 'info')
      }

      // Satu job music untuk auth tertentu; jalur kunci server memakai alur
      // submit/poll/download yang sama tanpa API key pribadi.
      const runJob = async (
        apiKey: string | null,
        keyInfo: { id: string; name?: string; cookies?: string } | null,
        viaMaster = false
      ): Promise<string> => {
          return await runNexabotJobWithSessionFallback<string>(
            async (auth, via) => {
              addLog(`[2/3] 🚀 Submit music via ${via}...`, 'info')
              setTaskStatus('running')
              setStatusText('Submit ke NexaBot...')

              const submit = await runWithNexabotThrottleRetry(() => submitNexabot({
                mode: 'music',
                prompt: promptText,
              }, auth, {
                onRetry: ({ status, delayMs, message }) => {
                  addLog(`⏳ ${message} (HTTP ${status}) — submit diulang dalam ${Math.ceil(delayMs / 1000)}s...`, 'warn')
                },
              }), {
                onThrottle: (waitSeconds) => {
                  addLog(`⏳ Server NexaBot sedang dibatasi upstream — menunggu ${waitSeconds}s lalu submit otomatis...`, 'warn')
                  setStatusText(`Server sibuk — menunggu ${waitSeconds}s (otomatis)...`)
                },
              })
              if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot submit gagal')

              addLog(`✅ Task created ✓ id=${submit.jobId.slice(0, 20)}...`, 'success')
              setStatusText('Membuat musik di NexaBot (±25 detik)...')

              await pollNexabotJob(submit.jobId, auth, (msg) => {
                addLog(msg, 'debug')
                setStatusText(msg)
              }, {
                onRetry: ({ status, delayMs, message }) => {
                  addLog(`⏳ NexaBot ${message}${status ? ` (HTTP ${status})` : ''} — coba lagi dalam ${Math.ceil(delayMs / 1000)}s...`, 'warn')
                },
              })

              setStatusText('Menyimpan hasil...')
              addLog(`[3/3] 📤 Menyimpan hasil permanen ke CDN...`, 'info')
              const saved = await saveNexabotResult(submit.jobId, auth, `nexabot-music-${submit.jobId}.wav`)
              if (saved.ok && saved.url) {
                addLog(`[3/3] 📤 Hasil tersimpan permanen ✓`, 'success')
                return saved.url
              }
              addLog(`[3/3] ⚠️ Simpan di server gagal (${saved.error}) — fallback unduh + unggah...`, 'warn')

              const dl = await downloadNexabotResult(submit.jobId, auth)
              if (!dl.ok || !dl.url) throw new NexabotResultError(dl.error || 'NexaBot download gagal')

              let finalUrl = dl.url
              if (dl.url.startsWith('blob:')) {
                try {
                  const blobRes = await fetch(dl.url)
                  const blob = await blobRes.blob()
                  const up = await uploadBlobToCdn(blob, `nexabot-music-${submit.jobId}.wav`, (pct) => {
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
              master: viaMaster,
              // Bukti potong saldo: relay menolak kredensial server tanpa ini.
              ticket: nbChargeRef.current?.usageId ?? null,
              keyId: keyInfo?.id,
              hooks: { log: addLog, notify: addToast },
            }
          )
      }

      let url: string | null = null
      const hasProviderKeys = (useProviderManager.getState().keys.nexabot || []).length > 0
      if (hasProviderKeys) {
        const rotation = await withTokenRotation<string>(
          'nexabot',
          (apiKey, keyInfo) => runJob(apiKey, keyInfo),
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
        url = rotation.ok && rotation.result ? rotation.result : null
        if (!url && !wallet?.server_key?.available) throw new Error(rotation.error || 'Generation failed')
        if (!url) addLog(`⚠️ API key tidak bisa dipakai (${rotation.error}) — beralih ke kunci server`, 'warn')
      }
      if (!url) {
        if (!wallet?.server_key?.available) {
          throw new Error('NexaBot: tidak ada API key dan kunci server belum tersedia — top up NexaBot dulu atau tambahkan API key di halaman Providers.')
        }
        addLog('🏦 Memakai kunci NexaBot milik server — tanpa API key pribadi', 'info')
        url = await runJob(null, null, true)
      }

      setResultUrl(url)
      setTaskStatus('success')
      setStatusText('')
      addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
      const tid = `music-${Date.now()}`
      addResult({
        id: tid,
        url,
        prompt: promptText.slice(0, 500),
        date: new Date().toISOString(),
        page: 'music-generator',
        kind: 'audio',
        provider: 'nexabot',
        model: 'Music Generator',
      })
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), jobId: tid, prompt: promptText, url },
        ...prev,
      ])
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ Music Generator selesai!', 'success')
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
      addToast(`❌ ${e.message || 'Music Generator gagal'}`, 'error')
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
        title="🎵 Music Generator"
        desc="Buat musik orisinal dari deskripsi teks dengan NexaBot. Dari lo-fi sampai orkestral, tulis vibe-nya lalu generate — hasil WAV siap dipakai untuk konten."
      />

      {/* Feature badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['🎼 Musik Orisinal dari Prompt', '⚡ ±25 Detik/Generate', '🔗 Hasil Permanen (CDN)', `💠 ${new Intl.NumberFormat('id-ID').format(wallet?.price ?? NEXABOT_PRICE_FALLBACK)}/generate`].map((badge) => (
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
          {/* Prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">🎼 Deskripsi Musik</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-40 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Jelaskan musik yang mau dibuat. Contoh: lo-fi chill beat santai dengan piano lembut, untuk video healing pagi hari..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{prompt.trim().length} karakter</div>
          </div>

          <Button
            onClick={runMusic}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Buat Musik'}
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
              <EmptyState icon={<Music className="h-12 w-12" />} title="Belum ada hasil" description="Tulis deskripsi musik, lalu klik Buat Musik." />
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
