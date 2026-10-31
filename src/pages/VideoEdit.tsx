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
import {
  planClips, splitVideoIntoClips, fetchVideoFile, joinEditedClips,
  CLIP_SECONDS, type ClipSpec,
} from '@/lib/videoChunks'

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

// Batas upload seluas mungkin — file bisa 100MB dan 4 menit, karena video
// dikompres di browser sebelum dikirim. Yang membatasi adalah budget payload
// (base64-nya harus muat di bawah body limit server), jadi kompresi dicoba
// dengan target 6MB dulu (angka yang sudah terbukti jalan di Image to Video),
// lalu naik ke 20MB kalau video panjang tidak mungkin masuk 6MB.
const MAX_UPLOAD_MB = 100
const MAX_DURATION_SEC = 240
const PAYLOAD_BUDGETS_MB = [6, 20]

// Mode potong otomatis: video di atas ambang ini dipecah jadi klip ±10 detik,
// tiap klip diedit terpisah (1× Rp 150), lalu digabung kembali di browser.
const CHUNK_THRESHOLD_SEC = 15
const MAX_CLIPS = 30
const CLIP_CONCURRENCY = 3
const CLIP_ATTEMPTS = 2

type ClipStatus = 'menunggu' | 'render' | 'selesai' | 'gagal'

interface ClipState {
  index: number
  status: ClipStatus
  error?: string
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${s}dtk` : `${s}dtk`
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
  const [audioMode, setAudioMode] = useState<'original' | 'edited'>('original')
  const [clipStates, setClipStates] = useState<ClipState[]>([])

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
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      addToast(`Video terlalu besar (${formatSize(file.size)}). Maksimal ${MAX_UPLOAD_MB}MB.`, 'error')
      return
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setMeta(null)
  }

  // Durasi baru terbaca setelah metadata video siap, jadi potong di sini:
  // file di atas 4 menit ditolak sebelum user sempat menekan Edit Video.
  const handleMetadata = (el: HTMLVideoElement) => {
    if (el.duration > MAX_DURATION_SEC) {
      addToast(`Durasi video ${formatDuration(el.duration)} — maksimal ${MAX_DURATION_SEC / 60} menit. Potong dulu.`, 'error')
      removeVideo()
      return
    }
    setMeta({ duration: el.duration, width: el.videoWidth, height: el.videoHeight })
    setRatio(el.videoWidth >= el.videoHeight ? '16:9' : '9:16')
  }

  const removeVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(null)
    setVideoUrl(null)
    setMeta(null)
    setClipStates([])
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

  // Rencana pemotongan ditentukan dari durasi video sumber, jadi jumlah klip
  // dan total biayanya bisa ditampilkan sebelum user menekan tombol.
  const clipSpecs = useMemo<ClipSpec[]>(
    () => (meta && meta.duration > CHUNK_THRESHOLD_SEC ? planClips(meta.duration) : []),
    [meta]
  )
  const isChunked = clipSpecs.length > 1

  const setClip = (index: number, patch: Partial<ClipState>) => {
    setClipStates((prev) => prev.map((c) => (c.index === index ? { ...c, ...patch } : c)))
  }

  interface JobOptions {
    viaMaster?: boolean
    ticket?: number | null
    clipLabel?: string
    onStatus?: (text: string, pct: number) => void
  }

  const runNexabotJob = async (
    mediaBase64: string,
    jobPrompt: string,
    apiKey: string | null,
    keyInfo: ProviderKey | null,
    options: JobOptions = {}
  ): Promise<string> => {
    const {
      viaMaster = false,
      ticket = nbChargeRef.current,
      clipLabel = '',
      onStatus = (text, pct) => setStatus({ text, pct }),
    } = options
    const tag = clipLabel ? `${clipLabel} · ` : ''

    return runNexabotJobWithSessionFallback<string>(async (auth, via) => {
      const { submitNexabot, pollNexabotJob, saveNexabotResult, downloadNexabotResult } = await import('@/lib/nexabot')

      addLog(`${tag}🚀 Submit ke NexaBot (${via})...`)
      onStatus(`${tag}Submit ke NexaBot...`, 15)

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
            onStatus(`${tag}Mengantre di NexaBot — ${secs}s...`, 15)
          },
        }),
        {
          onThrottle: (seconds) => {
            addLog(`⏳ Server NexaBot dibatasi upstream — menunggu ${seconds}s lalu submit otomatis`, 'warn')
            onStatus(`${tag}Server sibuk — menunggu ${seconds}s...`, 10)
          },
        }
      )
      if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot menolak submit')
      addLog(`${tag}✅ Job dibuat · ${submit.jobId.slice(0, 18)}...`, 'success')
      onStatus(`${tag}Memproses di NexaBot...`, 30)

      let pct = 30
      await pollNexabotJob(submit.jobId, auth, (msg) => {
        pct = Math.min(85, pct + 5)
        setProgress(pct)
        onStatus(`${tag}${msg}`, pct)
        addLog(msg, 'debug')
      }, {
        onRetry: ({ status: httpStatus, delayMs, message }) => {
          const secs = Math.ceil(delayMs / 1000)
          addLog(`⏳ NexaBot ${message}${httpStatus ? ` (HTTP ${httpStatus})` : ''} — coba lagi dalam ${secs}s...`, 'warn')
        },
      })

      onStatus(`${tag}Menyimpan hasil...`, 90)
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
      ticket,
      keyId: keyInfo?.id,
      hooks: {
        log: (msg, level) => addLog(msg, level),
        notify: (msg, type) => addToast(msg, type),
      },
    })
  }

  interface AccessCtx { hasActiveKey: boolean; serverReady: boolean }

  const runSingleJob = async (source: File, jobPrompt: string, ctx: AccessCtx): Promise<string> => {
    setStatus({ text: 'Menyiapkan video...', pct: 5 })
    addLog(`🎬 Mengompres video sumber (${formatSize(source.size)}${meta ? ` · ${formatDuration(meta.duration)}` : ''})...`)
    let compressed: File | null = null
    let budgetMb = 0
    for (const mb of PAYLOAD_BUDGETS_MB) {
      try {
        const out = await compressVideo(source, mb, (msg, pct) => {
          setStatus({ text: msg, pct: Math.min(11, Math.max(5, 5 + (pct ?? 0) / 12)) })
        })
        if (out.size <= mb * 1024 * 1024) {
          compressed = out
          budgetMb = mb
          break
        }
      } catch {
        // Budget ini tidak tercapai — coba budget berikutnya yang lebih longgar.
      }
      addLog(`Kompresi ke ${mb}MB belum tercapai${mb === PAYLOAD_BUDGETS_MB[0] ? ', coba budget 20MB' : ''}`, 'warn')
    }
    if (!compressed) {
      const last = PAYLOAD_BUDGETS_MB[PAYLOAD_BUDGETS_MB.length - 1]
      throw new Error(`Video tidak muat di ${last}MB meski sudah dikompres maksimal. Potong durasinya lalu coba lagi.`)
    }
    const { fileToBase64 } = await import('@/lib/oneover')
    const mediaBase64 = await fileToBase64(compressed)
    addLog(`✅ Video siap dikirim (${formatSize(compressed.size)} · budget ${budgetMb}MB)`, 'success')
    setProgress(12)

    if (ctx.hasActiveKey) {
      const rotation = await withTokenRotation(
        'nexabot',
        (apiKey, keyInfo) => runNexabotJob(mediaBase64, jobPrompt, apiKey, keyInfo),
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
      return rotation.result
    }
    addLog('🏦 Memakai kunci NexaBot milik server', 'info')
    return runNexabotJob(mediaBase64, jobPrompt, null, null, { viaMaster: true })
  }

  // Mode potong: N klip → N generate (N × tarif NexaBot) → unduh semua klip →
  // gabung di browser → tempel audio asli → unggah hasil utuh ke CDN.
  const runChunkedJob = async (
    source: File,
    specs: ClipSpec[],
    jobPrompt: string,
    ctx: AccessCtx & { isAdmin: boolean; authToken: string }
  ): Promise<string> => {
    const { isAdmin, authToken } = ctx
    const total = specs.length
    const label = (i: number) => `klip ${i + 1}/${total}`
    setClipStates(specs.map((s) => ({ index: s.index, status: 'menunggu' as ClipStatus })))
    addLog(`✂️ Mode potong otomatis: ${total} klip × ±${CLIP_SECONDS} detik`, 'info')

    setStatus({ text: `Memotong video jadi ${total} klip...`, pct: 3 })
    const clips = await splitVideoIntoClips(source, {
      specs,
      height: Number(resolution),
      onProgress: (msg, pct) => setStatus({ text: msg, pct: 2 + ((pct ?? 0) / 100) * 10 }),
    })

    const { fileToBase64 } = await import('@/lib/oneover')
    const mediaList = await Promise.all(clips.map((c) => fileToBase64(c)))
    addLog(`✅ ${total} klip siap dikirim (total ${formatSize(clips.reduce((s, c) => s + c.size, 0))})`, 'success')
    setProgress(14)

    const urls: string[] = new Array(total).fill('')
    let finished = 0
    // Satu klip gagal permanen → stop. Melanjutkan klip lain hanya membakar
    // saldo untuk hasil yang pada akhirnya dibuang.
    let halted = false

    const editOne = async (i: number) => {
      for (let attempt = 1; attempt <= CLIP_ATTEMPTS; attempt++) {
        let ticket: number | null = null
        setClip(i, { status: 'render' })
        try {
          if (!isAdmin) {
            const charge = await chargeNexabotWallet(authToken, 'r2v')
            ticket = charge.usageId
            setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
          }
          const opts = { ticket, clipLabel: label(i) }
          const url = ctx.hasActiveKey
            ? (await withTokenRotation('nexabot', (apiKey, keyInfo) =>
                runNexabotJob(mediaList[i], jobPrompt, apiKey, keyInfo, opts), {
                requiredCredits: 0.15,
                onKeySwitch: (from: ProviderKey, to: ProviderKey, n: number) =>
                  addLog(`🔄 ${label(i)}: pindah key #${n} "${from.name || from.id}" → "${to.name || to.id}"`, 'warn'),
              })).result
            : await runNexabotJob(mediaList[i], jobPrompt, null, null, { ...opts, viaMaster: true })

          if (!url) throw new Error('NexaBot tidak mengembalikan hasil')
          urls[i] = url
          setClip(i, { status: 'selesai' })
          finished += 1
          const pct = 15 + (finished / total) * 70
          setProgress(Math.round(pct))
          setStatus({ text: `${label(i)} selesai — ${finished}/${total} klip`, pct })
          return
        } catch (err: any) {
          // Klip ini dibayar; kalau gagal, uangnya kembali lalu coba sekali lagi.
          if (ticket != null) {
            const refunded = await refundNexabotWallet(authToken, ticket).catch(() => null)
            if (refunded != null) setWallet((w) => (w ? { ...w, balance: refunded } : w))
          }
          if (attempt >= CLIP_ATTEMPTS) {
            setClip(i, { status: 'gagal', error: err.message })
            halted = true
            throw new Error(`${label(i)} gagal: ${err.message}`)
          }
          addLog(`⚠️ ${label(i)} gagal (${err.message}) — ulangi`, 'warn')
        }
      }
    }

    // FFmpeg cuma satu instance, tapi generate-nya jaringan — jalankan bertingkat.
    let cursor = 0
    const workers = Array.from({ length: Math.min(CLIP_CONCURRENCY, total) }, async () => {
      while (!halted && cursor < total) {
        const i = cursor++
        await editOne(i)
      }
    })
    const results = await Promise.allSettled(workers)
    const failed = results.find((r) => r.status === 'rejected')
    if (failed && failed.status === 'rejected') {
      const paid = urls.filter(Boolean).length
      addLog(`⛔ Mode potong dihentikan — ${paid} klip sudah terlanjur dibayar dan tidak dipakai`, 'error')
      throw failed.reason
    }

    setStatus({ text: 'Mengunduh klip hasil edit...', pct: 88 })
    const edited: File[] = []
    for (let i = 0; i < total; i++) {
      edited.push(await fetchVideoFile(urls[i], `clip_${i + 1}.mp4`))
      setStatus({ text: `Unduh klip ${i + 1}/${total}`, pct: 88 + (i / total) * 4 })
    }

    const joined = await joinEditedClips(edited, specs, source, meta?.duration ?? 0, {
      audioMode,
      onProgress: (msg, pct) => setStatus({ text: msg, pct: 92 + ((pct ?? 0) / 100) * 6 }),
    })
    if (joined.retimed) addLog(`⏱️ Durasi hasil edit disesuaikan ke ${formatDuration(meta?.duration ?? 0)} agar audio tetap sinkron`, 'info')
    if (joined.audioFrom === 'none') addLog('🔇 Video sumber tanpa audio — hasil gabungan tanpa suara', 'warn')

    setStatus({ text: 'Mengunggah hasil gabungan...', pct: 98 })
    try {
      const { uploadBlobToCdn } = await import('@/lib/cdn')
      const up = await uploadBlobToCdn(joined.file, `video-edit-${Date.now()}.mp4`)
      if (up.ok && up.url) {
        addLog(`✅ Gabungan ${total} klip tersimpan (${formatSize(joined.file.size)})`, 'success')
        return up.url
      }
      throw new Error(up.error || 'upload gagal')
    } catch (e: any) {
      addLog(`⚠️ Unggah CDN gagal (${e.message}) — hasil sementara hanya bisa dilihat sesi ini`, 'warn')
      return URL.createObjectURL(joined.file)
    }
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

      const keys = useProviderManager.getState().keys.nexabot || []
      const hasActiveKey = keys.some((k) => k.status !== 'invalid' && k.status !== 'expired')
      if (!hasActiveKey && !serverReady) {
        throw new Error('Belum ada akses NexaBot — top up NexaBot dulu atau tambahkan API key di halaman Providers.')
      }

      let url: string
      if (isChunked) {
        if (clipSpecs.length > MAX_CLIPS) {
          throw new Error(`Video ini terbagi jadi ${clipSpecs.length} klip — lewat batas ${MAX_CLIPS} klip. Potong durasinya dulu.`)
        }
        addLog(`💰 Estimasi biaya mode potong: ${clipSpecs.length} × ${wallet?.unlimited?.active ? 'gratis (paket)' : formatRp(wallet?.price ?? NEXABOT_PRICE_FALLBACK)}`, 'info')
        url = await runChunkedJob(videoFile, clipSpecs, prompt, { hasActiveKey, serverReady, isAdmin, authToken })
      } else {
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
        url = await runSingleJob(videoFile, prompt, { hasActiveKey, serverReady })
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
        model: isChunked ? `Gemini Omni · Video Edit (${clipSpecs.length} klip)` : 'Gemini Omni · Video Edit',
        ratio,
        credits: isChunked ? 0.15 * clipSpecs.length : 0.15,
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
                    onLoadedMetadata={(e) => handleMetadata(e.currentTarget)}
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
                  {meta && <span>{meta.width}×{meta.height} · {formatDuration(meta.duration)}</span>}
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
                  <div className="text-[11px] text-muted-foreground">MP4 / WEBM / MOV · maksimal 4 menit · 100MB</div>
                </div>
              </button>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Video dikompres di browser sebelum dikirim, jadi file besar dan panjang tetap bisa dipakai — tapi prosesnya
              memakan waktu di perangkat Anda. Kalau hasil kompresi masih di atas 20MB, potong dulu durasinya.
            </p>
            {isChunked && (
              <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="text-xs font-medium">
                  Mode potong otomatis: {clipSpecs.length} klip × ±{CLIP_SECONDS} detik
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Video {formatDuration(meta?.duration ?? 0)} dipecah, tiap klip diedit terpisah lalu digabung kembali
                  menjadi satu utuh. Biayanya {unlimited ? 'gratis (paket Unlimited aktif)' : `± ${formatRp(price * clipSpecs.length)} (${clipSpecs.length} × ${formatRp(price)})`}
                  {' '}dan prosesnya lebih lama.
                </p>
                <div className="mt-2 flex gap-2">
                  {([
                    ['original', 'Audio asli (lebih mulus)'],
                    ['edited', 'Audio hasil edit'],
                  ] as const).map(([value, lab]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAudioMode(value)}
                      aria-pressed={audioMode === value}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                        audioMode === value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                {audioMode === 'original' && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Suara video sumber ditempel lagi ke hasil gabungan, jadi tidak patah di tiap batas potong — tapi SFX
                    tambahan dari model tidak ikut terpakai.
                  </p>
                )}
              </div>
            )}
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
            {generating
              ? `Memproses... ${progress}%`
              : `Edit Video${unlimited ? '' : ` · ${formatRp(price * (isChunked ? clipSpecs.length : 1))}`}`}
          </Button>
          {generating && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}
          {clipStates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {clipStates.map((c) => (
                <span
                  key={c.index}
                  title={c.error}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                    c.status === 'selesai'
                      ? 'bg-green-500/10 text-green-600'
                      : c.status === 'gagal'
                        ? 'bg-red-500/10 text-red-600'
                        : c.status === 'render'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {c.index + 1} · {c.status}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Biaya & Saldo" sub={isChunked ? `Mode potong: ${clipSpecs.length} generate, satu per klip` : 'Satu generate = satu potong saldo NexaBot'}>
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
