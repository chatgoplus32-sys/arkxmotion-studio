import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Upload, Download, X, Sparkles, CheckCircle2, AlertCircle, Clock, Clapperboard } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { submitRunningHubVideoUpscale, pollRunningHubTask } from '@/lib/runninghub'
import { SEAVI_VIDEO_UPSCALER, generateWithSeavi, fetchSeaviBalance } from '@/lib/seavi'
import { chargeSeaviWallet, refundSeaviWallet } from '@/lib/seaviWallet'
import { uploadToCatbox } from '@/lib/roboneo'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2 } from '@/lib/backgroundTasks'
import { useLocalStorage } from '@/lib/useLocalStorage'

const SCHEDULERS = [
  'beta',
  'karras',
  'simple',
  'exponential',
  'normal',
  'sgm_uniform',
  'ddim_uniform',
  'linear_quadratic',
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

export default function VideoUpscalerPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string | null>(null)
  const [engine, setEngine] = useState<'runninghub' | 'seavi'>('runninghub')
  const [steps, setSteps] = useLocalStorage('vosr2.steps', 4)
  const [cfg, setCfg] = useLocalStorage('vosr2.cfg', 4.5)
  const [scheduler, setScheduler] = useLocalStorage('vosr2.scheduler', 'beta')
  const [frameCap, setFrameCap] = useLocalStorage('vosr2.frameCap', 0)
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const videoPickerRef = useRef<HTMLInputElement | null>(null)

  const apiKey = getStoredProviderKey(engine === 'seavi' ? 'seavi' : 'runninghub')

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const clearLogs = () => setLogs([])

  const handleVideoSelect = (file: File) => {
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
  }

  const runSeaviUpscale = async () => {
    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    try {
      addLog(`[1/2] 📤 Mengunggah video (${(videoFile!.size / 1024 / 1024).toFixed(1)}MB)...`)
      const videoUrl = await uploadToCatbox(videoFile!, 'video', (msg, pct) => {
        addLog(`${msg}${pct != null ? ` ${pct}%` : ''}`)
      })
      addLog(`[1/2] ✓ Terunggah: ${videoUrl.slice(0, 80)}...`, 'success')

      // Wallet token internal: upscale Seavi = 1 token. Tamu tanpa login
      // tetap bisa memakai key sendiri tanpa potongan.
      const seaviIsAdmin = user?.role === 'admin'
      let seaviBatchId = ''
      if (!seaviIsAdmin && authToken) {
        addLog(`[1/2] 💰 Memotong ${SEAVI_VIDEO_UPSCALER.tokens} token Seavi...`)
        try {
          const charge = await chargeSeaviWallet(authToken, SEAVI_VIDEO_UPSCALER.id, 1)
          seaviBatchId = charge.batchId
          addLog(`[1/2] ✅ Token terpotong ✓ sisa ${charge.tokens} token`, 'success')
        } catch (e: any) {
          throw new Error(e.message || 'Token Seavi tidak cukup. Top up di halaman Top Up Seavi (Rp 4.000 = 2 token).')
        }
      }

      try {
      const rotation = await withTokenRotation<string>(
        'seavi',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const bal = await fetchSeaviBalance(key)
          if (bal.ok && typeof bal.balance === 'number') addLog(`💰 Saldo: ${bal.balance} token`)
          return await generateWithSeavi({
            apiKey: key,
            spec: SEAVI_VIDEO_UPSCALER,
            videoUrls: [videoUrl],
            onLog: (msg, level) => addLog(msg, (level as LogEntry['level']) || 'info'),
            onStatus: (text, pct) => {
              setTaskStatus('running')
              setProgress(pct)
            },
          })
        },
        {
          onKeySwitch: (from, to, attempt) => {
            addLog(`🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`, 'warn')
          },
          onError: (err, key) => {
            addLog(`⚠️ Key "${key.name}" bermasalah: ${err.message}`, 'warn')
          },
        },
      )
      if (!rotation.ok || !rotation.result) throw new Error(rotation.error || 'Upscale gagal')

      const url = rotation.result
      const tid = `seavi-upscale-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      persistResultToR2(tid, url)
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ Video upscale (Seavi) selesai!', 'success')
      } catch (e: any) {
        if (seaviBatchId && authToken && !seaviIsAdmin) {
          addLog(`💸 Refund ${SEAVI_VIDEO_UPSCALER.tokens} token...`, 'warn')
          const refunded = await refundSeaviWallet(authToken, { batch_id: seaviBatchId })
          if (refunded != null) addLog(`✅ Refund berhasil ✓ sisa ${refunded} token`, 'success')
        }
        throw e
      }
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const runWorkflow = async () => {
    if (!apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (!videoFile) {
      addToast('⚠️ Upload video terlebih dahulu!', 'warning')
      return
    }

    if (engine === 'seavi') return runSeaviUpscale()

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    addLog(`Mulai: ${(videoFile!.size / 1024 / 1024).toFixed(1)}MB ${videoFile!.name}`)
    addLog(`Params: steps=${steps} cfg=${cfg} scheduler=${scheduler} frameCap=${frameCap}`)

    try {
      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = await submitRunningHubVideoUpscale({
            videoFile: videoFile!,
            steps,
            cfg,
            scheduler,
            frameLoadCap: frameCap,
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

      const url = rotation.result
      const tid = submittedTaskId || `upscale-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      if ((rotation.triedKeys || 1) > 1) {
        addLog(`Dipakai key "${rotation.usedKey?.name}" setelah ${rotation.triedKeys} percobaan`)
      }
      // URL RunningHub kedaluwarsa 24 jam — simpan permanen ke R2
      persistResultToR2(tid, url)
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ Video upscale 2K selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const canRunUpscale = !!apiKey && !!videoFile && !loading

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRunUpscale) {
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
        title="⬆️ Video Upscaler 2K"
        desc="Tingkatkan video ke kualitas lebih stabil & tajam — pilih engine RunningHub (VOSR2 2K bertingkat) atau Seavi (Upscale Video S7)."
      />

      {!apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="🎬 Input" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">Video</Label>
            {videoFile ? (
              <div className="rounded-lg border border-border overflow-hidden bg-surface-secondary">
                <video src={videoPreview || undefined} controls className="w-full max-h-64" />
                <div className="flex items-center gap-2 p-2">
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)}MB)
                  </span>
                  <button onClick={() => { setVideoFile(null); setVideoPreview(null) }} className="p-1 rounded-full hover:bg-red-500/80 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => videoPickerRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><Clapperboard className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik atau seret video di sini</div>
                <div className="text-xs text-muted-foreground mt-1">MP4, WEBM, MOV</div>
              </div>
            )}
            <input ref={videoPickerRef} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])} />
          </div>

          <div className="mb-4">
            <Label>Engine</Label>
            <div className="flex gap-2">
              {([['runninghub', 'RunningHub (VOSR2)'], ['seavi', 'Seavi (S7)']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  disabled={loading}
                  onClick={() => setEngine(v)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${engine === v ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/40'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {engine === 'runninghub' && (
          <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <Label>Steps</Label>
              <input
                type="number"
                min={1}
                max={50}
                value={steps}
                onChange={(e) => setSteps(Math.max(1, Math.min(50, Number(e.target.value) || 4)))}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <Label>CFG</Label>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={cfg}
                onChange={(e) => setCfg(Math.max(0, Math.min(30, Number(e.target.value) || 4.5)))}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="mb-4">
            <Label>Scheduler</Label>
            <Select
              value={scheduler}
              onChange={(e) => setScheduler(e.target.value)}
              options={SCHEDULERS.map((s) => ({ value: s, label: s }))}
            />
          </div>

          <div className="mb-4">
            <Label>Frame Load Cap (0 = tanpa batas)</Label>
            <input
              type="number"
              min={0}
              max={10000}
              value={frameCap}
              onChange={(e) => setFrameCap(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          </>
          )}

          <Button
            onClick={runWorkflow}
            disabled={loading || !apiKey || !videoFile}
            className="w-full"
            size="lg"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : '🚀 Jalankan Upscale'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Default workflow: 4 Steps · CFG 4.5 · scheduler beta. Upscale 2K bisa memakan waktu lama untuk video panjang.
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
                {videoFile && (
                  <button
                    type="button"
                    onClick={runWorkflow}
                    disabled={loading}
                    className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20"
                    aria-label="Coba lagi dengan file yang sama"
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
                <video src={resultUrl} controls className="w-full" />
                <div className="p-2 text-center">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download Video 2K
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Sparkles className="h-12 w-12" />} title="Belum ada hasil" description="Video 2K akan muncul di sini setelah proses selesai." />
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
            <div className="text-muted-foreground px-1 py-2">Belum ada log. Jalankan upscale untuk melihat detail proses.</div>
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
