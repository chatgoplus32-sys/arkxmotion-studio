import { useState, useRef, useCallback, useEffect, useMemo, forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Label, EmptyState, BalanceBadge, getActiveProviderForCap } from '@/components/ui'
import { setRoutingValue } from '@/lib/routing'
import { useProviderManager, type ProviderId } from '@/stores'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { useToastStore } from '@/stores/toastStore'
import { uploadToCatbox, compressVideo, normalizeImage, getVideoDurationFromFile, submitMotionControl, submitGoogleOmni, pollRoboneoI2V, checkRoboneoBalance, noteRoboneoMotionChargeFailure, getRoboneoMotionMinCredits, isRoboneoBalanceError, isRoboneoBusyError } from '@/lib/roboneo'
import { submitGensparkVideo, extractGensparkVideoUrl, uploadToGenspark, pollGensparkVideo } from '@/lib/genspark'
import { trimVideoFFmpeg } from '@/lib/ffmpeg-compress'
import { submitWeavyMotionControl, uploadWeavyAssetWithRetry, resolveWeavyAssetUrl, getActiveWeavyAccessToken, compressImageForWeavy } from '@/lib/weavy'
import { getRunningHubApiKey, getRunningHubWorkflowId, submitRunningHubMotionControl, submitRunningHubUltraFastHD, submitRunningHubMotionApp, pollRunningHubTask } from '@/lib/runninghub'
import { getGalleri5AuthHeaders, submitGalleri5MotionControl, pollGalleri5MotionControl, isGalleri5ModelRestricted, getGalleri5ErrorMessage, GALLERI5_MOTION_MODELS, runGalleri5WithRotation } from '@/lib/galleri5'
import { getMagnificApiKey, submitMagnificMotion, pollMagnificMotion, type MagnificMotionModel } from '@/lib/magnific'
import { generateWithAlriz, getAlrizModel } from '@/lib/alriz'
import { chargeAlrizWallet, refundAlrizWallet } from '@/lib/alrizWallet'
import { getSeaviSpec, generateWithSeavi, buildSeaviPayload } from '@/lib/seavi'
import { fetchSeaviWallet, chargeSeaviWallet, refundSeaviWallet } from '@/lib/seaviWallet'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { precheckProviderBalance } from '@/lib/balancePrecheck'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { removeResult, clearResults, getActiveTasks, getLogs, getResults, addBgLog, addActiveTask, addResult, clearLogs, removeActiveTask, persistResultToR2, markTaskActivelyPolled } from '@/lib/backgroundTasks'
import { startBackgroundPolling } from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { useAuthStore } from '@/stores/authStore'
import {
  Video,
  Upload,
  Trash2,
  Plus,
  Rocket,
  Search,
  Loader2,
  X,
  Download,
  Globe,
  Copy,
  Check,
  Wallet,
  Zap,
  Coins,
} from 'lucide-react'

const PROVIDERS = {
  weavy: { name: 'Weavy', models: [
    { key: 'fal-ai/kling-video/v3/pro/motion-control', label: 'Kling V3.0 Pro', cr: 50 },
    { key: 'fal-ai/kling-video/v3/standard/motion-control', label: 'Kling V3.0 Standard', cr: 50 },
    { key: 'fal-ai/kling-video/v2.6/pro/motion-control', label: 'Kling V2.6 Pro', cr: 50 },
    { key: 'fal-ai/kling-video/v2.6/standard/motion-control', label: 'Kling V2.6 Standard', cr: 50 },
  ]},
  wavespeed: { name: 'Wavespeed', models: [
    { key: 'ws:kwaivgi/kling-v3.0-pro/motion-control', label: 'Kling V3.0 Pro', cr: 84 },
    { key: 'ws:kwaivgi/kling-v3.0-std/motion-control', label: 'Kling V3.0 Standard', cr: 63 },
    { key: 'ws:kwaivgi/kling-v2.6-pro/motion-control', label: 'Kling V2.6 Pro', cr: 56 },
    { key: 'ws:kwaivgi/kling-v2.6-std/motion-control', label: 'Kling V2.6 Standard', cr: 21 },
  ]},

  roboneo: { name: 'Roboneo', models: [
    { key: 'rn:kling-v2.6-motion-std', label: 'Kling V2.6 Std Motion (Roboneo)', cr: 65 },
    { key: 'rn:kling-v2.6-motion-pro', label: 'Kling V2.6 Pro Motion (Roboneo)', cr: 90 },
  ]},
  magnific: { name: 'Magnific', models: [
    { key: 'mag:kling-v3-motion-control-pro', label: 'Kling V3.0 Pro (Magnific)', cr: 84 },
    { key: 'mag:kling-v3-motion-control-std', label: 'Kling V3.0 Standard (Magnific)', cr: 63 },
    { key: 'mag:kling-v2-6-motion-control-pro', label: 'Kling V2.6 Pro (Magnific)', cr: 56 },
    { key: 'mag:kling-v2-6-motion-control-std', label: 'Kling V2.6 Standard (Magnific)', cr: 21 },
  ]},
  framia: { name: 'Framia', models: [
    { key: 'framia:kling-v2.1-motion', label: 'Kling V2.1 Motion Control (Framia)', cr: 40 },
    { key: 'framia:kling-v2.6-motion', label: 'Kling V2.6 Motion Control (Framia)', cr: 35 },
  ]},
  runninghub: { name: 'RunningHub', models: [
    { key: 'rh:wf:kontrol-gerakan', label: 'Kontrol Gerak 50FPS — Lebih Cepat, maks 24s (RunningHub)', cr: 80 },
    { key: 'rh:wf:eposcents', label: 'Eposcents MC — 512HD 32FPS · 50s (RunningHub)', cr: 80 },
    { key: 'rh:wf:mc-pro', label: 'Motion Control Pro — Motion Transfer · 15s (RunningHub)', cr: 80 },
    { key: 'rh:wf:ultra-hd', label: 'MC Ultra Fast HD (RunningHub)', cr: 80 },
    { key: 'rh:pro:2.6', label: 'Kling 2.6 Pro (RunningHub)', cr: 80 },
    { key: 'rh:std:2.6', label: 'Kling 2.6 Standard (RunningHub)', cr: 50 },
    { key: 'rh:wf:2.9', label: 'Kling 2.9 Workflow (RunningHub)', cr: 80 },
    { key: 'rh:wf:v3.0', label: 'Motion Control Std 3.0 (RunningHub)', cr: 80 },
  ]},
  galleri5: { name: 'G5 AI Studio', models: [
    { key: 'g5:kling-v3-pro-motion-control', label: 'Kling V3.0 Pro (Galery5)', cr: 200 },
    { key: 'g5:kling-v2.6-pro-motion-control', label: 'Kling V2.6 Pro (Galery5)', cr: 120 },
    { key: 'g5:kling-v2.6-std-motion-control', label: 'Kling V2.6 Standard (Galery5)', cr: 60 },
    { key: 'g5:wan-motion', label: 'Wan Motion (Galery5)', cr: 30 },
  ]},
    oneover: { name: 'OneOver', models: [
    { key: 'oo:gemini-omni-flash-preview', label: 'Gemini Omni Flash (OneOver)', cr: 200 },
    { key: 'oo:grok-imagine-video', label: 'Grok Imagine Video (OneOver)', cr: 70 },
    { key: 'oo:seedance-2.0', label: 'Seedance 2.0 (OneOver)', cr: 140 },
    { key: 'oo:seedance-2.5', label: 'Seedance 2.5 (OneOver)', cr: 210 },
  ]},
  genspark: { name: 'Genspark AI', models: [
    { key: 'gp:kling-v3-pro-motion', label: 'Kling V3 Pro Motion Control (Genspark)', cr: 80 },
    { key: 'gp:kling-v3-std-motion', label: 'Kling V3 Standard Motion Control (Genspark)', cr: 60 },
  ]},
  // Alriz: harga per video dalam RUPIAH (cr = Rp) — sinkron upstream /api/models (okt 2026):
  // MC 2.6 Std Rp750, MC 2.6 Pro Rp1.250, MC 3.0 Std Rp1.000, MC 3.0 Pro Rp1.500.
  // Model I2V (gambar + prompt) dipindah ke halaman Image-to-Video (provider 'alriz').
  alriz: { name: 'Alriz Motion', models: [
    { key: 'al:mc-kling-2.6-std', label: 'MC 2.6 Std · 720p', cr: 750 },
    { key: 'al:mc-kling-2.6-pro', label: 'MC 2.6 Pro · 1080p', cr: 1250 },
    { key: 'al:mc-kling-3.0-std', label: 'MC 3.0 Std · 720p', cr: 1000 },
    { key: 'al:mc-kling-3.0-pro', label: 'MC 3.0 Pro · 1080p', cr: 1500 },
  ]},
  // Seavi Labs: harga per video dalam TOKEN (cr = token, 1 token = Rp 2.000).
  seavi: { name: 'Seavi Labs', models: [
    { key: 'sv:motion_control_v3_server19_15dtk', label: 'Motion Control V3 · S19 15 dtk', cr: 1 },
    { key: 'sv:motion_control_v3_server10_30dtk', label: 'Motion Control V3 · S10 30 dtk', cr: 1 },
  ]},
}

// Halaman Motion Control menawarkan tiga provider yang paling stabil, biar
// member tidak bingung memilih. Provider lain tetap dipakai halaman lain.
const MOTION_PROVIDER_IDS = ['alriz', 'runninghub', 'seavi'] as const
type MotionProviderId = (typeof MOTION_PROVIDER_IDS)[number]

const MOTION_PROVIDER_INFO: Record<MotionProviderId, { name: string; tagline: string; note: string; recommended?: boolean }> = {
  alriz: {
    name: 'Alriz Motion',
    tagline: 'Bayar pakai saldo Rupiah',
    note: 'Tanpa API key — pilihan paling gampang untuk member baru.',
    recommended: true,
  },
  runninghub: {
    name: 'RunningHub',
    tagline: 'Bayar pakai kredit RunningHub',
    note: 'Perlu API key RunningHub yang sudah disimpan di halaman Providers.',
  },
  seavi: {
    name: 'Seavi Labs',
    tagline: 'Bayar pakai token Seavi',
    note: 'Tanpa API key — top up token di halaman Top Up Seavi (Rp 4.000 = 2 token).',
  },
}

// Default model tiap provider: pilih yang paling murah, bukan yang pertama di daftar.
const MOTION_RECOMMENDED_MODEL: Record<MotionProviderId, string> = {
  alriz: 'al:mc-kling-2.6-std',
  runninghub: 'rh:std:2.6',
  seavi: 'sv:motion_control_v3_server19_15dtk',
}

// Label awam untuk dropdown model — nama workflow aslinya terlalu teknis.
const SIMPLE_MODEL_LABELS: Record<string, string> = {
  'al:mc-kling-2.6-std': 'Standar 2.6 · 720p',
  'al:mc-kling-2.6-pro': 'Pro 2.6 · 1080p',
  'al:mc-kling-3.0-std': 'Standar 3.0 · 720p',
  'al:mc-kling-3.0-pro': 'Pro 3.0 · 1080p',
  'rh:wf:kontrol-gerakan': 'Cepat 50 FPS · maks 24 detik',
  'rh:wf:eposcents': 'Eposcents · 512HD 50 detik',
  'rh:wf:mc-pro': 'Motion Transfer Pro · 15 detik',
  'rh:wf:ultra-hd': 'Ultra Fast HD',
  'rh:pro:2.6': 'Kling 2.6 Pro',
  'rh:std:2.6': 'Kling 2.6 Standar',
  'rh:wf:2.9': 'Kling 2.9 Workflow',
  'rh:wf:v3.0': 'Kling 3.0 Standar',
  'sv:motion_control_v3_server19_15dtk': 'Motion Control V3 · 15 detik',
  'sv:motion_control_v3_server10_30dtk': 'Motion Control V3 · 30 detik',
}

function motionModelLabel(providerId: MotionProviderId, model: { key: string; label: string; cr: number }): string {
  const name = SIMPLE_MODEL_LABELS[model.key] || model.label
  const price = providerId === 'alriz'
    ? `Rp ${model.cr.toLocaleString('id-ID')}`
    : providerId === 'seavi'
    ? `${model.cr} token`
    : `${model.cr} kredit`
  const tag = model.key === MOTION_RECOMMENDED_MODEL[providerId] ? ' · disarankan' : ''
  return `${name} · ${price}${tag}`
}

const MAX_SLOTS = 12
const MAX_VIDEO_REF_MB = 6
const MAX_VIDEO_REF_BYTES = MAX_VIDEO_REF_MB * 1024 * 1024

interface Slot {
  id: string
  image: File | null
  imageUrl: string | null
  video: File | null
  videoUrl: string | null
  status: 'idle' | 'uploading img...' | 'uploading vid...' | 'processing' | 'done' | 'error'
  statusText?: string
  resultUrl?: string
  error?: string
}

function createSlot(): Slot {
  return {
    id: Math.random().toString(36).slice(2),
    image: null,
    imageUrl: null,
    video: null,
    videoUrl: null,
    status: 'idle',
  }
}

export default function MotionPage() {
  const [provider, setProvider] = useLocalStorage<ProviderId>('motion.provider', 'alriz')
  const addToast = useToastStore((s) => s.addToast)
  const [modelKey, setModelKey] = useLocalStorage('motion.modelKey', PROVIDERS.alriz.models[0]?.key || '')
  const [orientation, setOrientation] = useLocalStorage<'video' | 'image'>('motion.orientation', 'video')
  const [prompt, setPrompt] = useLocalStorage('motion.prompt', '')
  const [negativePrompt, setNegativePrompt] = useLocalStorage('motion.negativePrompt', '')
  const [keepSound, setKeepSound] = useLocalStorage('motion.keepSound', true)
  const [adaptMotion, setAdaptMotion] = useLocalStorage('motion.adaptMotion', false)
  const [safetyChecker, setSafetyChecker] = useLocalStorage('motion.safetyChecker', false)
  const [enhanceIdentity, setEnhanceIdentity] = useLocalStorage('motion.enhanceIdentity', false)
  const [autoTrim, setAutoTrim] = useLocalStorage('motion.autoTrim', true)
  const [ultraFps, setUltraFps] = useLocalStorage('motion.ultraHdFps', 60)
  const [ultraSteps, setUltraSteps] = useLocalStorage('motion.ultraHdSteps', 4)
  const [ultraMaxFrames, setUltraMaxFrames] = useLocalStorage('motion.ultraHdMaxFrames', 120)
  const [slots, setSlots] = useState<Slot[]>(() => {
    try {
      const raw = localStorage.getItem('motion.slots')
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Omit<Slot, 'image' | 'video'>>
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s) => ({ ...s, image: null, video: null }))
        }
      }
    } catch (e) { console.warn('[Motion] Failed to load saved slots:', e) }
    return [createSlot()]
  })
  const [generating, setGenerating] = useState(() => getActiveTasks().filter((t) => t.page === 'motion').length > 0)
  const [compressDialog, setCompressDialog] = useState<{ msg: string; pct?: number } | null>(null)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>(() => getLogs())
  const [results, setResults] = useState<Array<{ id: string; url: string; prompt: string; date: string; provider?: string; model?: string; taskUrl?: string }>>(() => {
    return getResults().filter((r) => r.page === 'motion').map(({ page: _page, ...r }) => r)
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [elapsed, setElapsed] = useState('0:00')
  const elapsedRef = useRef<number | null>(null)
  const generatingRef = useRef(false)
  const successRef = useRef(false)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void; tone?: 'default' | 'danger' } | null>(null)
  const authToken = useAuthStore((s) => s.token)
  const authRole = useAuthStore((s) => s.user?.role)
  const [seaviTokens, setSeaviTokens] = useState<number | null>(null)

  const { fetchMaintenance } = useProviderManager()

  useEffect(() => {
    if (provider !== 'seavi') {
      setSeaviTokens(null)
      return
    }
    if (!authToken) return
    let alive = true
    fetchSeaviWallet(authToken)
      .then((w) => { if (alive && w) setSeaviTokens(w.tokens) })
      .catch(() => {})
    return () => { alive = false }
  }, [provider, authToken])

  useEffect(() => {
    fetchMaintenance()
    // Member lama bisa masih menyimpan provider di luar daftar (Weavy/Wavespeed),
    // jadi arahkan balik ke Alriz dan pastikan model yang dipilih ikut cocok.
    const allowed = MOTION_PROVIDER_IDS as readonly string[]
    const p = PROVIDERS[provider as keyof typeof PROVIDERS]
    if (!allowed.includes(provider) || !p || p.models.length === 0) {
      setProvider('alriz')
      setModelKey(MOTION_RECOMMENDED_MODEL.alriz)
      return
    }
    if (!p.models.some((m) => m.key === modelKey)) {
      setModelKey(MOTION_RECOMMENDED_MODEL[provider as MotionProviderId])
    }
  }, [fetchMaintenance, provider, modelKey, setProvider, setModelKey])

  useEffect(() => {
    const sync = () => {
      const cap = getActiveProviderForCap('motion')
      if (
        cap &&
        cap !== provider &&
        (MOTION_PROVIDER_IDS as readonly string[]).includes(cap) &&
        PROVIDERS[cap as keyof typeof PROVIDERS]
      ) {
        setProvider(cap as ProviderId)
        setModelKey(MOTION_RECOMMENDED_MODEL[cap as MotionProviderId])
      }
    }
    sync()
    window.addEventListener('aatools:routing-changed', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('aatools:routing-changed', sync)
      window.removeEventListener('focus', sync)
    }
  }, [provider, setProvider, setModelKey])

  const selectMotionProvider = (id: MotionProviderId) => {
    if (id !== provider) {
      setProvider(id)
      setModelKey(MOTION_RECOMMENDED_MODEL[id])
    }
    setRoutingValue('motion', id)
  }

  useEffect(() => {
    const metadata = slots.map(({ image: _image, video: _video, ...rest }) => rest)
    try { localStorage.setItem('motion.slots', JSON.stringify(metadata)) } catch (e) { console.warn('[Motion] Failed to save slots:', e) }
  }, [slots])

  useEffect(() => {
    const activeTasks = getActiveTasks().filter((t) => t.page === 'motion')
    const staleThreshold = 30 * 60 * 1000
    const staleTasks = activeTasks.filter((t) => Date.now() - t.startedAt > staleThreshold)
    if (staleTasks.length > 0) {
      for (const task of staleTasks) {
        removeActiveTask(task.taskId)
      }
      setGenerating(false)
      generatingRef.current = false
    }

    startBackgroundPolling()

    const sync = () => {
      const bgLogs = getLogs()
      setLogs(bgLogs)
      const bgResults = getResults().filter((r) => r.page === 'motion').map(({ page: _page, ...r }) => r)
      setResults(bgResults)
      const hasActive = getActiveTasks().filter((t) => t.page === 'motion').length > 0
      setGenerating(hasActive)
      generatingRef.current = hasActive
    }

    window.addEventListener('arkxmotion-tasks-changed', sync)
    return () => window.removeEventListener('arkxmotion-tasks-changed', sync)
  }, [])

  useEffect(() => {
    if (!generating) {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      return
    }
    const start = Date.now()
    setElapsed('0:00')
    elapsedRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000)
      setElapsed(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`)
    }, 1000)
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current) }
  }, [generating])

  const currentProvider = PROVIDERS[provider as keyof typeof PROVIDERS] || PROVIDERS.alriz
  const recommendedModelKey = MOTION_RECOMMENDED_MODEL[provider as MotionProviderId] || ''
  const currentModel = currentProvider.models.find((m) => m.key === modelKey) || currentProvider.models[0]
  const isOmni = modelKey === 'rn:google-omni'
  // Alriz I2V (kling-3.0-turbo, gemini-omni-flash, dll.): cukup gambar + prompt,
  // tanpa video referensi — slot video disembunyikan & tidak wajib.
  const isAlrizI2v = provider === 'alriz' && getAlrizModel(modelKey.replace(/^al:/, ''))?.kind === 'i2v'
  const slotsImageOnly = isOmni || isAlrizI2v
  const filledSlots = slotsImageOnly
    ? slots.filter((s) => s.image).length
    : slots.filter((s) => s.image && s.video).length
  const rawCredits = filledSlots * (currentModel?.cr || 0)
  const totalCredits = provider === 'roboneo' ? Math.max(rawCredits, getRoboneoMotionMinCredits()) : rawCredits

  const addSlot = () => {
    if (slots.length < MAX_SLOTS) {
      setSlots([...slots, createSlot()])
    }
  }

  const removeSlot = (id: string) => {
    if (slots.length > 1) {
      setSlots(slots.filter((s) => s.id !== id))
    }
  }

  const updateSlot = (id: string, updates: Partial<Slot>) => {
    setSlots(slots.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }

  const updateSlotStatus = (id: string, status: Slot['status'], statusText?: string) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, status, statusText, error: status === 'error' ? statusText : s.error } : s)))
  }

  const slotProgress = useMemo(() => {
    const filled = slots.filter((s) => (isOmni || isAlrizI2v ? s.image : s.image && s.video))
    if (filled.length === 0) return 0
    const pct = (s: Slot) => {
      if (s.status === 'done' || s.status === 'error') return 100
      if (s.status === 'processing') {
        const m = /(\d+)%/.exec(s.statusText || '')
        return m ? Math.max(60, Math.min(99, Number(m[1]))) : 70
      }
      if (s.status === 'uploading vid...') return 40
      if (s.status === 'uploading img...') return 20
      return generating ? 5 : 0
    }
    return Math.round(filled.reduce((a, s) => a + pct(s), 0) / filled.length)
  }, [slots, generating, isOmni, isAlrizI2v])

  const statusSummary = useMemo(() => {
    const filled = slots.filter((s) => (isOmni || isAlrizI2v ? s.image : s.image && s.video))
    if (filled.length === 0) return 'Idle'
    const doneCount = filled.filter((s) => s.status === 'done').length
    const errorCount = filled.filter((s) => s.status === 'error').length
    if (!generating && doneCount + errorCount === filled.length && doneCount + errorCount > 0) {
      return errorCount > 0
        ? `Selesai — ${doneCount} sukses · ${errorCount} gagal`
        : `Selesai — ${doneCount} video`
    }
    if (generating) {
      const active = filled.find((s) => s.status !== 'done' && s.status !== 'error' && s.status !== 'idle')
      return active ? `Slot #${filled.indexOf(active) + 1}: ${active.statusText || active.status}` : 'Processing…'
    }
    return 'Idle'
  }, [slots, generating, isOmni, isAlrizI2v])

  const handleFileChange = async (id: string, type: 'image' | 'video', file: File | null) => {
    if (!file) {
      if (type === 'image') {
        updateSlot(id, { image: null, imageUrl: null })
      } else {
        updateSlot(id, { video: null, videoUrl: null })
      }
      return
    }

    if (type === 'video' && file.size > MAX_VIDEO_REF_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      const doCompress = window.confirm(
        `Video referensi berukuran ${sizeMB}MB. Batas upload maksimal ${MAX_VIDEO_REF_MB}MB.\n\nKlik OK untuk mengompres video otomatis.`
      )
      if (!doCompress) {
        addLog(`#${id.slice(0, 4)} upload dibatalkan: video ${sizeMB}MB > ${MAX_VIDEO_REF_MB}MB`, 'warn')
        return
      }
      setCompressDialog({ msg: `Mengompres video ke maksimal ${MAX_VIDEO_REF_MB}MB...` })
      try {
        const compressed = await compressVideo(file, MAX_VIDEO_REF_MB, (msg, pct) => {
          setCompressDialog({ msg, pct })
        })
        setCompressDialog(null)
        if (compressed.size > MAX_VIDEO_REF_BYTES) {
          addLog(`Kompresi gagal: video masih ${(compressed.size / (1024 * 1024)).toFixed(1)}MB (maks ${MAX_VIDEO_REF_MB}MB)`, 'error')
          return
        }
        const url = URL.createObjectURL(compressed)
        updateSlot(id, { video: compressed, videoUrl: url })
        addLog(`#${id.slice(0, 4)} video dikompres: ${sizeMB}MB → ${(compressed.size / (1024 * 1024)).toFixed(1)}MB`, 'success')
      } catch (err: any) {
        setCompressDialog(null)
        addLog(`Kompresi gagal: ${err.message}`, 'error')
      }
      return
    }

    const sizeLimit = 4 * 1024 * 1024

    if (provider === 'roboneo' && file.size > sizeLimit) {
      const label = type === 'image' ? 'gambar' : 'video'
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      const doCompress = window.confirm(
        `File ${label} berukuran ${sizeMB}MB. Roboneo membatasi upload maksimal 4MB.\n\nKlik OK untuk mengompres file otomatis.`
      )
      if (doCompress) {
        setCompressDialog({ msg: `Mengompres ${label}...` })
        try {
          let compressed: File
          if (type === 'image') {
            compressed = await normalizeImage(file)
          } else {
            compressed = await compressVideo(file, 4, (msg, pct) => {
              setCompressDialog({ msg, pct })
            })
          }
          setCompressDialog(null)
          const url = URL.createObjectURL(compressed)
          if (type === 'image') {
            updateSlot(id, { image: compressed, imageUrl: url })
          } else {
            updateSlot(id, { video: compressed, videoUrl: url })
          }
          addLog(`#${id.slice(0, 4)} ${label} dikompres: ${(file.size / (1024 * 1024)).toFixed(1)}MB → ${(compressed.size / (1024 * 1024)).toFixed(1)}MB`, 'success')
        } catch (err: any) {
          setCompressDialog(null)
          addLog(`Kompresi gagal: ${err.message}`, 'error')
        }
        return
      }
    }

    const url = URL.createObjectURL(file)
    if (type === 'image') {
      updateSlot(id, { image: file, imageUrl: url })
    } else {
      updateSlot(id, { video: file, videoUrl: url })
    }
  }

  const addLog = (msg: string, level: 'debug' | 'info' | 'warn' | 'error' | 'success' = 'info') => {
    addBgLog(msg, level)
    const entry = { time: new Date().toLocaleTimeString(), msg, level }
    setLogs((prev) => [...prev, entry].slice(-200))
  }

  const handleTiktokImport = async (slotId: string, link: string): Promise<void> => {
    addLog('Mengambil video TikTok…')
    try {
      const res = await fetch('/api/public/tiktok-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || `Gagal mengambil video (HTTP ${res.status})`)

      addLog(`Video TikTok ${data.hd ? 'HD tanpa watermark' : 'tanpa watermark'} ditemukan, mengunduh…`)
      // CDN TikTok tidak mengizinkan CORS dari browser, jadi unduh lewat proxy same-origin.
      const videoRes = await fetch(`/api/public/video-proxy?url=${encodeURIComponent(data.url)}`)
      if (!videoRes.ok) throw new Error('Gagal mengunduh file video dari TikTok')
      const blob = await videoRes.blob()
      if (blob.size < 1024) throw new Error('File video TikTok kosong / tidak bisa diunduh')

      let file = new File([blob], `tiktok_${Date.now()}.mp4`, {
        type: blob.type.startsWith('video/') ? blob.type : 'video/mp4',
      })

      if (file.size > MAX_VIDEO_REF_BYTES) {
        addLog(`Video TikTok ${(file.size / 1024 / 1024).toFixed(1)}MB > ${MAX_VIDEO_REF_MB}MB, mengompres…`)
        setCompressDialog({ msg: `Mengompres video TikTok ke maksimal ${MAX_VIDEO_REF_MB}MB...` })
        try {
          file = await compressVideo(file, MAX_VIDEO_REF_MB, (msg, pct) => {
            setCompressDialog({ msg, pct })
          })
        } finally {
          setCompressDialog(null)
        }
        if (file.size > MAX_VIDEO_REF_BYTES) {
          throw new Error(`Video masih ${(file.size / 1024 / 1024).toFixed(1)}MB setelah kompresi (maks ${MAX_VIDEO_REF_MB}MB)`)
        }
      }

      updateSlot(slotId, { video: file, videoUrl: URL.createObjectURL(file) })
      addLog(`Video TikTok siap: ${(file.size / 1024 / 1024).toFixed(1)}MB${data.hd ? ' (HD)' : ''}`, 'success')
      addToast('Video TikTok siap dipakai sebagai video referensi', 'success')
    } catch (err: any) {
      addLog(`Import TikTok gagal: ${err.message}`, 'error')
      addToast(`Gagal import TikTok: ${err.message}`, 'error')
      throw err
    }
  }

  const handleGenerate = async () => {
    if (generating) return
    const finalPrompt = prompt.trim()
    const isOmni = modelKey === 'rn:google-omni'
    const isAlrizI2v = provider === 'alriz' && getAlrizModel(modelKey.replace(/^al:/, ''))?.kind === 'i2v'
    const slotsImageOnly = isOmni || isAlrizI2v
    const filledSlots = slotsImageOnly
      ? slots.filter((s) => s.image)
      : slots.filter((s) => s.image && s.video)
    if (filledSlots.length === 0) return

    const isRoboneo = provider === 'roboneo'
    const isMagnific = provider === 'magnific'
    const isFramia = provider === 'framia'

    // Validate all slots comprehensively before generating
    const validationErrors: string[] = []
    const slotValidations: Array<{ id: string; index: number; error?: string }> = []
    
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const slotNum = i + 1
      
      // Check slot requirements based on model
      if (slotsImageOnly) {
        if (!slot.image) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload gambar`)
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload gambar' })
        }
      } else {
        if (!slot.image) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload gambar (motion control)`)
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload gambar' })
        }
        if (!slot.video) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload video referensi`
            + (slot.image ? '' : ', dan gambar'))
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload video referensi' })
        }
      }
      
      // Update slot validation status
      if (slotValidations.some(v => v.id === slot.id)) {
        updateSlotStatus(slot.id, 'error', slotValidations.find(v => v.id === slot.id)?.error)
      }
    }
    
    if (validationErrors.length > 0) {
      addLog(`❌ Validasi gagal: ${validationErrors.length} slot perlu diperbaiki`, 'error')
      validationErrors.forEach(err => addLog(err, 'error'))
      addToast('Harap perbaiki slot yang ditandai error terlebih dahulu', 'error')
      return
    }

    // Pre-check saldo vs estimasi biaya sebelum upload dimulai.
    // Alriz: user login dicek dari wallet internal (Rp), admin lolos, tamu
    // fallback ke cek key upstream (alz_...).
    const authSnapshot = useAuthStore.getState()
    const pre = await precheckProviderBalance(provider, totalCredits, {
      authToken: authSnapshot.token || undefined,
      isAdmin: authSnapshot.user?.role === 'admin',
    })
    if (!pre.ok) {
      addLog(`❌ ${pre.error}`, 'error')
      addToast(pre.error || 'Saldo tidak cukup', 'error')
      return
    }

    setGenerating(true)
    successRef.current = false
    generatingRef.current = true
    setLogs([])
    clearLogs()
    setProgress(0)

    // Reset slot statuses
    setSlots((prev) => prev.map((s) =>
      (slotsImageOnly ? s.image : s.image && s.video)
        ? { ...s, status: 'idle' as const, statusText: undefined, error: undefined, resultUrl: undefined }
        : s
    ))

    addLog(`🚀 Mulai generate video · ${currentProvider.name} · ${currentModel.label}`)
    addLog(`Mode: ${isOmni ? 'Image → Video (Google Omni)' : isAlrizI2v ? 'Image → Video (Alriz I2V — gambar + prompt)' : 'Motion Control (Image + Video)'}`)
    addLog(`Processing ${filledSlots.length} slot(s)...`)

    const startTime = Date.now()
    const currentUser = useAuthStore.getState().user
    const logId = currentUser ? await logGenerationStart({
      page: 'motion',
      provider,
      model: currentModel.label,
      prompt: prompt.slice(0, 500),
      credits: currentModel.cr * filledSlots.length,
      slot_count: filledSlots.length,
    }) : null

    // Provider berikut sudah punya task sendiri; sisanya diberi task sesi
    // supaya panel Generasi menampilkan "Sedang berjalan" selama proses.
    const SELF_TRACKED = new Set(['roboneo', 'runninghub', 'galleri5', 'genspark'])
    let ephemeralTaskId: string | null = null
    if (!SELF_TRACKED.has(provider)) {
      ephemeralTaskId = `motion-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      addActiveTask({
        id: ephemeralTaskId,
        taskId: ephemeralTaskId,
        roomId: '',
        token: '',
        model: currentModel.label,
        prompt: finalPrompt || '(no prompt)',
        startedAt: Date.now(),
        page: 'motion',
        provider,
        ephemeral: true,
      })
    }

    try {
      if (provider === 'seavi') {
        const spec = getSeaviSpec(modelKey.replace(/^sv:/, ''))
        if (!spec) throw new Error('Model Seavi tidak dikenal')

        // Upload semua slot sekali — rotasi kunci tidak perlu mengulang upload.
        const prepared: Array<{ slot: Slot; n: number; imageUrl: string; videoUrl: string }> = []
        let uploadNo = 0
        for (const slot of filledSlots) {
          uploadNo++
          updateSlotStatus(slot.id, 'uploading img...')
          const normImg = await normalizeImage(slot.image!, (msg) => addLog(`#${uploadNo} ${msg}`))
          const imageUrl = await uploadToCatbox(normImg, 'image', (msg, pct) => {
            updateSlotStatus(slot.id, 'uploading img...', pct != null ? `${msg} ${pct}%` : msg)
            addLog(`#${uploadNo} ${msg}${pct != null ? ` ${pct}%` : ''}`)
          })
          addLog(`#${uploadNo} ✅ Gambar ✓ ${imageUrl.slice(0, 60)}...`, 'success')
          updateSlotStatus(slot.id, 'uploading vid...')
          const compVid = await compressVideo(slot.video!, 4, (msg, pct) => {
            updateSlotStatus(slot.id, 'uploading vid...', pct != null ? `${msg} ${pct}%` : msg)
            addLog(`#${uploadNo} ${msg}${pct != null ? ` ${pct}%` : ''}`)
          })
          const videoUrl = await uploadToCatbox(compVid, 'video', (msg, pct) => {
            updateSlotStatus(slot.id, 'uploading vid...', pct != null ? `${msg} ${pct}%` : msg)
            addLog(`#${uploadNo} ${msg}${pct != null ? ` ${pct}%` : ''}`)
          })
          addLog(`#${uploadNo} ✅ Video ✓ ${videoUrl.slice(0, 60)}...`, 'success')
          prepared.push({ slot, n: uploadNo, imageUrl, videoUrl })
        }

        // Validasi kontrak model sebelum token dipotong.
        buildSeaviPayload(spec, {
          imageUrls: [prepared[0].imageUrl],
          videoUrls: [prepared[0].videoUrl],
          prompt: finalPrompt,
        })

        // Generate per slot; tiap slot dipotong & dikembalikan sendiri supaya
        // slot yang gagal tidak menghabiskan token slot lain.
        const rotation = await withTokenRotation<number>(
          'seavi',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`)
            let okCount = 0
            for (const item of prepared) {
              const { slot, n, imageUrl, videoUrl } = item
              let batchId: string | null = null
              let chargeId: number | null = null
              if (authRole !== 'admin' && authToken) {
                const charge = await chargeSeaviWallet(authToken, spec.id, 1)
                batchId = charge.batchId
                chargeId = charge.usageId ?? null
                setSeaviTokens(charge.tokens)
                addLog(`💰 #${n} ${charge.deducted} token dipotong · sisa ${charge.tokens}`, 'info')
              }
              try {
                updateSlotStatus(slot.id, 'processing', 'Mengirim ke Seavi...')
                const url = await generateWithSeavi({
                  apiKey,
                  chargeId,
                  spec,
                  imageUrls: [imageUrl],
                  videoUrls: [videoUrl],
                  prompt: finalPrompt,
                  onLog: (msg, level) => addLog(`#${n} ${msg}`, level as any),
                  onStatus: (text, pct) => updateSlotStatus(slot.id, 'processing', `${text} ${Math.round(pct || 0)}%`),
                })
                updateSlotStatus(slot.id, 'done')
                addLog(`#${n} ✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
                okCount++
                const rid = `seavi-mc-${Date.now()}-${n}`
                addResult({
                  id: rid,
                  url,
                  prompt: finalPrompt || '(motion control)',
                  date: new Date().toISOString(),
                  page: 'motion',
                  provider: 'seavi',
                  model: spec.label,
                })
                persistResultToR2(rid, url)
                setProgress(Math.round((okCount / prepared.length) * 100))
              } catch (slotErr: any) {
                if (batchId && authToken) {
                  const refunded = await refundSeaviWallet(authToken, { batch_id: batchId })
                  if (refunded != null) {
                    setSeaviTokens(refunded)
                    addLog(`💸 #${n} token dikembalikan ✓ sisa ${refunded}`, 'warn')
                  }
                }
                updateSlotStatus(slot.id, 'error', slotErr?.message || 'Gagal')
                addLog(`#${n} ❌ ${slotErr?.message || 'Gagal'}`, 'error')
                // Kunci ditolak → hentikan putaran ini agar kunci berikutnya dicoba.
                if (detectTokenError('seavi', slotErr)) throw slotErr
              }
            }
            return okCount
          },
          {
            allowServerKey: true,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
            },
            onError: (err, key) => {
              if (detectTokenError('seavi', err)) {
                addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
              }
            },
          },
        )

        const okCount = rotation.ok ? (rotation.result ?? 0) : 0
        if (okCount > 0) successRef.current = true
        if (rotation.ok) {
          addLog(okCount > 0 ? `Selesai — ${okCount} video` : 'Tidak ada video yang berhasil', okCount > 0 ? 'success' : 'error')
          if (logId) {
            if (okCount > 0) logGenerationComplete(logId, { status: 'completed', duration_ms: Date.now() - startTime })
            else logGenerationFailed(logId, 'Tidak ada video yang berhasil', Date.now() - startTime)
          }
        } else {
          addLog(`Generation failed: ${rotation.error}`, 'error')
          if (logId) logGenerationFailed(logId, rotation.error || 'Unknown error', Date.now() - startTime)
        }
        return
      }

      // Failover ke G5 AI Studio untuk slot yang gagal — dipakai HANYA setelah semua token
      // Roboneo dicoba dan tetap busy (rotasi token sudah jalan duluan di withTokenRotation).
      const runG5FailoverForSlot = async (slot: Slot, slotNum: number): Promise<boolean> => {
        const imageUrl = slot.imageUrl || ''
        const videoUrl = slot.videoUrl || ''
        if (!imageUrl || !videoUrl) {
          addLog(`#${slotNum} G5 failover skip — URL tidak tersimpan`, 'warn')
          return false
        }
        try {
          const lower = modelKey.toLowerCase()
          const g5Key = lower.includes('v30') || lower.includes('v3')
            ? 'g5:kling-v3-pro-motion-control'
            : lower.includes('pro')
            ? 'g5:kling-v2.6-pro-motion-control'
            : 'g5:kling-v2.6-std-motion-control'
          const g5Model = GALLERI5_MOTION_MODELS.find((m) => m.key === g5Key) || GALLERI5_MOTION_MODELS[GALLERI5_MOTION_MODELS.length - 1]
          addLog(`#${slotNum} Failover model: ${g5Model.label} (±${g5Model.cr} cr)`)

          const url = await runGalleri5WithRotation(
            async (g5Token: string) => {
              const headers = await getGalleri5AuthHeaders(g5Token)
              if (!headers) throw Error('Belum ada auth headers. Buka Manage → Tokens → G5 AI Studio, tambahkan Firebase refresh token (AMf-...) lalu klik Cek Limit & Status.')

              const submitResult = await submitGalleri5MotionControl({
                authHeaders: headers,
                modelKey: g5Key,
                imageUrl,
                videoUrl,
                keepOriginalSound: keepSound,
                orientation,
                prompt: finalPrompt || undefined,
                onProgress: (msg, pct) => {
                  updateSlotStatus(slot.id, 'processing', pct ? `${msg} ${pct}%` : msg)
                  addLog(`#${slotNum} ${msg}`)
                },
              })
              const taskId = submitResult.taskId
              addLog(`#${slotNum} Task (G5): ${taskId.slice(0, 60)}...`)

              addActiveTask({
                id: submitResult.sessionId,
                taskId: submitResult.sessionId,
                roomId: '',
                nodeId: '',
                token: JSON.stringify(headers).slice(0, 50),
                model: currentModel.label,
                prompt: finalPrompt || '(no prompt)',
                startedAt: Date.now(),
                page: 'motion',
              })

              let url = taskId
              // taskId URL = submit sudah mengembalikan hasil (dari SSE stream)
              if (!/^https?:\/\//i.test(taskId)) {
                updateSlotStatus(slot.id, 'processing', 'polling...')
                addLog(`#${slotNum} Polling for result...`)
                url = await pollGalleri5MotionControl(headers, submitResult.sessionId, (msg, pct) => {
                  updateSlotStatus(slot.id, 'processing', `${msg} ${pct}%`)
                  addLog(`#${slotNum} ${msg} ${pct}%`)
                  setProgress(pct)
                }, submitResult.orgId)
              }

              removeActiveTask(submitResult.sessionId)
              return url
            },
            {
              onRotate: (idx, total, reason) => {
                addLog(`#${slotNum} ↻ rotate token #${idx}/${total}: ${reason}`, 'warn')
              },
            }
          )

          updateSlotStatus(slot.id, 'done')
          addLog(`#${slotNum} Done (failover G5): ${url.slice(0, 60)}...`, 'success')
          const failoverId = `g5-failover-${Date.now()}-${slotNum}`
          addResult({
            id: failoverId,
            url,
            prompt: finalPrompt || '(no prompt)',
            date: new Date().toISOString(),
            page: 'motion',
          })
          persistResultToR2(failoverId, url)
          return true
        } catch (err: any) {
          setCompressDialog(null)
          const g5Msg = getGalleri5ErrorMessage(err)
          updateSlotStatus(slot.id, 'error', g5Msg)
          addLog(`#${slotNum} Failover G5 gagal: ${g5Msg}`, 'error')
          return false
        }
      }

      const rotation = await withTokenRotation<{ completedCount: number; failCount: number }>(
      provider,
      async (token) => {
        if (isRoboneo) {
          addLog('Checking Roboneo balance...')
          const balanceResult = await checkRoboneoBalance(token)
          if (!balanceResult.ok) {
            addLog(`Balance check: ${balanceResult.error}`, 'warn')
            throw new Error(`Token Roboneo tidak valid: ${balanceResult.error}`)
          } else {
            addLog(`Balance: ${balanceResult.balance ?? 'unknown'} · valid: ${balanceResult.isValidUser ? 'yes' : 'NO'}`)
            if (balanceResult.isValidUser === false) {
              throw new Error('Token Roboneo tidak valid (is_valid_user=false). Silakan update token.')
            }
            if (balanceResult.balance !== null && balanceResult.balance <= 0) {
              throw new Error('Balance kosong! Tidak ada credit untuk generate.')
            }
            if (balanceResult.balance !== null && currentModel.cr > 0 && balanceResult.balance < currentModel.cr) {
              throw new Error(`Balance tidak cukup! ${currentModel.label} butuh ${currentModel.cr} kredit (balance kamu ${balanceResult.balance}). Pilih model lebih murah (Kling 2.6 Standard ±86) atau top up dulu.`)
            }
          }
        }

        const processSlot = async (slot: Slot, slotNum: number, token: string, staggerMs: number = 0): Promise<boolean> => {
          // Stagger start to prevent overwhelming the server
          if (staggerMs > 0) await new Promise(r => setTimeout(r, staggerMs))

          if (isRoboneo && slot.image) {
            let taskId: string = ''
            let roomId: string = ''
            let nodeId: string = ''
            try {
              let imageUrl = slot.imageUrl || ''
              
              // Force re-upload if cached URL is blob URL (not accessible by RoboNeo)
              if (imageUrl && imageUrl.startsWith('blob:')) {
                addLog(`#${slotNum} ⚠ Cached image adalah blob URL, re-upload...`)
                imageUrl = ''
                updateSlot(slot.id, { imageUrl: null })
              }
              
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, _pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              let motionVideoUrl = slot.videoUrl || ''
              
              // Force re-upload if cached URL is blob URL
              if (motionVideoUrl && motionVideoUrl.startsWith('blob:')) {
                addLog(`#${slotNum} ⚠ Cached video adalah blob URL, re-upload...`)
                motionVideoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

              // Force re-upload if autoTrim is enabled
              if (autoTrim && isRoboneo && motionVideoUrl && slot.video) {
                addLog(`#${slotNum} Auto-trim aktif, re-upload video...`)
                motionVideoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

              if (isOmni) {
                updateSlotStatus(slot.id, 'processing', 'submitting...')
                addLog(`#${slotNum} Submit to Google Omni...`)
                const result = await submitGoogleOmni({
                  accessToken: token,
                  imageUrl,
                  prompt: finalPrompt || undefined,
                  ratio: '9:16',
                  videoDuration: 10,
                })
                taskId = result.taskId
                roomId = result.roomId
                addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)
              } else {
                if (!slot.video && !motionVideoUrl) {
                  addLog(`#${slotNum} Skipping (no video)`, 'warn')
                  return false
                }
                let uploadedVideoFile: File | null = null
                if (!motionVideoUrl) {
                  updateSlotStatus(slot.id, 'uploading vid...')

                  let videoToUpload = slot.video!
                  if (autoTrim && isRoboneo) {
                    addLog(`#${slotNum} ✂️ Memotong video ke 9 detik (FFmpeg)...`)
                    try {
                      const trimmed = await trimVideoFFmpeg(slot.video, 9, (msg, pct) => {
                        setCompressDialog({ msg, pct })
                        updateSlotStatus(slot.id, 'uploading vid...', msg)
                        addLog(`#${slotNum} ${msg}`)
                      })
                      videoToUpload = trimmed
                      addLog(`#${slotNum} ✅ Video dipotong: ${(trimmed.size / 1024 / 1024).toFixed(1)}MB`)
                    } catch (trimErr: any) {
                      addLog(`#${slotNum} ⚠ Trim gagal (${(trimErr?.message || 'error').slice(0, 60)}), video dikirim as-is.`, 'warn')
                    }
                  }

                  addLog(`#${slotNum} Upload video...`)
                  const videoFile = await compressVideo(videoToUpload, 4, (msg, pct) => {
                    setCompressDialog({ msg, pct })
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                    addLog(`#${slotNum} ${msg}`)
                  })
                  setCompressDialog(null)
                  uploadedVideoFile = videoFile
                  motionVideoUrl = await uploadToCatbox(videoFile, 'video', (msg, _pct) => {
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                    addLog(`#${slotNum} ${msg}`)
                  })
                  updateSlot(slot.id, { videoUrl: motionVideoUrl })
                  addLog(`#${slotNum} Video: ${motionVideoUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached video URL`)
                }

                updateSlotStatus(slot.id, 'processing', 'submitting...')
                addLog(`#${slotNum} Submit motion-control...`)

                // Detect video duration for billing (use the file actually uploaded — may be trimmed)
                let videoDurationSec = 10
                const durationSource = uploadedVideoFile || slot.video
                if (durationSource) {
                  videoDurationSec = await getVideoDurationFromFile(durationSource)
                  addLog(`#${slotNum} Video duration (uploaded): ${videoDurationSec}s`)
                }

                const SUBMIT_BUSY_RETRY = 8
                let submitResult: Awaited<ReturnType<typeof submitMotionControl>> | null = null
                let submitErr: any = null
                for (let s = 0; s < SUBMIT_BUSY_RETRY; s++) {
                  try {
                    submitResult = await submitMotionControl({
                      accessToken: token,
                      imageUrl,
                      videoUrl: motionVideoUrl,
                      prompt: finalPrompt || undefined,
                      negativePrompt: negativePrompt.trim() || undefined,
                      orientation,
                      keepSound,
                      modelKey: currentModel.key,
                    })
                    submitErr = null
                    break
                  } catch (e: any) {
                    const isBusy = /busy|sibuk|try again|later|overload|capacity|queue|系统繁忙|请稍后|拥挤|system is busy/i.test(e?.message || '')
                    if (isBusy && s < SUBMIT_BUSY_RETRY - 1) {
                      // Exponential backoff: 15s, 25s, 38s, 54s, 73s, 95s, 120s
                      const waitSec = Math.min(15 + s * 10 + Math.floor(s * s * 1.5), 120)
                      addLog(`#${slotNum} Server sibuk, retry ${s + 2}/${SUBMIT_BUSY_RETRY} (${waitSec}s)...`, 'warn')
                      await new Promise((r) => setTimeout(r, waitSec * 1000))
                      continue
                    }
                    if (s < SUBMIT_BUSY_RETRY - 1) {
                      const waitSec = 20 + s * 15
                      addLog(`#${slotNum} Submit gagal (${(e?.message || '').slice(0, 60)}), coba lagi ${s + 2}/${SUBMIT_BUSY_RETRY} (${waitSec}s)...`, 'warn')
                      await new Promise((r) => setTimeout(r, waitSec * 1000))
                      continue
                    }
                    submitErr = e
                    break
                  }
                }
                if (submitErr) throw submitErr
                taskId = submitResult!.taskId
                roomId = submitResult!.roomId
                nodeId = submitResult!.nodeId
                addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)
              }

              addActiveTask({
                id: taskId,
                taskId,
                roomId,
                nodeId,
                token,
                model: currentModel.label,
                prompt: finalPrompt || '(no prompt)',
                startedAt: Date.now(),
                page: 'motion',
              })
              const originalTaskId = taskId
              markTaskActivelyPolled(taskId)

              updateSlotStatus(slot.id, 'processing', 'polling...')
              addLog(`#${slotNum} Polling for result...`)

              let resultUrl: string | null = null
              const MAX_RESUBMIT = 5
              for (let attempt = 1; attempt <= MAX_RESUBMIT; attempt++) {
                try {
                  resultUrl = await pollRoboneoI2V(
                    token,
                    taskId,
                    roomId,
                    (status, pct) => {
                      updateSlotStatus(slot.id, 'processing', `${status} ${pct}%`)
                      addLog(`#${slotNum} ${status} ${pct}%`)
                      setProgress(pct)
                    },
                    3600000,
                    undefined,
                    nodeId
                  )
                  break
                } catch (pollErr: any) {
                  const isBusy = /busy|sibuk|try again|later|overload|capacity|queue|结果接口获取失败|error_code.*6/i.test(pollErr.message)
                  if (isBusy && attempt < MAX_RESUBMIT) {
                    const waitSec = 10 + attempt * 5
                    addLog(`#${slotNum} Server sibuk, retry ${attempt + 1}/${MAX_RESUBMIT} (${waitSec}s)...`, 'warn')
                    await new Promise((r) => setTimeout(r, waitSec * 1000))
                    if (isOmni) {
                      const retry = await submitGoogleOmni({
                        accessToken: token,
                        imageUrl,
                        prompt: finalPrompt || undefined,
                        ratio: '9:16',
                        videoDuration: 10,
                      })
                      taskId = retry.taskId
                      roomId = retry.roomId
                    } else {
                      const retry = await submitMotionControl({
                        accessToken: token,
                        imageUrl,
                        videoUrl: motionVideoUrl,
                        prompt: finalPrompt || undefined,
                        negativePrompt: negativePrompt.trim() || undefined,
                        orientation,
                        keepSound,
                        modelKey: currentModel.key,
                      })
                      taskId = retry.taskId
                      roomId = retry.roomId
                      nodeId = retry.nodeId
                    }
                    addLog(`#${slotNum} New task: ${taskId.slice(0, 20)}...`)
                    continue
                  }
                  throw pollErr
                }
              }

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl!.slice(0, 60)}...`, 'success')

              removeActiveTask(originalTaskId)
              addResult({
                id: taskId,
                url: resultUrl!,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
                provider: 'roboneo',
                model: currentModel?.label || currentModel?.key || '',
                taskUrl: roomId ? `https://www.roboneo.com/team_studio?room_id=${roomId}` : undefined,
              })
              persistResultToR2(taskId, resultUrl!)
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              removeActiveTask(taskId)
              
              if (isRoboneo && isRoboneoBalanceError(err.message)) {
                try {
                  const activeKey = useProviderManager.getState().getActiveKey('roboneo')
                  if (activeKey?.balance !== undefined && activeKey.balance !== null) {
                    const newMin = noteRoboneoMotionChargeFailure(activeKey.balance)
                    addLog(`⚠️ Motion min credits updated to ${newMin} (balance was ${activeKey.balance})`, 'warn')
                  }
                } catch (trackErr) {
                  console.error('[motion] Failed to track charge failure:', trackErr)
                }
              }
              // Error yang bisa dirotasi (busy/kredit/auth) → lempar ke atas supaya token berikutnya dicoba
              if (detectTokenError(provider, err)) {
                throw err
              }
              return false
            }
          } else if (isMagnific && slot.image && slot.video) {
            try {
              let imageUrl = slot.imageUrl || ''
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, _pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              let videoUrl = slot.videoUrl || ''
              if (!videoUrl) {
                updateSlotStatus(slot.id, 'uploading vid...')
                addLog(`#${slotNum} Upload video...`)
                const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                videoUrl = await uploadToCatbox(videoFile, 'video', (msg, _pct) => {
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { videoUrl })
                addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached video URL`)
              }

              const magnificKey = getMagnificApiKey()
              if (!magnificKey) throw Error('Belum ada Magnific API key')

              const modelSlug = modelKey.replace('mag:', '') as MagnificMotionModel
              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke Magnific (${modelSlug})...`)

              const taskId = await submitMagnificMotion({
                apiKey: magnificKey,
                model: modelSlug,
                imageUrl,
                videoUrl,
                prompt: finalPrompt || undefined,
                orientation,
              })
              addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)

              updateSlotStatus(slot.id, 'processing', 'polling...')
              addLog(`#${slotNum} Polling for result...`)

              const resultUrl = await pollMagnificMotion(magnificKey, modelSlug, taskId, (msg, pct) => {
                updateSlotStatus(slot.id, 'processing', msg)
                addLog(`#${slotNum} ${msg}`)
                if (pct) setProgress(pct)
              })

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              addResult({
                id: taskId,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              persistResultToR2(taskId, resultUrl)
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (isFramia) {
            throw new Error('Provider aktif Framia. Gunakan Generate → Framia untuk menjalankan node/canvas Framia secara langsung.')
          } else if (provider === 'weavy' && slot.image && slot.video) {
            try {
              let imageUrl = slot.imageUrl || ''
              let videoUrl = slot.videoUrl || ''

              // Clear blob URLs - they can't be accessed by Weavy server
              if (imageUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Clearing invalid blob URL for image, re-uploading...`, 'warn')
                imageUrl = ''
                updateSlot(slot.id, { imageUrl: null })
              }
              if (videoUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Clearing invalid blob URL for video, re-uploading...`, 'warn')
                videoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

              if (!imageUrl || !videoUrl) {
                const tokenInfo = await getActiveWeavyAccessToken()
                if (!tokenInfo) throw Error('Tidak ada Weavy token aktif. Tambahkan token di Providers.')
                const weavyToken = tokenInfo.accessToken

                if (!imageUrl) {
                  let imageFile = slot.image
                  if (imageFile.size > 8 * 1024 * 1024) {
                    addLog(`#${slotNum} Compressing image...`)
                    updateSlotStatus(slot.id, 'uploading img...', 'Compressing...')
                    const compressed = await compressImageForWeavy(imageFile, 1280, 0.8)
                    imageFile = compressed
                  }
                  updateSlotStatus(slot.id, 'uploading img...')
                  addLog(`#${slotNum} Upload image to Weavy...`)
                  const imgAsset = await uploadWeavyAssetWithRetry(
                    imageFile,
                    `ref_img_${slotNum}_${Date.now()}.jpg`,
                    weavyToken
                  )
                  imageUrl = resolveWeavyAssetUrl(imgAsset, 'image')
                  updateSlot(slot.id, { imageUrl })
                  addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached image URL`)
                }

                if (!videoUrl) {
                  updateSlotStatus(slot.id, 'uploading vid...')
                  addLog(`#${slotNum} Upload video to Weavy...`)
                  const vidAsset = await uploadWeavyAssetWithRetry(
                    slot.video,
                    `ref_vid_${slotNum}_${Date.now()}.mp4`,
                    weavyToken
                  )
                  videoUrl = resolveWeavyAssetUrl(vidAsset, 'video')
                  updateSlot(slot.id, { videoUrl })
                  addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached video URL`)
                }
              } else {
                addLog(`#${slotNum} Using cached image & video URLs`)
              }

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke Weavy (${currentModel.label}) — recipe mode...`)

              const result = await submitWeavyMotionControl({
                modelKey,
                imageUrl,
                videoUrl,
                orientation,
                keepSound,
                prompt: finalPrompt || undefined,
                onProgress: (status, pct) => {
                  updateSlotStatus(slot.id, 'processing', pct ? `${status} ${pct}%` : status)
                  addLog(`#${slotNum} ${status}`)
                },
              })
              if (!result.ok || !result.videoUrl) throw Error(result.error || 'Submit failed')
              const resultUrl = result.videoUrl

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              const weavyId = `weavy-${Date.now().toString(36)}-${slotNum}`
              addResult({
                id: weavyId,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              persistResultToR2(weavyId, resultUrl)
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'runninghub' && slot.image && slot.video) {
              let attemptTaskId: string | null = null
              let lastTaskId: string | null = null
            try {
              const runninghubKey = getRunningHubApiKey()
              if (!runninghubKey) throw Error('Belum ada RunningHub API key. Silakan tambahkan di Settings.')

              let mode = 'pro'
              let modelVersion = '2.6'
              if (modelKey.startsWith('rh:')) {
                const parts = modelKey.split(':')
                if (parts.length >= 3) {
                  mode = parts[1] || 'pro'
                  modelVersion = parts[2] || '2.6'
                } else if (parts.length === 2) {
                  const modelPart = parts[1]
                  if (modelPart.includes('pro')) mode = 'pro'
                  else if (modelPart.includes('std')) mode = 'std'
                  if (modelPart.includes('3.0') || modelPart.includes('v3')) modelVersion = '3.0'
                  else if (modelPart.includes('2.1')) modelVersion = '2.1'
                  else modelVersion = '2.6'
                }
              }

              updateSlotStatus(slot.id, 'uploading img...')
              addLog(`#${slotNum} Compress image...`)
              const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading img...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)
              addLog(`#${slotNum} Image: ${normalizedImage.name || 'ready'}`)

              updateSlotStatus(slot.id, 'uploading vid...')
              addLog(`#${slotNum} Compress video...`)
              const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading vid...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)
              addLog(`#${slotNum} Video: ${videoFile.name || 'ready'}`)

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              const WORKFLOW_IDS: Record<string, string> = {
                'rh:wf:2.9': '2092795737699856386',
                'rh:wf:v3.0': '2093040535905165313',
                'rh:wf:ultra-hd': '2102004799470764034',
                'rh:wf:mc-pro': '2103523610144309249',
                'rh:wf:eposcents': '2107144516724932610',
                'rh:wf:kontrol-gerakan': '2112893346377531393',
              }
              const workflowId = WORKFLOW_IDS[modelKey] || getRunningHubWorkflowId()
              addLog(modelKey === 'rh:wf:ultra-hd'
                ? `#${slotNum} Submit ke RunningHub Ultra HD (fps: ${ultraFps}, steps: ${ultraSteps}, maxFrames: ${ultraMaxFrames})`
                : modelKey === 'rh:wf:mc-pro'
                  ? `#${slotNum} Submit ke RunningHub Motion Control Pro / Motion Transfer (maks 15s, workflow: ${workflowId.slice(0, 15)}...)`
                  : modelKey === 'rh:wf:eposcents'
                    ? `#${slotNum} Submit ke RunningHub Eposcents MC (512HD 32FPS, maks 50s, workflow: ${workflowId.slice(0, 15)}...)`
                    : modelKey === 'rh:wf:kontrol-gerakan'
                      ? `#${slotNum} Submit ke RunningHub Kontrol Gerak 50FPS (maks 24s, workflow: ${workflowId.slice(0, 15)}...)`
                      : `#${slotNum} Submit ke RunningHub (${modelVersion} ${mode}, workflow: ${workflowId.slice(0, 15)}...)`)

              // Motion Control Pro: referensi maks 15 detik.
              // Eposcents MC: referensi maks 50 detik (>30s otomatis instance Plus).
              // Kontrol Gerak 50FPS: benchmark app 24 detik (1200 frame @ 50fps).
              let mcProVideoFile = videoFile
              if ((modelKey === 'rh:wf:mc-pro' || modelKey === 'rh:wf:eposcents' || modelKey === 'rh:wf:kontrol-gerakan') && slot.video) {
                const MAX_MOTION_DURATION = modelKey === 'rh:wf:eposcents'
                  ? 50
                  : modelKey === 'rh:wf:kontrol-gerakan' ? 24 : 15
                try {
                  const rawDuration = await getVideoDurationFromFile(slot.video)
                  if (rawDuration > MAX_MOTION_DURATION + 0.2) {
                    addLog(`#${slotNum} Referensi ${Math.round(rawDuration)}s > ${MAX_MOTION_DURATION}s, trimming...`)
                    mcProVideoFile = await trimVideoFFmpeg(videoFile, MAX_MOTION_DURATION, (msg, pct) => {
                      setCompressDialog({ msg, pct })
                      updateSlotStatus(slot.id, 'uploading vid...', msg)
                      addLog(`#${slotNum} ${msg}`)
                    })
                    setCompressDialog(null)
                    addLog(`#${slotNum} Video referensi: ${mcProVideoFile.name || 'ready'} (${MAX_MOTION_DURATION}s)`)
                  } else {
                    addLog(`#${slotNum} Durasi referensi: ${Math.round(rawDuration)}s (maks ${MAX_MOTION_DURATION}s)`)
                  }
                } catch {}
              }

              const rotation = await withTokenRotation<string>(
                'runninghub',
                async (apiKey, keyInfo) => {
                  addLog(`#${slotNum} 🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info')
                  const result = modelKey === 'rh:wf:ultra-hd'
                    ? await submitRunningHubUltraFastHD({
                      imageFile: normalizedImage,
                      videoFile,
                      fps: ultraFps,
                      steps: ultraSteps,
                      maxFrames: ultraMaxFrames,
                      prompt: finalPrompt || undefined,
                      negativePrompt: negativePrompt.trim() || undefined,
                      apiKey,
                      workflowId,
                    })
                    : modelKey === 'rh:wf:mc-pro'
                      ? await submitRunningHubMotionApp({
                        action: 'motion-control-pro',
                        imageFile: normalizedImage,
                        videoFile: mcProVideoFile,
                        prompt: finalPrompt || undefined,
                        negativePrompt: negativePrompt.trim() || undefined,
                        apiKey,
                        workflowId,
                      })
                      : modelKey === 'rh:wf:eposcents'
                        ? await submitRunningHubMotionApp({
                          action: 'motion-control-eposcents',
                          imageFile: normalizedImage,
                          videoFile: mcProVideoFile,
                          durationHint: await getVideoDurationFromFile(mcProVideoFile).catch(() => 0),
                          prompt: finalPrompt || undefined,
                          negativePrompt: negativePrompt.trim() || undefined,
                          apiKey,
                          workflowId,
                        })
                        : modelKey === 'rh:wf:kontrol-gerakan'
                          ? await submitRunningHubMotionApp({
                            action: 'motion-control-kontrol-gerakan',
                            imageFile: normalizedImage,
                            videoFile: mcProVideoFile,
                            apiKey,
                            workflowId,
                          })
                          : await submitRunningHubMotionControl({
                    imageFile: normalizedImage,
                    videoFile,
                    prompt: finalPrompt || undefined,
                    negativePrompt: negativePrompt.trim() || undefined,
                    keepOriginalSound: keepSound,
                    modelVersion,
                    mode,
                    apiKey,
                    workflowId,
                  })
                  const taskId = result.taskId
                  attemptTaskId = taskId
                  lastTaskId = taskId
                  addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)

                  addActiveTask({
                    id: taskId,
                    taskId,
                    roomId: '',
                    nodeId: '',
                    token: apiKey,
                    model: currentModel.label,
                    prompt: finalPrompt || '(no prompt)',
                    startedAt: Date.now(),
                    page: 'motion',
                    provider: 'runninghub',
                  })

                  updateSlotStatus(slot.id, 'processing', 'polling...')
                  markTaskActivelyPolled(taskId)
                  addLog(`#${slotNum} Polling for result...`)

                  const resultUrl = await pollRunningHubTask(taskId, (status, pct) => {
                    updateSlotStatus(slot.id, 'processing', `${status} ${pct}%`)
                    addLog(`#${slotNum} ${status} ${pct}%`)
                    setProgress(pct)
                  }, 3600000, apiKey, currentModel.label)
                  removeActiveTask(taskId)
                  attemptTaskId = null
                  return resultUrl
                },
                {
                  onKeySwitch: (from, to, attempt) => {
                    addLog(`#${slotNum} 🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`, 'warn')
                    if (attemptTaskId) removeActiveTask(attemptTaskId)
                    attemptTaskId = null
                  },
                  onError: (err, key) => {
                    if (detectTokenError('runninghub', err)) {
                      addLog(`#${slotNum} ⚠️ Key "${key.name}" bermasalah: ${err.message}`, 'warn')
                    }
                  },
                }
              )
              if (!rotation.ok || !rotation.result) {
                throw new Error(rotation.error || 'Generation failed')
              }
              if (rotation.triedKeys > 1) {
                addLog(`#${slotNum} ✅ Used key: ${rotation.usedKey?.name} (setelah ${rotation.triedKeys} key dicoba)`, 'success')
              }
              const resultUrl = rotation.result
              const doneTaskId = lastTaskId || `rh-${Date.now()}`

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              addResult({
                id: doneTaskId,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              persistResultToR2(doneTaskId, resultUrl)
              return true
            } catch (err: any) {
              if (attemptTaskId) removeActiveTask(attemptTaskId)
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'galleri5' && slot.image && slot.video) {
            try {
              const g5Model = GALLERI5_MOTION_MODELS.find((m) => m.key === modelKey) || GALLERI5_MOTION_MODELS[GALLERI5_MOTION_MODELS.length - 1]
              addLog(`#${slotNum} Model: ${g5Model.label} (±${g5Model.cr} cr)`)

              // Always re-upload to avoid expired cached URLs
              updateSlotStatus(slot.id, 'uploading img...')
              addLog(`#${slotNum} Upload image...`)
              const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading img...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)
              const imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, _pct) => {
                updateSlotStatus(slot.id, 'uploading img...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              updateSlot(slot.id, { imageUrl })
              addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)

              updateSlotStatus(slot.id, 'uploading vid...')
              addLog(`#${slotNum} Upload video...`)
                const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                const motionVideoUrl = await uploadToCatbox(videoFile, 'video', (msg, _pct) => {
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { videoUrl: motionVideoUrl })
                addLog(`#${slotNum} Video: ${motionVideoUrl.slice(0, 60)}...`)

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke G5 AI Studio (${g5Model.modelPath})...`)

              await runGalleri5WithRotation(
                async (token: string) => {
                  const headers = await getGalleri5AuthHeaders(token)
                  if (!headers) throw Error('Belum ada auth headers. Buka Manage → Tokens → G5 AI Studio, tambahkan Firebase refresh token (AMf-...) lalu klik Cek Limit & Status.')

                  const submitResult = await submitGalleri5MotionControl({
                    authHeaders: headers,
                    modelKey,
                    imageUrl,
                    videoUrl: motionVideoUrl,
                    imageFile: normalizedImage,
                    videoFile: videoFile,
                    keepOriginalSound: keepSound,
                    adaptMotion: modelKey === 'g5:wan-motion' ? adaptMotion : undefined,
                    safetyChecker: modelKey === 'g5:wan-motion' ? safetyChecker : undefined,
                    enhanceIdentity: modelKey === 'g5:wan-motion' ? enhanceIdentity : undefined,
                    orientation,
                    prompt: finalPrompt || undefined,
                    onProgress: (msg, pct) => {
                      updateSlotStatus(slot.id, 'processing', pct ? `${msg} ${pct}%` : msg)
                      addLog(`#${slotNum} ${msg}`)
                    },
                  })
                  const taskId = submitResult.taskId
                  addLog(`#${slotNum} Task: ${taskId.slice(0, 60)}...`)

                  addActiveTask({
                    id: submitResult.sessionId,
                    taskId: submitResult.sessionId,
                    roomId: '',
                    nodeId: '',
                    token: JSON.stringify(headers).slice(0, 50),
                    model: currentModel.label,
                    prompt: finalPrompt || '(no prompt)',
                    startedAt: Date.now(),
                    page: 'motion',
                  })

                  let url = taskId
                  // If taskId is a URL, submit already returned the result (from SSE stream)
                  if (!/^https?:\/\//i.test(taskId)) {
                    // taskId is a sessionId — need to poll
                    updateSlotStatus(slot.id, 'processing', 'polling...')
                    addLog(`#${slotNum} Polling for result...`)
                    url = await pollGalleri5MotionControl(headers, submitResult.sessionId, (msg, pct) => {
                      updateSlotStatus(slot.id, 'processing', `${msg} ${pct}%`)
                      addLog(`#${slotNum} ${msg} ${pct}%`)
                      setProgress(pct)
                    }, submitResult.orgId)
                  }

                  updateSlotStatus(slot.id, 'done')
                  addLog(`#${slotNum} Done: ${url.slice(0, 60)}...`, 'success')

                  removeActiveTask(submitResult.sessionId)
                  addResult({
                    id: submitResult.sessionId,
                    url,
                    prompt: finalPrompt || '(no prompt)',
                    date: new Date().toISOString(),
                    page: 'motion',
                  })
                  persistResultToR2(submitResult.sessionId, url)
                  return url
                },
                {
                  onRotate: (idx, total, reason) => {
                    addLog(`#${slotNum} ↻ rotate token #${idx}/${total}: ${reason}`, 'warn')
                  },
                }
              )
              return true
            } catch (err: any) {
              setCompressDialog(null)
              const errorMsg = provider === 'galleri5' ? getGalleri5ErrorMessage(err) : err.message
              updateSlotStatus(slot.id, 'error', errorMsg)
              addLog(`#${slotNum} Error: ${errorMsg}`, 'error')
              
              // If model restricted, don't retry with other tokens (same model won't work)
              if (provider === 'galleri5' && isGalleri5ModelRestricted(err.message)) {
                throw new Error(errorMsg)
              }
              
              return false
            }
          } else if (provider === 'oneover' && slot.image) {
            // ─── OneOver: image-to-video via Grok / Seedance / Gemini ────
            try {
              let imageUrl = slot.imageUrl || ''
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                imageUrl = await uploadToCatbox(slot.image, 'image', (msg, _pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              // Convert image to base64 for OneOver API
              const { fileToBase64 } = await import('@/lib/oneover')
              const referenceImageBase64 = await fileToBase64(slot.image)

              const apiModel = modelKey.replace('oo:', '')
              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke OneOver (${apiModel})...`)

              const { generateWithOneOver } = await import('@/lib/oneover')
              const resultUrl = await generateWithOneOver({
                apiKey: token,
                prompt: finalPrompt || 'animate this image',
                model: apiModel,
                duration: 5,
                resolution: '720p',
                aspectRatio: '9:16',
                generateAudio: true,
                referenceImageBase64,
                omniTask: 'image_to_video',
                onLog: (msg) => addLog(`#${slotNum} ${msg}`),
                onStatus: (text, pct) => {
                  updateSlotStatus(slot.id, 'processing', text)
                  setProgress(pct)
                },
              })

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              addResult({
                id: `oneover-${Date.now()}`,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
                provider: 'oneover',
                model: currentModel.label,
              })
              persistResultToR2(`oneover-${Date.now()}`, resultUrl)
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'alriz' && slot.image && (slot.video || isAlrizI2v)) {
            // ─── Alriz Motion: Kling Motion Control via alrizmotion.my.id ───
            // Wallet internal: user login dipotong harga model per video
            // (Rp 750–1.500, tarif dari server) SEBELUM upload — kalau saldo
            // kurang gagal cepat. Admin lolos tanpa potongan; tamu tanpa login
            // lewat tanpa wallet (key sendiri, saldo key dipotong upstream).
            // Batch id dibuat di awal supaya semua kegagalan setelah charge
            // (upload/submit/poll) bisa di-refund.
            const alrizAuth = useAuthStore.getState()
            const alrizIsAdmin = alrizAuth.user?.role === 'admin'
            const alrizAuthToken = alrizAuth.token || ''
            const alrizBatchId = !alrizIsAdmin && alrizAuthToken
              ? `alriz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              : null
            let alrizCharged = 0
            let alrizUsageId: number | null = null
            try {
              const alrizModel = modelKey.replace(/^al:/, '')
              addLog(`#${slotNum} Model: ${currentModel.label} (Rp ${currentModel.cr.toLocaleString('id-ID')}) [api: ${alrizModel}]`)

              if (alrizBatchId) {
                addLog(`#${slotNum} 💰 Memotong saldo Alriz...`)
                const charge = await chargeAlrizWallet(alrizAuthToken, alrizModel, 1, alrizBatchId)
                alrizCharged = charge.deducted
                alrizUsageId = charge.usageId ?? null
                addLog(`#${slotNum} ✅ Terpotong Rp ${charge.deducted.toLocaleString('id-ID')} ✓ sisa Rp ${charge.balance.toLocaleString('id-ID')}`, 'success')
              } else if (alrizIsAdmin) {
                addLog(`#${slotNum} ⚡ Admin mode — skip saldo wallet`, 'info')
              } else {
                addLog(`#${slotNum} ℹ️ Tamu — saldo dipotong dari key upstream`, 'info')
              }

              let imageUrl = slot.imageUrl || ''
              if (!imageUrl || imageUrl.startsWith('blob:')) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                })
                updateSlot(slot.id, { imageUrl })
              }
              addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)

              let videoUrl = ''
              if (!isAlrizI2v) {
                videoUrl = slot.videoUrl || ''
                if (!videoUrl || videoUrl.startsWith('blob:')) {
                  updateSlotStatus(slot.id, 'uploading vid...')
                  addLog(`#${slotNum} Upload video...`)
                  const videoFile = await compressVideo(slot.video, 4, (msg) => {
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                  })
                  videoUrl = await uploadToCatbox(videoFile, 'video', (msg) => {
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                  })
                  updateSlot(slot.id, { videoUrl })
                }
              } else {
                updateSlot(slot.id, { videoUrl: undefined })
              }
              if (videoUrl) addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke Alriz (${alrizModel})...`)
              const resultUrl = await generateWithAlriz({
                apiKey: token,
                chargeId: alrizUsageId,
                model: alrizModel,
                imageUrl,
                videoUrl,
                prompt: finalPrompt || undefined,
                onLog: (msg, level) => addLog(`#${slotNum} ${msg}`, (level as any) || 'info'),
                onStatus: (text, pct) => {
                  updateSlotStatus(slot.id, 'processing', text)
                  if (pct) setProgress(pct)
                },
              })

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              const alrizId = `alriz-${Date.now().toString(36)}`
              addResult({
                id: alrizId,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              persistResultToR2(alrizId, resultUrl)
              return true
            } catch (err: any) {
              // Job gagal (upload/submit/poll/kapasitas) → kembalikan saldo
              // yang tadi dipotong. Upstream Alriz sudah refund key-nya
              // sendiri untuk STK/GEN; ini refund wallet app.
              if (alrizBatchId && alrizCharged > 0) {
                const refunded = await refundAlrizWallet(alrizAuthToken, { batch_id: alrizBatchId })
                if (refunded != null) {
                  addLog(`#${slotNum} ↩ Refund Rp ${alrizCharged.toLocaleString('id-ID')} ✓ sisa Rp ${refunded.toLocaleString('id-ID')}`, 'info')
                } else {
                  addLog(`#${slotNum} ⚠️ Refund wallet gagal — hubungi admin (batch ${alrizBatchId})`, 'error')
                }
              }
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'genspark' && slot.image && slot.video) {
            // ─── Genspark: Kling V3 Motion Control ────
            try {
              const gensparkTier = modelKey.includes('pro') ? 'pro' : 'standard'
              const gensparkModel = `kling/v3/motion-control`

              addLog(`#${slotNum} Model: ${currentModel.label} [api: ${gensparkModel}] (Genspark)`)

              // Upload image
              updateSlotStatus(slot.id, 'uploading img...')
              addLog(`#${slotNum} Compress image...`)
              const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading img...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)

              // Upload image to Genspark or use cached URL
              let imageUrl = slot.imageUrl || ''
              if (!imageUrl || imageUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Upload image to Genspark...`)
                addLog(`#${slotNum} Image info: ${normalizedImage.type}, ${(normalizedImage.size/1024).toFixed(1)}KB`)
                imageUrl = await uploadToGenspark(normalizedImage)
                updateSlot(slot.id, { imageUrl })
              }
              addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)

              // Upload video
              updateSlotStatus(slot.id, 'uploading vid...')
              addLog(`#${slotNum} Compress video...`)
              const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading vid...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)

              let videoUrl = slot.videoUrl || ''
              if (!videoUrl || videoUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Upload video to Genspark...`)
                addLog(`#${slotNum} Video info: ${videoFile.type}, ${(videoFile.size/(1024*1024)).toFixed(2)}MB`)
                videoUrl = await uploadToGenspark(videoFile)
                updateSlot(slot.id, { videoUrl })
              }
              addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)

              // Get video duration for motion control — output selalu di-cap 10 detik
              const maxDuration = 10
              let motionDuration = 5
              if (slot.video) {
                try {
                  const rawDuration = await getVideoDurationFromFile(slot.video)
                  motionDuration = Math.min(rawDuration, maxDuration)
                  addLog(`#${slotNum} Video duration: ${motionDuration}s (max ${maxDuration}s)`)
                } catch {}
              }

              // Submit to Genspark
              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} 📋 Model: ${gensparkModel} (${gensparkTier}) | Orientation: ${orientation} | Duration: ${motionDuration}s`)
              addLog(`#${slotNum} Submitting to Genspark API...`)

              let result = await submitGensparkVideo({
                prompt: finalPrompt || 'animate this character with the motion from the reference video',
                model: gensparkModel,
                imageUrl,
                videoUrl,
                duration: motionDuration,
                aspectRatio: '9:16',
                extraParams: {
                  character_orientation: orientation,
                  tier: gensparkTier,
                  video_size: 'auto',
                  ...(keepSound ? { audio_enable: false, keep_audio: true } : { audio_enable: true }),
                },
              })

              // Check for FAILURE in initial response
              let resultUrl: string | null = null
              const gv0 = result?.data?.generated_videos?.[0] as any
              const taskId0 = gv0?.task_id || result?.data?.task_id
              if ((gv0?.status === 'FAILURE' || gv0?.status === 'FAILED') && taskId0) {
                const reason = gv0.failure_reason || gv0.error_message || 'Unknown error'
                const tryCount = gv0.try_count || 0
                addLog(`#${slotNum} ⚠️ Kling FAILED (${tryCount}x): ${reason}`)
                addLog(`#${slotNum} 💡 Kling server intermittent — retrying dengan backoff...`)

                // Aggressive retry: try each duration up to 3 times with backoff
                // Kling V3 motion-control hanya menerima durasi valid (5/10 detik)
                const retryDurations = [motionDuration, 5].filter((d, i, arr) => arr.indexOf(d) === i && d <= motionDuration)
                for (const retryDur of retryDurations) {
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    const waitSec = attempt * 15 // 15s, 30s, 45s backoff
                    addLog(`#${slotNum} 🔄 Retry ${retryDur}s (attempt ${attempt}/3, wait ${waitSec}s)...`)
                    await new Promise(r => setTimeout(r, waitSec * 1000))
                    try {
                      const retryResult = await submitGensparkVideo({
                        prompt: finalPrompt || 'animate this character with the motion from the reference video',
                        model: gensparkModel,
                        imageUrl,
                        videoUrl,
                        duration: retryDur,
                        aspectRatio: '9:16',
                        extraParams: {
                          character_orientation: orientation,
                          tier: gensparkTier,
                          video_size: 'auto',
                          ...(keepSound ? { audio_enable: false, keep_audio: true } : { audio_enable: true }),
                        },
                      })
                      const rv = retryResult?.data?.generated_videos?.[0] as any
                      if (rv?.status !== 'FAILURE' && rv?.status !== 'FAILED') {
                        result = retryResult
                        resultUrl = extractGensparkVideoUrl(retryResult, { imageUrl, videoUrl })
                        if (resultUrl) break
                      }
                    } catch {}
                  }
                  if (resultUrl) break
                }
              } // end if FAILURE

              // Extract video URL
              if (!resultUrl) {
                resultUrl = extractGensparkVideoUrl(result, { imageUrl, videoUrl })
              }

              // Kalau belum ada URL tapi ada task_id → task masih diproses, polling
              const gvLatest = result?.data?.generated_videos?.[0] as any
              const taskIdLatest = gvLatest?.task_id || result?.data?.task_id || taskId0
              const latestStatus = String(gvLatest?.status || gv0?.status || result?.status || 'pending').toUpperCase()
              if (!resultUrl && taskIdLatest && !['FAILURE', 'FAILED', 'ERROR'].includes(latestStatus)) {
                updateSlotStatus(slot.id, 'processing', 'polling...')
                addLog(`#${slotNum} Task diterima (${latestStatus}), polling hasil...`)
                addActiveTask({
                  id: `genspark-${taskIdLatest}`,
                  taskId: taskIdLatest,
                  roomId: '',
                  nodeId: '',
                  token: token?.slice(0, 50) || '',
                  model: currentModel.label,
                  prompt: finalPrompt || '(no prompt)',
                  startedAt: Date.now(),
                  page: 'motion',
                })
                try {
                  resultUrl = await pollGensparkVideo(taskIdLatest, (msg) => {
                    updateSlotStatus(slot.id, 'processing', msg)
                    addLog(`#${slotNum} ${msg}`)
                  })
                } finally {
                  removeActiveTask(`genspark-${taskIdLatest}`)
                }
              }

              if (!resultUrl) {
                const finalStatus = latestStatus || (gv0?.status || '').toUpperCase()
                if (finalStatus === 'FAILURE' || finalStatus === 'FAILED' || finalStatus === 'ERROR') {
                  const reason = gvLatest?.failure_reason || gvLatest?.error_message || gv0?.failure_reason || gv0?.error_message
                  throw new Error(`Genspark/Kling gagal: ${reason || 'server sedang down'}. Coba lagi beberapa menit, atau gunakan provider lain (Weavy/Wavespeed) yang lebih stabil.`)
                }
                // Genspark membungkus error asli di data.result (mis. "Your credits are insufficient")
                // sementara status/message-nya bilang "ok"/"success" — jangan percaya envelope itu.
                const rawResult = (result as any)?.data?.result
                const realMsg = typeof rawResult === 'string' && !/^https?:\/\//i.test(rawResult)
                  ? rawResult
                  : result?.message || result?.data?.message
                throw new Error(realMsg && realMsg !== 'success' ? `Genspark: ${realMsg}` : 'Genspark: tidak ada URL video (kemungkinan credits tidak cukup atau task ditolak)')
              }

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              const gensparkId = `genspark-${Date.now()}-${slotNum}`
              addResult({
                id: gensparkId,
                url: resultUrl,
                prompt: finalPrompt || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
                provider: 'genspark',
                model: currentModel.label,
              })
              persistResultToR2(gensparkId, resultUrl)
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else {
            addLog(`#${slotNum} Skipping (no image/video)`, 'warn')
            return false
          }
        }

        addLog(`🚀 Running ${filledSlots.length} slot(s) in parallel...`)

        const slotResults = await Promise.allSettled(
          filledSlots.map((slot, i) => processSlot(slot, i + 1, token, i * 1500))
        )

        let successCount = 0
        let failCount = 0
        let rotatableErr: any = null
        for (const r of slotResults) {
          if (r.status === 'fulfilled' && r.value) successCount++
          else {
            failCount++
            if (!rotatableErr && r.status === 'rejected' && detectTokenError(provider, r.reason)) {
              rotatableErr = r.reason
            }
          }
        }

        // Semua slot gagal dengan error yang bisa dirotasi → lempar supaya token berikutnya dicoba
        if (failCount > 0 && successCount === 0 && rotatableErr) {
          addLog(`🔁 Semua slot gagal (${failCount}) — coba token berikutnya...`, 'warn')
          throw rotatableErr
        }

        return { completedCount: successCount, failCount }
      },
      {
        requiredCredits: totalCredits,
        // Alriz tanpa API key sendiri: relay memasang kunci server untuk
        // member yang sudah top up. Provider lain tidak memakai opsi ini.
        allowServerKey: provider === 'alriz',
        onKeySwitch: (from, to, attempt) => {
          addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
        },
        onError: (err, key) => {
          if (detectTokenError(provider, err)) {
            addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
          }
        },
      }
    )

    if (rotation.ok) {
      successRef.current = true
      const successCount = rotation.result?.completedCount ?? 0
      const failCount = rotation.result?.failCount ?? 0
      if (rotation.triedKeys > 1) {
        addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
      }
      if (failCount > 0 && successCount > 0) {
        addLog(`Selesai — ${successCount} sukses · ${failCount} gagal`, 'warn')
      } else if (failCount > 0) {
        addLog(`Semua slot gagal (${failCount})`, 'error')
      } else {
        addLog(`Selesai — ${successCount} video`, 'success')
      }
      if (logId) logGenerationComplete(logId, { status: 'completed', duration_ms: Date.now() - startTime })
    } else {
      addLog(`Generation failed: ${rotation.error}`, 'error')
      if (logId) logGenerationFailed(logId, rotation.error || 'Unknown error', Date.now() - startTime)
      // Semua token Roboneo sudah dicoba & masih busy → failover terakhir ke G5 AI Studio
      if (isRoboneo && isRoboneoBusyError(rotation.error || '')) {
        const failedSlots = filledSlots.filter((s) => s.status === 'error')
        if (failedSlots.length > 0) {
          addLog(`🚨 Roboneo busy di semua key — failover ke G5 AI Studio untuk ${failedSlots.length} slot...`, 'warn')
          const g5Results = await Promise.allSettled(failedSlots.map((s, i) => runG5FailoverForSlot(s, i + 1)))
          const g5Ok = g5Results.filter((r) => r.status === 'fulfilled' && r.value).length
          if (g5Ok > 0) {
            successRef.current = true
            addLog(`Selesai — ${g5Ok} video via G5 failover`, 'success')
            if (logId) logGenerationComplete(logId, { status: 'completed', duration_ms: Date.now() - startTime })
          }
        }
      }
      if (isRoboneo) {
        addLog('⚠️ Credit mungkin sudah terpotong oleh server provider.', 'warn')
      }
    }

    // Refresh balance after generation
    if (isRoboneo) {
      try {
        const activeKey = useProviderManager.getState().getActiveKey('roboneo')
        if (activeKey) {
          const balanceResult = await checkRoboneoBalance(activeKey.key)
          if (balanceResult.ok && balanceResult.balance !== null) {
            addLog(`💰 Balance terakhir: ${balanceResult.balance}`, 'info')
          }
        }
      } catch (e) { console.warn('[Motion] Failed to check balance:', e) }
    }

     } catch (genErr: any) {
      addLog(`Generation error: ${genErr.message}`, 'error')
      addToast(`Generate gagal: ${genErr.message}`, 'error')
      if (logId) logGenerationFailed(logId, genErr.message, Date.now() - startTime)
    } finally {
      if (ephemeralTaskId) removeActiveTask(ephemeralTaskId)
      if (generatingRef.current && successRef.current) {
        addToast(`Generate selesai: ${currentProvider.name} · ${currentModel.label}`, 'success')
      }
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const handleDownload = useCallback(async (url: string, id: string) => {
    try {
      const filename = `motion-${id}.mp4`
      const isExternal = /^https?:\/\//i.test(url) && !url.includes(window.location.origin)

      if (isExternal) {
        // Try proxy first to avoid CORS issues
        const proxyUrl = `/api/public/video-proxy?url=${encodeURIComponent(url)}`
        const res = await fetch(proxyUrl)
        const ct = res.headers.get('content-type') || ''
        if (res.ok && (ct.includes('video') || ct.includes('octet-stream'))) {
          const blob = await res.blob()
          if (blob.size > 1024) {
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = blobUrl
            a.download = filename
            document.body.appendChild(a)
            a.click()
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl) }, 1000)
            return
          }
        }
        // Fallback: direct link
        window.open(url, '_blank')
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  const filteredResults = results.filter(
    (r) => !searchQuery || r.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const [zipping, setZipping] = useState(false)

  const handleExportZip = useCallback(async () => {
    if (filteredResults.length === 0 || zipping) return
    setZipping(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      let count = 0
      for (const result of filteredResults) {
        count++
        try {
          let blob: Blob | null = null
          try {
            const res = await fetch(result.url, { mode: 'cors' })
            if (res.ok) blob = await res.blob()
          } catch (e) { console.warn('[Motion] Direct fetch failed, trying proxy:', e) }
          if (!blob) {
            const res = await fetch(`/api/public/proxy-image?url=${encodeURIComponent(result.url)}`)
            if (res.ok) blob = await res.blob()
          }
          if (blob) {
            const name = `motion-${String(count).padStart(2, '0')}-${result.id}.mp4`
            zip.file(name, blob)
          }
        } catch (e) { console.warn('[Motion] Failed to add video to ZIP:', e) }
      }
      if (Object.keys(zip.files).length === 0) {
        addToast('Gagal download video untuk ZIP', 'error')
        return
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `motion-gallery-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err: any) {
      addToast(`ZIP error: ${err.message}`, 'error')
    } finally {
      setZipping(false)
    }
  }, [filteredResults, zipping, addToast])

  if (!currentModel) {
    return (
      <PageContent>
        <PageHeader
          eyebrow="Generate"
          title="Motion"
          highlight="Control"
          desc="Kling Motion Control — transfer gerakan karakter dari video / gambar referensi."
        />
        <EmptyState icon={<Video className="h-10 w-10" />} title="Pilih provider motion control" description="Tidak ada model yang tersedia untuk provider ini." />
      </PageContent>
    )
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Motion"
        highlight="Control"
        desc="Kling Motion Control — transfer gerakan karakter dari video / gambar referensi."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Reference Slots */}
        <Section
          title={`Referensi (${slots.length}/${MAX_SLOTS})`}
          sub="Setiap pasang gambar + video menghasilkan 1 video"
          right={
            <Button size="sm" variant="outline" onClick={addSlot} disabled={slots.length >= MAX_SLOTS}>
              <Plus className="h-3.5 w-3.5" /> Tambah
            </Button>
          }
        >
          <div className={`relative grid gap-3 ${
            slots.length === 1 ? 'grid-cols-1' :
            slots.length === 2 ? 'grid-cols-1 lg:grid-cols-2' :
            'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
          }`}>
            {slots.map((slot, index) => (
              <SlotCard
                key={slot.id}
                index={index}
                slot={slot}
                showVideo={!slotsImageOnly}
                onImage={(file) => handleFileChange(slot.id, 'image', file)}
                onVideo={(file) => handleFileChange(slot.id, 'video', file)}
                onTiktok={(link) => handleTiktokImport(slot.id, link)}
                onRemove={() => removeSlot(slot.id)}
                canRemove={slots.length > 1}
              />
            ))}
            {compressDialog && (
              <div role="dialog" aria-modal="true" aria-live="polite" className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-sm">
                <div className="w-[min(360px,90%)] rounded-2xl border border-primary/40 bg-card/95 p-5 shadow-2xl shadow-primary/20">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                    <div className="font-display text-sm text-foreground">Mengompres file…</div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground break-words">{compressDialog.msg}</div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full bg-primary transition-all ${typeof compressDialog.pct === 'number' ? '' : 'animate-pulse'}`}
                      style={{ width: typeof compressDialog.pct === 'number' ? `${Math.max(0, Math.min(100, compressDialog.pct))}%` : '100%' }}
                    />
                  </div>
                  <div className="mt-3 text-[12px] uppercase tracking-widest text-muted-foreground text-center">Mohon tunggu sampai proses selesai</div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Settings */}
        <div className="flex flex-col gap-5">
          <Section title="Pengaturan" sub={`Provider aktif: ${currentProvider.name}`}>
            <div className="flex flex-col gap-4">
              <div>
                <Label>Penyedia</Label>
                <p className="mt-1 mb-2 text-[11px] leading-relaxed text-muted-foreground">
                  Pilih tempat video diproses. Belum yakin? Pakai Alriz Motion — paling gampang.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {MOTION_PROVIDER_IDS.map((id) => {
                    const info = MOTION_PROVIDER_INFO[id]
                    const isActive = provider === id
                    const minPrice = Math.min(...PROVIDERS[id].models.map((m) => m.cr))
                    const priceLine = id === 'alriz'
                      ? `Mulai Rp ${minPrice.toLocaleString('id-ID')} / video`
                      : id === 'seavi'
                      ? `Mulai ${minPrice} token / video`
                      : `Mulai ${minPrice} kredit / video`
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => selectMotionProvider(id)}
                        aria-pressed={isActive}
                        className={`rounded-xl border p-3 text-left transition ${
                          isActive
                            ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                            : 'border-border bg-card/40 hover:border-primary/50 hover:bg-card/70'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                            isActive ? 'bg-primary/20 text-primary' : 'bg-card text-muted-foreground'
                          }`}>
                            {id === 'alriz'
                              ? <Wallet className="h-4 w-4" />
                              : id === 'seavi'
                              ? <Coins className="h-4 w-4" />
                              : <Zap className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-display text-sm text-foreground">{info.name}</span>
                              {info.recommended && (
                                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Disarankan</span>
                              )}
                              {isActive && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                            </div>
                            <div className="mt-0.5 text-[11px] text-foreground/80">
                              {info.tagline} · <span className="font-medium">{priceLine}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{info.note}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>Model</Label>
                <p className="mt-1 mb-2 text-[11px] leading-relaxed text-muted-foreground">
                  Menentukan kualitas dan biaya tiap video. Pilihan bertanda "disarankan" sudah cukup untuk sebagian besar kebutuhan.
                </p>
                <Select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  options={[...currentProvider.models]
                    .sort((a, b) => Number(b.key === recommendedModelKey) - Number(a.key === recommendedModelKey))
                    .map((m) => ({ value: m.key, label: motionModelLabel(provider as MotionProviderId, m) }))}
                />
              </div>

              <MaintenanceBanner providerId={provider} />

              {provider !== 'seavi' && (
                <div>
                  <Label>Character Orientation</Label>
                  <Select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as 'video' | 'image')}
                    options={[
                      { value: 'video', label: 'Video (durasi mengikuti referensi)' },
                      { value: 'image', label: 'Image (output max 5–10 detik)' },
                    ]}
                  />
                </div>
              )}

              {modelKey !== 'rh:wf:kontrol-gerakan' && (
                <>
                  <div>
                    <Label>Prompt (opsional)</Label>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Deskripsikan motion yang diinginkan…"
                      rows={2}
                    />
                  </div>

                  {provider !== 'seavi' && (
                    <div>
                      <Label>Negative Prompt (opsional)</Label>
                      <Textarea
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="blurry, low quality, distorted…"
                        rows={2}
                      />
                    </div>
                  )}
                </>
              )}

              {provider !== 'seavi' && (
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepSound}
                  onChange={(e) => setKeepSound(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-sm text-foreground/90">Keep Original Sound</span>
              </label>
              )}

              {/* MC Ultra Fast HD specific options */}
              {modelKey === 'rh:wf:ultra-hd' && (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div>
                      <Label>FPS</Label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={ultraFps}
                        onChange={(e) => setUltraFps(Math.max(1, Math.min(60, Number(e.target.value) || 60)))}
                        className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <Label>Steps</Label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={ultraSteps}
                        onChange={(e) => setUltraSteps(Math.max(1, Math.min(100, Number(e.target.value) || 4)))}
                        className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <Label>Max Frames</Label>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={ultraMaxFrames}
                        onChange={(e) => setUltraMaxFrames(Math.max(1, Math.min(1000, Number(e.target.value) || 120)))}
                        className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Default workflow: 60 FPS · 4 Steps · output vertikal 1080×1920 (proses 480×848 lalu upscale HD).
                    FPS/Steps lebih tinggi = beban proses lebih berat.
                  </p>
                </>
              )}

              {/* Wan Motion specific options */}
              {modelKey === 'g5:wan-motion' && (
                <>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={adaptMotion}
                      onChange={(e) => setAdaptMotion(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-sm text-foreground/90">Adapt Motion</span>
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1 ml-8">Adapts driving video motion to match reference image body proportions</p>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enhanceIdentity}
                      onChange={(e) => setEnhanceIdentity(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-sm text-foreground/90">Enhance Identity</span>
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1 ml-8">Enhances face/appearance transfer via Flux Kontext Edit (slower)</p>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={safetyChecker}
                      onChange={(e) => setSafetyChecker(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-sm text-foreground/90">Safety Checker</span>
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1 ml-8">Check input/output for safety content</p>
                </>
              )}

              {/* Auto-trim to 9 seconds (Markas Tools style) */}
              {provider === 'roboneo' && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoTrim}
                    onChange={(e) => setAutoTrim(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                    <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground/90">Potong otomatis ke 9 detik (kurangi durasi & biaya untuk video panjang)</span>
                    <span className="text-[11px] text-muted-foreground">Video referensi dipotong ke 9 detik pertama. Catatan: biaya mengikuti durasi & model (2.6 Std ±86 🥕).</span>
                  </div>
                </label>
              )}

<Button
                onClick={handleGenerate}
                disabled={filledSlots === 0 || generating}
                className="w-full"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memproses…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Generate Semua
                  </>
                )}
              </Button>

              {(generating || statusSummary !== 'Idle') && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate pr-2">{statusSummary}</span>
                    {generating && <span className="font-mono font-semibold text-foreground shrink-0">{slotProgress}% <span className="text-muted-foreground font-normal">· {elapsed}</span></span>}
                  </div>
                  {generating && (
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                        style={{ width: `${slotProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {!generating && progress === 100 && results.length > 0 && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleGenerate}
                >
                  <Rocket className="h-4 w-4" /> Generate Lagi
                </Button>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                <span>
                  {provider === 'alriz' ? (
                    <>Total: <span className="text-foreground font-mono font-semibold">Rp {totalCredits.toLocaleString('id-ID')}</span> ({filledSlots} × Rp {currentModel.cr.toLocaleString('id-ID')})</>
                  ) : provider === 'seavi' ? (
                    <>Total: <span className="text-foreground font-mono font-semibold">{totalCredits.toLocaleString()}</span> token ({filledSlots} × {currentModel.cr} token)</>
                  ) : (
                    <>Total: <span className="text-foreground font-mono font-semibold">{totalCredits.toLocaleString()}</span> credits ({filledSlots} × {currentModel.cr})</>
                  )}
                </span>
                {provider === 'seavi' && authRole !== 'admin' ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                      (seaviTokens ?? 0) >= totalCredits
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-red-500/40 bg-red-500/10 text-red-400'
                    }`}
                  >
                    <Coins className="h-3 w-3" /> {seaviTokens ?? '…'} token
                  </span>
                ) : provider !== 'seavi' ? (
                  <BalanceBadge provider={provider} required={totalCredits} />
                ) : null}
              </div>
              {provider === 'seavi' && authRole !== 'admin' && authToken && (seaviTokens ?? 0) < totalCredits && (
                <Link to="/topup/seavi" className="text-center text-[11px] font-medium text-primary hover:underline">
                  Top Up Token Seavi (Rp 4.000 = 2 token) →
                </Link>
              )}
            </div>
          </Section>

          {/* Logs */}
          {(generating || logs.length > 0) && (
            <div className="rounded-xl border border-border/70 bg-black/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  Log Proses {generating && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
                      navigator.clipboard.writeText(text)
                      addToast('Log disalin ke clipboard', 'success')
                    }}
                    className="text-[12px] text-muted-foreground hover:text-foreground transition flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                  <button
                    onClick={() => { setLogs([]); clearLogs() }}
                    className="text-[12px] text-muted-foreground hover:text-destructive"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto overflow-x-hidden font-mono text-[12px] leading-relaxed min-w-0">
                {logs.slice().reverse().map((log, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all min-w-0 ${
                      log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                        ? 'text-blue-400'
                        : log.level === 'success'
                        ? 'text-emerald-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    [{log.time}] {log.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Gallery */}
      <Section
        title="Gallery"
        sub="Video yang telah selesai dibuat"
        right={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportZip}
              disabled={results.length === 0 || zipping}
              className="text-xs"
            >
              {zipping ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              {zipping ? 'Zipping…' : 'Export ZIP'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!window.confirm(`Hapus semua ${results.length} video dari gallery?`)) return
                setResults([]); clearResults(); setLogs([]); clearLogs()
              }}
              disabled={results.length === 0}
              className="text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Hapus Semua
            </Button>
          </div>
        }
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {filteredResults.length === 0 ? (
            <EmptyState
              icon={<Video className="h-8 w-8" />}
              title="Belum ada video"
              description="Generate video dari referensi gambar dan video"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-xl overflow-hidden border border-border/60 bg-card/40 group"
                >
                  <div className="aspect-video bg-black/40 relative">
                    <video
                      src={(() => {
                        if (!/genspark\.ai/i.test(result.url)) return result.url
                        // Strip old token (it's for the input file, not this output)
                        const cleanUrl = result.url.split('?')[0]
                        // Get API key from localStorage for auth
                        let apiKey = ''
                        try { const raw = localStorage.getItem('arkxmotion.providers'); const p = JSON.parse(raw || '{}'); const k = (p.genspark || [])[0]; apiKey = k?.key || '' } catch {}
                        return `/api/public/video-proxy?url=${encodeURIComponent(cleanUrl)}${apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : ''}`
                      })()}
                      className="w-full h-full object-contain"
                      controls
                      muted
                      playsInline
                      preload="metadata"
                    />
                  </div>
                  <div className="p-2 flex flex-col gap-1.5">
                    <span className="text-[11px] text-muted-foreground truncate" title={result.prompt}>
                      {result.prompt}
                    </span>
                    <div className="flex items-center gap-1">
                      <a
                        onClick={(e) => { e.preventDefault(); handleDownload(result.url, result.id) }}
                        href="#"
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500 transition"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                      {result.taskUrl && (
                        <a
                          href={result.taskUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-500 transition"
                          title="Buka di provider untuk download tanpa watermark (pakai Video Download Helper extension)"
                        >
                          <Globe className="h-3.5 w-3.5" /> Open
                        </a>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setResults(results.filter((r) => r.id !== result.id));
                          removeResult(result.id);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Hapus
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {confirmDialog && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setConfirmDialog(null)}>
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg text-foreground mb-2">{confirmDialog.title}</div>
            <p className="text-sm text-muted-foreground mb-5">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)} className="rounded-full px-4 py-1.5 text-xs font-semibold border border-border bg-card hover:bg-card/80 transition">
                Batal
              </button>
              <button onClick={confirmDialog.onConfirm} className="rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground" style={{ background: 'var(--gradient-neon)' }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContent>
  )
}

function SlotCard({
  index,
  slot,
  onImage,
  onVideo,
  onTiktok,
  onRemove,
  canRemove,
  showVideo = true,
}: {
  index: number
  slot: Slot
  onImage: (file: File | null) => void
  onVideo: (file: File | null) => void
  onTiktok: (link: string) => Promise<void>
  onRemove: () => void
  canRemove: boolean
  showVideo?: boolean
}) {
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  const statusColor = slot.status === 'done' ? 'text-emerald-400 border-emerald-500/40'
    : slot.status === 'error' ? 'text-red-400 border-red-500/40'
    : slot.status === 'idle' ? 'text-muted-foreground border-border'
    : 'text-blue-400 border-blue-500/40'

  return (
    <div className="rounded-2xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground shrink-0">
            Referensi #{index + 1}
          </div>
          {slot.status !== 'idle' && (
            <div className={`text-[12px] px-2 py-0.5 rounded-full border bg-black/30 truncate ${statusColor}`}>
              {slot.statusText || slot.status}{slot.error ? ` — ${slot.error}` : ''}
            </div>
          )}
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/50 transition"
          >
            <Trash2 className="h-3.5 w-3.5" /> Hapus
          </button>
        )}
      </div>

      <div className={`grid gap-2 ${showVideo ? 'grid-cols-1 min-[480px]:grid-cols-2' : 'grid-cols-1'}`}>
        <FileUpload
          ref={imageRef}
          kind="image"
          label={showVideo ? 'Character Image' : 'Image Reference'}
          hint={showVideo ? 'PNG / JPG' : 'PNG / JPG'}
          accept="image/*"
          file={slot.image}
          previewUrl={slot.imageUrl}
          onChange={onImage}
        />
        {showVideo && (
          <div className="flex flex-col gap-1.5">
            <FileUpload
              ref={videoRef}
              kind="video"
              label="Reference Video"
              hint={`MP4 / MOV · maks ${MAX_VIDEO_REF_MB} MB`}
              accept="video/*"
              file={slot.video}
              previewUrl={slot.videoUrl}
              onChange={onVideo}
            />
            <TikTokImportRow onImport={onTiktok} />
          </div>
        )}
      </div>
    </div>
  )
}

function TikTokImportRow({ onImport }: { onImport: (link: string) => Promise<void> }) {
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const value = link.trim()
    if (!value || loading) return
    setLoading(true)
    setError('')
    try {
      await onImport(value)
      setLink('')
    } catch (err: any) {
      setError(err?.message || 'Gagal mengambil video TikTok')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={loading}
          placeholder="Tempel link TikTok publik…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs outline-none transition focus:border-primary/50 disabled:opacity-60"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void submit()}
          disabled={!link.trim() || loading}
          className="h-8 shrink-0 px-3 text-xs"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Ambil
        </Button>
      </div>
      {error ? (
        <p className="text-[10px] leading-snug text-red-400">{error}</p>
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground">
          HD tanpa watermark otomatis jadi video referensi
        </p>
      )}
    </div>
  )
}

interface FileUploadProps {
  kind: 'image' | 'video'
  label: string
  hint: string
  accept: string
  file: File | null
  previewUrl: string | null
  onChange: (file: File | null) => void
}

const FileUpload = forwardRef<HTMLInputElement, FileUploadProps>(
  ({ kind, label, hint, accept, file, previewUrl, onChange }, ref) => {
    const hasFile = !!file && !!previewUrl
    const fileSize = file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : ''

  return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </label>
        <div
          onClick={() => (ref as React.RefObject<HTMLInputElement>)?.current?.click()}
          className={`relative overflow-hidden rounded-xl border border-dashed cursor-pointer group transition ${
            hasFile
              ? 'border-primary/50 bg-card/50'
              : 'border-border/80 bg-card/30 hover:border-primary/60'
          }`}
          style={{ aspectRatio: '4 / 3', minHeight: '180px' }}
        >
          {hasFile ? (
            <>
              {kind === 'image' ? (
                <img src={previewUrl} alt="Preview input motion" className="absolute inset-0 h-full w-full object-contain bg-black/40" />
              ) : (
                <video src={previewUrl} aria-label="Preview input motion" className="absolute inset-0 h-full w-full object-contain bg-black/40" muted playsInline />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 flex items-center justify-between text-[11px] opacity-100 transition-opacity">
                <span className="truncate text-foreground/95 max-w-[70%]">{file.name}</span>
                <span className="font-mono text-muted-foreground">{fileSize}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(null)
                }}
                className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 backdrop-blur px-2 py-1 text-[11px] text-white hover:text-destructive transition"
              >
                <X className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Ganti</span>
              </button>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-center px-3">
              <div className="flex flex-col items-center gap-2">
                <div className="h-10 w-10 rounded-xl grid place-items-center bg-primary text-primary-foreground">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-1.5 text-sm text-foreground/90">
                  <Upload className="h-3.5 w-3.5" /> Upload
                </div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
              </div>
            </div>
          )}
          <input
            ref={ref}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
    )
  }
)

FileUpload.displayName = 'FileUpload'
