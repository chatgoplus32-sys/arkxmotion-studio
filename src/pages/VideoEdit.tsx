import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea } from '@/components/ui'
import {
  Upload, Loader2, Download, ExternalLink, X, Clapperboard, Wand2, ZoomIn, ZoomOut,
  Volume2, BookOpen, Lightbulb, Film, Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { useProviderManager, type ProviderKey } from '@/stores/providerManager'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import {
  addResult,
  getResults,
  persistResultToR2,
  removeActiveTask,
  startGenerationTask,
  type CompletedResult,
} from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { notifyGenerationComplete, promptForNotificationsIfNeeded } from '@/lib/notify'
import {
  fetchNexabotWallet,
  chargeNexabotWallet,
  refundNexabotWallet,
  NEXABOT_PRICE_FALLBACK,
  type NexabotWallet,
} from '@/lib/nexabotWallet'
import { formatRp } from '@/lib/payment'
import { compressVideo } from '@/lib/roboneo'
import { precheckProviderBalance } from '@/lib/balancePrecheck'
import { runWithNexabotThrottleRetry, NexabotResultError } from '@/lib/nexabot'
import { runNexabotJobWithSessionFallback } from './image-to-video/nexabotSessionFallback'

interface EditStyle {
  id: string
  label: string
  desc: string
  instruction: string
  icon: LucideIcon
}

const EDIT_STYLES: EditStyle[] = [
  {
    id: 'motion-graphics',
    label: 'Motion Graphics',
    desc: 'Lower-third, kinetic text, callout icon, panah penunjuk.',
    instruction:
      'Overlay clean animated motion graphics: kinetic titles, lower-third labels, icon callouts, animated arrows or circles that highlight the key object, and subtle grid or line accents. Modern, minimal, brand-safe, colors sampled from the footage.',
    icon: Wand2,
  },
  {
    id: 'zoom-in',
    label: 'AE Zoom In',
    desc: 'Push-in halus ke subjek, punch-in di momen penting.',
    instruction:
      'Add After Effects-style camera moves: smooth eased push-ins toward the subject on the strongest moments and quick punch-in cuts on emphasis beats, with slight parallax. Never warp faces or stretch the frame.',
    icon: ZoomIn,
  },
  {
    id: 'zoom-out',
    label: 'AE Zoom Out',
    desc: 'Mulai close-up, reveal penuh di akhir.',
    instruction:
      'Open tight on the subject, then perform a smooth eased zoom-out that reveals the full scene; add a second slow pull-back on the final beat. Keep the horizon stable, no shake.',
    icon: ZoomOut,
  },
  {
    id: 'sfx',
    label: 'SFX Pass',
    desc: 'Whoosh, impact, klik, riser sinkron dengan cut.',
    instruction:
      'Add synchronized sound effects: whoosh on transitions, soft impact on cuts, clicks on on-screen actions, and a short riser before the key moment. SFX should support the original dialogue and ambience, not mask them.',
    icon: Volume2,
  },
  {
    id: 'broll',
    label: 'B-roll Animation',
    desc: 'Sisipan cutaway animasi 1-2 detik yang ilustratif.',
    instruction:
      'Insert animated b-roll cutaways that illustrate the key point: product close-ups, exploded views, icon animations, or diagram snippets. Keep each b-roll 1-2 seconds, match color and lighting, then return to the main footage.',
    icon: Clapperboard,
  },
  {
    id: 'documentary',
    label: 'Dokumenter Explainer',
    desc: 'Push-in sinematik, grain halus, caption nama/tanggal.',
    instruction:
      'Restyle as a documentary explainer: slow cinematic push-ins, subtle film grain, archival-style stills with gentle parallax, lower-third name and date captions, restrained color grade, serious factual tone.',
    icon: BookOpen,
  },
  {
    id: 'explainer',
    label: 'Explainer Animation',
    desc: 'Grafik 2D, ikon, angka, callout bertahap di atas footage.',
    instruction:
      'Turn the key points into animated explainer segments: clean 2D motion graphics, icons, animated charts and labeled callouts over the footage, step-by-step numbered beats, smooth transitions. Educational, clear and friendly.',
    icon: Lightbulb,
  },
]

const RESOLUTIONS = [
  { value: '720', label: '720p — cepat' },
  { value: '1080', label: '1080p — lebih tajam, proses lebih lama' },
]

const RATIOS = ['16:9', '9:16']

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

export default function VideoEditPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ duration: number; width: number; height: number } | null>(null)
  const [selectedStyles, setSelectedStyles] = useState<string[]>(['motion-graphics'])
  const [extra, setExtra] = useState('')
  const [ratio, setRatio] = useState('9:16')
  const [resolution, setResolution] = useState('720')

  const [wallet, setWallet] = useState<NexabotWallet | null>(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState({ text: '', pct: 0 })
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>([])
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<CompletedResult[]>(() => {
    try {
      return getResults().filter((r) => r.page === 'video-edit')
    } catch {
      return []
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const nbChargeRef = useRef<number | null>(null)

  useEffect(() => {
    if (!authToken) { setWallet(null); return }
    let alive = true
    fetchNexabotWallet(authToken).then((w) => { if (alive && w) setWallet(w) })
    return () => { alive = false }
  }, [authToken])

  const addLog = (msg: string, level: 'debug' | 'info' | 'warn' | 'error' | 'success' = 'info') => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString('id-ID'), msg, level }].slice(-120))
  }

  const pickVideo = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      addToast('File harus berupa video (MP4 / WEBM / MOV)', 'error')
      return
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setMeta(null)
  }

  const removeVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(null)
    setVideoUrl(null)
    setMeta(null)
  }

  const toggleStyle = (id: string) => {
    setSelectedStyles((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])
  }

  const prompt = useMemo(() => {
    const chosen = EDIT_STYLES.filter((s) => selectedStyles.includes(s.id))
    if (chosen.length === 0 && !extra.trim()) return ''
    const lines = [
      'Edit the reference video instead of generating a new scene. Keep the same subject, faces, product, wardrobe, location and existing cuts; do not replace the footage.',
    ]
    if (chosen.length > 0) {
      lines.push('Apply these edits:', ...chosen.map((s) => `- ${s.instruction}`))
    }
    if (extra.trim()) lines.push(`Additional direction: ${extra.trim()}`)
    lines.push(
      'Keep the result professional: no warped faces, no distorted hands, no flicker, no unreadable text. If you add on-screen text, use short words in the language spoken in the video and spell them correctly. Keep the original dialogue and ambience audible unless a style says otherwise.'
    )
    return lines.join('\n')
  }, [selectedStyles, extra])

  const runNexabotJob = async (
    mediaBase64: string,
    jobPrompt: string,
    apiKey: string | null,
    keyInfo: ProviderKey | null,
    viaMaster = false
  ): Promise<string> => {
    return runNexabotJobWithSessionFallback<string>(async (auth, via) => {
      const { submitNexabot, pollNexabotJob, saveNexabotResult, downloadNexabotResult } = await import('@/lib/nexabot')

      addLog(`🚀 Submit ke NexaBot (${via})...`)
      setStatus({ text: 'Submit ke NexaBot...', pct: 15 })

      const submit = await runWithNexabotThrottleRetry(
        () => submitNexabot({
          mode: 'r2v',
          prompt: jobPrompt,
          ratio: ratio === '16:9' ? 1 : 2,
          resolution: Number(resolution),
          media: [mediaBase64],
          telegramId: keyInfo?.telegramId,
        }, auth, {
          onRetry: ({ attempt, status: httpStatus, delayMs, message }) => {
            const secs = Math.ceil(delayMs / 1000)
            addLog(`⏳ ${message} (HTTP ${httpStatus}) — ulang dalam ${secs}s (percobaan ${attempt})`, 'warn')
            setStatus({ text: `Mengantre di NexaBot — ${secs}s...`, pct: 15 })
          },
        }),
        {
          onThrottle: (seconds) => {
            addLog(`⏳ Server NexaBot dibatasi upstream — menunggu ${seconds}s lalu submit otomatis`, 'warn')
            setStatus({ text: `Server gambar sibuk — menunggu ${seconds}s...`, pct: 10 })
          },
        }
      )
      if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot menolak submit')
      addLog(`✅ Job dibuat · ${submit.jobId.slice(0, 18)}...`, 'success')
      setStatus({ text: 'Memproses di NexaBot...', pct: 30 })

      let pct = 30
      await pollNexabotJob(submit.jobId, auth, (msg) => {
        pct = Math.min(85, pct + 5)
        setProgress(pct)
        setStatus({ text: msg, pct })
        addLog(msg, 'debug')
      }, {
        onRetry: ({ status: httpStatus, delayMs, message }) => {
          const secs = Math.ceil(delayMs / 1000)
          addLog(`⏳ NexaBot ${message}${httpStatus ? ` (HTTP ${httpStatus})` : ''} — coba lagi dalam ${secs}s...`, 'warn')
        },
      })

      setStatus({ text: 'Menyimpan hasil...', pct: 90 })
      const saved = await saveNexabotResult(submit.jobId, auth, `video-edit-${submit.jobId}.mp4`)
      if (saved.ok && saved.url) return saved.url

      addLog(`⚠️ Simpan permanen gagal (${saved.error || 'tanpa alasan'}) — fallback unduh + CDN`, 'warn')
      const dl = await downloadNexabotResult(submit.jobId, auth)
      if (!dl.ok || !dl.url) throw new NexabotResultError(dl.error || 'Gagal mengunduh hasil NexaBot')
      if (!dl.url.startsWith('blob:')) return dl.url

      try {
        const blob = await (await fetch(dl.url)).blob()
        const { uploadBlobToCdn } = await import('@/lib/cdn')
        const up = await uploadBlobToCdn(blob, `video-edit-${submit.jobId}.mp4`)
        if (up.ok && up.url) return up.url
      } catch (e: any) {
        addLog(`⚠️ Upload CDN gagal (${e.message}) — pakai URL sementara`, 'warn')
      }
      return dl.url
    }, {
      sessionCookies: keyInfo?.cookies,
      apiKey,
      master: viaMaster,
      ticket: nbChargeRef.current,
      keyId: keyInfo?.id,
      hooks: {
        log: (msg, level) => addLog(msg, level),
        notify: (msg, type) => addToast(msg, type),
      },
    })
  }

  const handleGenerate = async () => {
    if (!authToken) { addToast('Login dulu untuk mulai edit', 'error'); return }
    if (!videoFile) { addToast('Upload video sumber dulu', 'error'); return }
    if (!prompt) { addToast('Pilih minimal satu gaya edit', 'error'); return }

    promptForNotificationsIfNeeded()
    setGenerating(true)
    setResultUrl(null)
    setLogs([])
    setProgress(0)
    setStatus({ text: 'Validasi...', pct: 2 })

    const isAdmin = user?.role === 'admin'
    const startTime = Date.now()
    const logId = await logGenerationStart({
      page: 'video-edit',
      provider: 'nexabot',
      model: 'Gemini Omni · Video Edit',
      prompt: prompt.slice(0, 500),
      credits: 0.15,
      slot_count: 1,
    })
    const taskId = startGenerationTask({
      page: 'video-edit',
      model: 'Gemini Omni · Video Edit',
      prompt: prompt.slice(0, 500),
      provider: 'nexabot',
    })

    try {
      const freshWallet = await fetchNexabotWallet(authToken).catch(() => null)
      if (freshWallet) setWallet(freshWallet)
      const serverReady = !!freshWallet?.server_key?.available

      addLog('🎬 Mulai edit video · Gemini Omni (NexaBot)')
      addLog(`   Rasio ${ratio} · Resolusi ${resolution}p · ${selectedStyles.length || 0} gaya dipilih`, 'debug')

      const pre = await precheckProviderBalance('nexabot', 0.15, { serverKey: serverReady })
      if (!pre.ok) throw new Error(pre.error || 'Akses NexaBot belum siap')

      if (!isAdmin) {
        const charge = await chargeNexabotWallet(authToken, 'r2v')
        nbChargeRef.current = charge.usageId
        setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
        addLog(charge.unlimited
          ? '🎟️ Paket Unlimited aktif — generate ini gratis'
          : `💰 Saldo terpotong ${formatRp(charge.deducted)} · sisa ${formatRp(charge.balance)}`, 'success')
      } else {
        addLog('⚡ Admin — skip saldo', 'info')
      }

      setStatus({ text: 'Menyiapkan video...', pct: 5 })
      addLog(`🎬 Mengompres video sumber (${formatSize(videoFile.size)})...`)
      const compressed = await compressVideo(videoFile, 6, (msg, pct) => {
        setStatus({ text: msg, pct: Math.min(10, Math.max(5, pct ?? 5)) })
      })
      if (compressed.size > 6 * 1024 * 1024) {
        throw new Error(`Video masih ${formatSize(compressed.size)} setelah kompresi (maks 6MB). Potong durasinya lalu coba lagi.`)
      }
      const { fileToBase64 } = await import('@/lib/oneover')
      const mediaBase64 = await fileToBase64(compressed)
      addLog(`✅ Video siap dikirim (${formatSize(compressed.size)})`, 'success')
      setProgress(12)

      const keys = useProviderManager.getState().keys.nexabot || []
      const hasActiveKey = keys.some((k) => k.status !== 'invalid' && k.status !== 'expired')

      let url: string | null = null
      if (hasActiveKey) {
        const rotation = await withTokenRotation(
          'nexabot',
          (apiKey, keyInfo) => runNexabotJob(mediaBase64, prompt, apiKey, keyInfo),
          {
            requiredCredits: 0.15,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Pindah key #${attempt}: "${from.name || from.id}" → "${to.name || to.id}"`, 'warn')
            },
            onError: (err, key) => {
              if (detectTokenError('nexabot', err)) {
                addLog(`⚠️ Key "${key.name || key.id}": ${err.message}`, 'warn')
              }
            },
          }
        )
        if (!rotation.ok || !rotation.result) throw new Error(rotation.error || 'Generate gagal')
        url = rotation.result
      } else if (serverReady) {
        addLog('🏦 Memakai kunci NexaBot milik server', 'info')
        url = await runNexabotJob(mediaBase64, prompt, null, null, true)
      } else {
        throw new Error('Belum ada akses NexaBot — top up NexaBot dulu atau tambahkan API key di halaman Providers.')
      }

      setResultUrl(url)
      setProgress(100)
      setStatus({ text: '✅ Selesai', pct: 100 })

      const item: CompletedResult = {
        id: `video-edit-${Date.now()}`,
        url,
        prompt,
        date: new Date().toISOString(),
        page: 'video-edit',
        kind: 'video',
        provider: 'nexabot',
        model: 'Gemini Omni · Video Edit',
        ratio,
        credits: 0.15,
      }
      addResult(item, { notify: false })
      persistResultToR2(item.id, url)
      setHistory(getResults().filter((r) => r.page === 'video-edit'))
      notifyGenerationComplete('Gemini Omni · Video Edit', 'NexaBot')
      addLog('✅ Video edit selesai', 'success')
      addToast('Video edit selesai', 'success')
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
    } catch (err: any) {
      if (nbChargeRef.current && authToken) {
        const refunded = await refundNexabotWallet(authToken, nbChargeRef.current)
        if (refunded != null) {
          setWallet((w) => (w ? { ...w, balance: refunded } : w))
          addLog(`💸 Saldo NexaBot dikembalikan · sisa ${formatRp(refunded)}`, 'warn')
        }
      }
      addLog(`❌ ${err.message}`, 'error')
      addToast(`Gagal: ${err.message}`, 'error')
      setStatus({ text: `❌ ${err.message}`, pct: 100 })
      if (logId) logGenerationFailed(logId, err.message, Date.now() - startTime)
    } finally {
      nbChargeRef.current = null
      removeActiveTask(taskId)
      setGenerating(false)
    }
  }

  const unlimited = !!wallet?.unlimited?.active
  const price = wallet?.price ?? NEXABOT_PRICE_FALLBACK

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Video"
        highlight="Edit"
        desc="Upload video sumber, pilih gaya edit (motion graphics, AE zoom, SFX, b-roll, dokumenter, explainer), lalu Gemini Omni merender versi barunya lewat NexaBot."
        actions={
          <Link
            to="/topup/nexabot"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" />
            {unlimited ? 'Unlimited aktif' : `${formatRp(wallet?.balance ?? 0)} · Top up`}
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Section title="1 · Video Sumber" sub="Video yang mau diedit — gerak, subjek, dan urutan shot dipertahankan">
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                pickVideo(e.target.files)
                e.target.value = ''
              }}
            />
            {videoUrl ? (
              <div className="space-y-2">
                <div className="relative overflow-hidden rounded-2xl border border-border">
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className="max-h-[320px] w-full bg-black object-contain"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget
                      setMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
                      setRatio(v.videoWidth >= v.videoHeight ? '16:9' : '9:16')
                    }}
                  />
                  <button
                    type="button"
                    onClick={removeVideo}
                    aria-label="Hapus video"
                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate max-w-[220px]">{videoFile?.name}</span>
                  <span>{videoFile ? formatSize(videoFile.size) : ''}</span>
                  {meta && <span>{meta.width}×{meta.height} · {meta.duration.toFixed(1)} dtk</span>}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="grid aspect-video w-full place-items-center rounded-2xl border border-dashed border-border/80 bg-card/30 px-4 text-center transition hover:border-primary/60"
              >
                <div>
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="mt-2 text-sm">Tap atau tarik <b>video sumber</b></div>
                  <div className="text-[11px] text-muted-foreground">MP4 / WEBM / MOV · ideal 5–15 detik</div>
                </div>
              </button>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Video dikompres di browser sebelum dikirim. Kalau hasil kompresi masih di atas 6MB, potong dulu durasinya.
            </p>
          </Section>

          <Section title="2 · Gaya Edit" sub="Boleh pilih beberapa sekaligus — instruksinya digabung jadi satu prompt">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EDIT_STYLES.map((style) => {
                const active = selectedStyles.includes(style.id)
                const Icon = style.icon
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => toggleStyle(style.id)}
                    aria-pressed={active}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{style.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{style.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="3 · Pengaturan">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Aspek Rasio</Label>
                <Select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  options={RATIOS.map((r) => ({ value: r, label: r }))}
                />
              </div>
              <div>
                <Label>Resolusi</Label>
                <Select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  options={RESOLUTIONS}
                />
              </div>
            </div>
            <div className="mt-4">
              <Label>Arahan tambahan (opsional)</Label>
              <Textarea
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                rows={3}
                placeholder="Contoh: pakai teks bahasa Indonesia, sorot produk di detik 3, akhiri dengan logo di kanan bawah..."
              />
            </div>
            <div className="mt-4">
              <Label>Prompt yang dikirim</Label>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {prompt || 'Pilih minimal satu gaya edit atau tulis arahan tambahan.'}
              </div>
            </div>
          </Section>

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={handleGenerate}
            disabled={generating || !videoFile || !prompt}
            loading={generating}
          >
            {!generating && <Wand2 className="h-4 w-4" />}
            {generating ? `Memproses... ${progress}%` : `Edit Video${unlimited ? '' : ` · ${formatRp(price)}`}`}
          </Button>
          {generating && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Biaya & Saldo" sub="Satu generate = satu potong saldo NexaBot">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-bold">{formatRp(wallet?.balance ?? 0)}</div>
                <div className="text-xs text-muted-foreground">Saldo NexaBot</div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs ${unlimited ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                {unlimited ? 'Unlimited aktif' : `${formatRp(price)} / generate`}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {wallet?.server_key?.available
                ? 'Sudah bisa dipakai tanpa API key selama saldo atau paket Unlimited aktif.'
                : 'Butuh saldo NexaBot atau API key NexaBot di halaman Providers.'}
            </p>
            <Link to="/topup/nexabot" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Top up NexaBot <ExternalLink className="h-3 w-3" />
            </Link>
          </Section>

          <Section
            title="Proses"
            sub={status.text || 'Menunggu input'}
            right={generating ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : undefined}
          >
            <div className="max-h-[220px] space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px]">
              {logs.length > 0 ? (
                logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={
                      log.level === 'error' ? 'text-red-500'
                        : log.level === 'warn' ? 'text-amber-500'
                        : log.level === 'success' ? 'text-green-500'
                        : 'text-muted-foreground'
                    }
                  >
                    {log.time} {log.msg}
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">Belum ada proses.</div>
              )}
            </div>
          </Section>

          <Section
            title="Hasil"
            sub="Video hasil edit"
            right={
              resultUrl ? (
                <a
                  href={resultUrl}
                  download={`arkxmotion-edit-${Date.now()}.mp4`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Unduh
                </a>
              ) : undefined
            }
          >
            {resultUrl ? (
              <video src={resultUrl} controls playsInline className="w-full rounded-xl border border-border bg-black" />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Film className="mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm">Belum ada hasil</p>
                <p className="mt-1 text-xs">Upload video, pilih gaya, lalu Edit Video.</p>
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Riwayat</span>
                  <Link to="/hasil" className="text-xs text-primary hover:underline">Lihat semua</Link>
                </div>
                <div className="space-y-1.5">
                  {history.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setResultUrl(item.url)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border p-2 text-left hover:bg-accent/40"
                    >
                      <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[11px]">{item.prompt.split('\n')[0]}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
