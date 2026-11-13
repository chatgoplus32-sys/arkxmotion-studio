import { useState, useRef, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, Sparkles, CheckCircle2, AlertCircle, Clock, ArrowUpFromLine, Video as VideoIcon, X } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import {
  getPosbotSpec,
  buildPosbotPayload,
  generateWithPosbot,
  formatPosbotRupiah,
} from '@/lib/posbot'
import { fetchPosbotWallet, chargePosbotWallet, refundPosbotWallet, type PosbotWallet } from '@/lib/posbotWallet'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'
import { uploadToCatbox, compressVideo } from '@/lib/roboneo'

const SPEC = getPosbotSpec('upscale_video')!
const MAX_VIDEO_MB = 30

export default function UpscaleVideoPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [fps, setFps] = useState<60 | 30>(60)

  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PosbotWallet | null>(null)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level?: string }>>([])

  const videoInputRef = useRef<HTMLInputElement>(null)

  const addLog = useCallback((msg: string, level?: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString('id-ID'), msg, level }].slice(-200))
  }, [])
  const clearLogs = () => setLogs([])

  useEffect(() => {
    if (!authToken) return
    fetchPosbotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
  }, [authToken])

  const handleVideoSelect = (file: File) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.onloadedmetadata = () => {
      setVideoDuration(el.duration)
      URL.revokeObjectURL(url)
      if (el.duration > 30) {
        addToast(`⚠️ Video ${el.duration.toFixed(1)} detik melebihi batas 30 detik.`, 'warning')
      }
    }
    el.onerror = () => URL.revokeObjectURL(url)
    el.src = url
    setVideoFile(file)
  }

  const enough = isAdmin || !wallet || (wallet.balance ?? 0) >= SPEC.price
  const videoOk = !!videoFile && (videoDuration == null || videoDuration <= 30) && videoFile.size <= MAX_VIDEO_MB * 1024 * 1024
  const canRun = videoOk && !!authToken && !loading && enough

  const runUpscale = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai Upscale Video.', 'warning')
      return
    }
    if (!videoFile) {
      addToast('⚠️ Upload video dulu!', 'warning')
      return
    }
    if (videoDuration != null && videoDuration > 30) {
      addToast('⚠️ Video maksimal 30 detik.', 'warning')
      return
    }
    if (videoFile.size > MAX_VIDEO_MB * 1024 * 1024) {
      addToast(`⚠️ Video terlalu besar (maks ${MAX_VIDEO_MB}MB).`, 'warning')
      return
    }
    if (!isAdmin && wallet && (wallet.balance ?? 0) < SPEC.price) {
      const msg = `Saldo PosBot tidak cukup (${formatPosbotRupiah(wallet.balance ?? 0)}, butuh ${formatPosbotRupiah(SPEC.price)}). Top up di halaman Top Up PosBot.`
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
      page: 'upscale-video',
      model: SPEC.label,
      prompt: 'Upscale Video',
      provider: 'posbot',
    })
    const startTime = Date.now()

    addLog(`⏫ Upscale Video — ${SPEC.label} (${formatPosbotRupiah(SPEC.price)}) · fps ${fps}`, 'info')

    // Upload dulu — PosBot butuh URL publik; saldo baru dipotong setelahnya.
    // Video besar dikompres otomatis (quality dipertahankan sebisa mungkin).
    let uploadFile = videoFile
    try {
      if (videoFile.size > 6 * 1024 * 1024) {
        const ok = window.confirm(`Video berukuran ${(videoFile.size / 1024 / 1024).toFixed(1)}MB.\n\nKlik OK untuk mengompres video otomatis sebelum diupload.`)
        if (!ok) {
          removeActiveTask(trackId)
          setLoading(false)
          return
        }
        addLog('🗜️ Mengompres video…', 'info')
        uploadFile = await compressVideo(videoFile, 6, (msg, pct) => {
          setStatusText(`Kompres video ${pct != null ? Math.round(pct) + '%' : msg}`)
        })
        addLog(`✅ Kompres selesai: ${(uploadFile.size / 1024 / 1024).toFixed(1)}MB`, 'success')
      }

      setStatusText('Upload video...')
      var videoUrl = await uploadToCatbox(uploadFile, 'video', (msg, pct) => {
        setStatusText(pct != null ? `Upload video ${Math.round(pct)}%` : `Upload video ${msg}`)
      })
      addLog(`✅ Video terupload: ${videoUrl.slice(0, 60)}`, 'success')
    } catch (e: any) {
      setError(e?.message || 'Gagal upload video')
      setTaskStatus('error')
      addLog(`❌ Upload gagal: ${e?.message || e}`, 'error')
      removeActiveTask(trackId)
      setLoading(false)
      return
    }

    // Validasi kontrak model SEBELUM saldo dipotong.
    try {
      buildPosbotPayload(SPEC, { videoUrl, fps })
    } catch (e: any) {
      setError(e.message || 'Input tidak valid')
      setTaskStatus('error')
      addLog(`❌ ${e.message || 'Input tidak valid'}`, 'error')
      removeActiveTask(trackId)
      setLoading(false)
      return
    }

    const logId = await logGenerationStart({
      page: 'upscale-video',
      provider: 'posbot',
      model: SPEC.id,
      prompt: `Upscale Video fps=${fps}`,
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
            const charge = await chargePosbotWallet(authToken, SPEC.id, 1)
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
              spec: SPEC,
              videoUrl,
              fps,
              onLog: addLog,
              onStatus: (text, pct) => setStatusText(`${text} ${Math.round(pct || 0)}%`),
            })
            return { url }
          } catch (slotErr: any) {
            if (batchId && authToken) {
              const refunded = await refundPosbotWallet(authToken, { batch_id: batchId })
              if (refunded != null) {
                setWallet((w) => (w ? { ...w, balance: refunded } : w))
                addLog(`↩️ Saldo dikembalikan (refund) ✓ sisa ${formatPosbotRupiah(refunded)}`, 'warn')
              }
            }
            if (detectTokenError('posbot', slotErr)) throw slotErr
            return { error: slotErr?.message || 'Upscale Video gagal' }
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
      if (!outcome?.url) throw new Error(outcome?.error || rotation.error || 'Upscale Video gagal')

      const url = outcome.url
      setResultUrl(url)
      setTaskStatus('success')
      setStatusText('')
      addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
      addResult({
        id: `upscale-video-${Date.now()}`,
        url,
        prompt: `Upscale Video fps=${fps}`,
        date: new Date().toISOString(),
        page: 'upscale-video',
        kind: 'video',
        provider: 'posbot',
        model: SPEC.label,
      })
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ Upscale Video selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`❌ Gagal: ${e.message || e}`, 'error')
      if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
      addToast(`❌ ${e.message || 'Upscale Video gagal'}`, 'error')
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
        void runUpscale()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="⏫ Upscale Video"
        desc="Perbesar video otomatis 2x/4x mengikuti resolusi sumber (output hingga 4K) dengan mesin Upscale Video PosBot. Video maksimal 30 detik — pilih frame rate 60 atau 30 FPS."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          '🔍 Auto 2x/4x Upscale',
          '🎥 Hingga 4K',
          '⏱️ Maks 30 Detik',
          `💠 ${formatPosbotRupiah(SPEC.price)}/generate`,
        ].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai fitur ini.
        </div>
      )}
      {authToken && !isAdmin && wallet && (wallet.balance ?? 0) < SPEC.price && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Saldo PosBot tidak cukup ({formatPosbotRupiah(wallet.balance ?? 0)}, butuh {formatPosbotRupiah(SPEC.price)}). Top up di halaman <strong>Top Up PosBot</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📝 Input" className="!p-6">
          {/* Video */}
          <div className="mb-4">
            <Label className="mb-2 block">🎬 Video Sumber</Label>
            {videoFile ? (
              <div className="relative rounded-lg border border-border overflow-hidden bg-surface-secondary p-3">
                <video src={URL.createObjectURL(videoFile)} controls className="w-full rounded-md max-h-64 bg-black" />
                <div className="flex items-center gap-2 mt-2">
                  <VideoIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)}MB){videoDuration != null ? ` · ${videoDuration.toFixed(1)} dtk` : ''}</span>
                  <button onClick={() => { setVideoFile(null); setVideoDuration(null) }} className="p-1 rounded-full hover:bg-red-500/80 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => videoInputRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><ArrowUpFromLine className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik untuk upload video</div>
                <div className="text-xs text-muted-foreground mt-1">MP4 / WEBM — maksimal 30 detik, {MAX_VIDEO_MB}MB</div>
              </div>
            )}
            <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])} />
            {videoDuration != null && videoDuration > 30 && (
              <div className="mt-2 text-xs text-red-400">⚠️ Video {videoDuration.toFixed(1)} detik melebihi batas 30 detik.</div>
            )}
          </div>

          {/* FPS */}
          <div className="mb-4">
            <Label className="mb-2 block">🎞️ Frame Rate (FPS)</Label>
            <div className="grid grid-cols-2 gap-2">
              {([60, 30] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFps(value)}
                  className={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-colors ${
                    fps === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="text-sm font-semibold">{value} FPS{value === 60 ? ' (default)' : ''}</span>
                  <span className={`text-[10px] ${fps === value ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}>
                    {value === 60 ? 'Gerak lebih halus — disarankan' : 'Lebih ringan & hemat'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={runUpscale}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Upscale Video'}
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
                <button type="button" onClick={runUpscale} disabled={loading} className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20">Coba lagi</button>
              </span>
            )}
          </div>

          <div className="min-h-[140px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="p-2 bg-black">
                  <video src={resultUrl} controls playsInline className="w-full rounded" />
                </div>
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<ArrowUpFromLine className="h-12 w-12" />} title="Belum ada hasil" description="Upload video, pilih FPS, lalu klik Upscale Video." />
            )}
          </div>
        </Section>
      </div>

      {/* Log Detail */}
      <Section title="🧾 Log Detail" sub={`Total ${logs.length} entri`}>
        <LogDetailActions logs={logs} onClear={clearLogs} />
        <div className="max-h-56 overflow-y-auto space-y-0.5 font-mono text-[11px] bg-surface-secondary/50 rounded-lg p-3 border border-border">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">Log akan muncul saat proses berjalan…</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">[{l.time}]</span>
                <span className={l.level === 'error' ? 'text-red-400' : l.level === 'success' ? 'text-green-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-foreground'}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
      </Section>
    </PageContent>
  )
}
